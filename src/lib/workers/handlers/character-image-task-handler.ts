import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, getArtStylePrompt, isArtStyleValue, PRIMARY_APPEARANCE_INDEX, type ArtStyleValue } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  toSignedUrlIfCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  AnyObj,
  generateProjectLabeledImageToStorage,
  parseImageUrls,
  parseJsonStringArray,
  pickFirstString,
} from './image-task-handler-shared'

type CharacterAngle = 'closeup' | 'front' | 'side' | 'back'

function buildCharacterAnglePrompt(rawDescription: string, angle: CharacterAngle, artStylePrompt: string) {
  const base = (rawDescription || '').trim()
  const angleInstruction = (() => {
    switch (angle) {
      case 'closeup':
        return '仅生成角色正面头肩特写，正对镜头，面部清晰，占画面主体。'
      case 'front':
        return '仅生成角色正面全身，正对镜头，完整入镜。'
      case 'side':
        return '仅生成角色侧面全身（左侧面或右侧面择一），完整入镜。'
      case 'back':
        return '仅生成角色背面全身，完整入镜。'
      default:
        return ''
    }
  })()
  const layout = '单张图，纯白色背景，无其他元素，无文字，无边框，不要拼图，不要多视图。'
  const parts = [base, angleInstruction, layout].filter(Boolean)
  const core = parts.join('，')
  return artStylePrompt ? `${core}，${artStylePrompt}` : core
}

function resolvePayloadArtStyle(payload: AnyObj): ArtStyleValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'artStyle')) return undefined
  const parsedArtStyle = typeof payload.artStyle === 'string' ? payload.artStyle.trim() : ''
  if (!isArtStyleValue(parsedArtStyle)) {
    throw new Error('Invalid artStyle in IMAGE_CHARACTER payload')
  }
  return parsedArtStyle
}

interface CharacterAppearanceRecord {
  id: string
  characterId: string
  appearanceIndex: number
  descriptions: string | null
  description: string | null
  imageUrls: string | null
  selectedIndex: number | null
  imageUrl: string | null
  changeReason: string | null
  previousImageUrl: string | null
  previousImageUrls: string | null
}

interface CharacterAppearanceWithCharacter extends CharacterAppearanceRecord {
  character: {
    name: string
  }
}

interface CharacterRecord {
  id: string
  name: string
  appearances: CharacterAppearanceRecord[]
}

interface PrimaryAppearanceRecord {
  imageUrl: string | null
  imageUrls: string | null
}

interface CharacterImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceWithCharacter | null>
    findFirst(args: Record<string, unknown>): Promise<PrimaryAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionCharacter: {
    findUnique(args: Record<string, unknown>): Promise<CharacterRecord | null>
  }
}

export async function handleCharacterImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as CharacterImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const models = await getProjectModels(projectId, userId)
  const modelId = models.characterModel
  if (!modelId) throw new Error('Character model not configured')

  const appearanceId = pickFirstString(job.data.targetId, payload.appearanceId)
  let appearance: CharacterAppearanceRecord | null = null
  let characterName = '角色'

  if (appearanceId) {
    const appearanceWithCharacter = await db.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (appearanceWithCharacter) {
      appearance = appearanceWithCharacter
      characterName = appearanceWithCharacter.character.name
    }
  }

  const characterId = typeof payload.id === 'string' ? payload.id : null
  if (!appearance && characterId) {
    const character = await db.novelPromotionCharacter.findUnique({
      where: { id: characterId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })
    appearance = character?.appearances?.[0] || null
    if (character && appearance) {
      characterName = character.name
    }
  }

  if (!appearance) throw new Error('Character appearance not found')

  const payloadArtStyle = resolvePayloadArtStyle(payload)
  const artStyle = getArtStylePrompt(payloadArtStyle ?? models.artStyle, job.data.locale)
  const descriptions = parseJsonStringArray(appearance.descriptions)
  const baseDescriptions = descriptions.length > 0 ? descriptions : [appearance.description || '']

  // 子形象（不是主形象）生成时，引用主形象图片保持一致性
  const primaryReferenceInputs: string[] = []
  if (appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX) {
    const primaryAppearance = await db.characterAppearance.findFirst({
      where: {
        characterId: appearance.characterId,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      },
      select: { imageUrl: true, imageUrls: true },
    })
    if (primaryAppearance) {
      const primaryMainUrl = primaryAppearance.imageUrl
        ? toSignedUrlIfCos(primaryAppearance.imageUrl, 3600)
        : null
      if (primaryMainUrl) {
        primaryReferenceInputs.push(primaryMainUrl)
      }
    }
  }
  const primaryReferenceImages = await normalizeReferenceImagesForGeneration(primaryReferenceInputs, {
    requireAtLeastOne: false,
    context: {
      taskType: 'character_image_primary_reference',
      appearanceId: appearance.id,
    },
  })

  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  const count = normalizeImageGenerationCount('character', payload.count)
  const indexes = singleIndex !== undefined
    ? [Number(singleIndex)]
    : Array.from({ length: count }, (_value, index) => index)

  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const nextImageUrls: string[] = []
  const label = `${characterName} - ${appearance.changeReason || '形象'}`

  const angleKeys = (['closeup', 'front', 'side', 'back'] as const)
  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i]
    const raw = baseDescriptions[index] || baseDescriptions[0]

    await reportTaskProgress(job, 15 + Math.floor((i / Math.max(indexes.length, 1)) * 55), {
      stage: 'generate_character_image',
      index,
    })

    for (let a = 0; a < angleKeys.length; a++) {
      const angle = angleKeys[a]
      const prompt = buildCharacterAnglePrompt(raw, angle, artStyle)
      const key = await generateProjectLabeledImageToStorage({
        job,
        userId,
        modelId,
        prompt,
        label,
        targetId: `${appearance.id}-${index}-${angle}`,
        keyPrefix: 'character',
        options: {
          referenceImages: primaryReferenceImages.length > 0 ? primaryReferenceImages : undefined,
          aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
        },
      })
      const absoluteIndex = index * angleKeys.length + a
      while (nextImageUrls.length <= absoluteIndex) {
        nextImageUrls.push('')
      }
      nextImageUrls[absoluteIndex] = key
    }
  }

  // 兼容旧数据：如果之前是“非4倍数”的单张拼图候选，生成后直接覆盖到新结构，并把旧值写入 previous* 以支持撤回
  const previousImageUrl = appearance.imageUrl
  const previousImageUrls = appearance.imageUrls

  const selectedIndex = appearance.selectedIndex
  const fallbackMain = nextImageUrls.find((url) => typeof url === 'string' && url) || null

  // 选择逻辑：如果用户之前选中某个索引，尽量将其映射到新结构的“对应方案-正面全身”
  // - 旧数据：selectedIndex 指向候选图；新数据：每方案4张，默认主图使用正面全身（offset=1）
  const angleCount = angleKeys.length
  const preferredMainIndex = selectedIndex !== null && selectedIndex !== undefined
    ? (Math.floor(selectedIndex / angleCount) * angleCount + 1)
    : null
  const mainImage = preferredMainIndex !== null && nextImageUrls[preferredMainIndex]
    ? nextImageUrls[preferredMainIndex]
    : fallbackMain

  await assertTaskActive(job, 'persist_character_image')
  await db.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      previousImageUrl,
      previousImageUrls,
      imageUrls: encodeImageUrls(nextImageUrls),
      imageUrl: mainImage || null,
    },
  })

  return {
    appearanceId: appearance.id,
    imageCount: nextImageUrls.filter(Boolean).length,
    imageUrl: mainImage || null,
  }
}
