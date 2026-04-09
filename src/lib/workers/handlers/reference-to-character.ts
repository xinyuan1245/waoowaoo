import sharp from 'sharp'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { generateImage } from '@/lib/generator-api'
import { queryFalStatus } from '@/lib/async-submit'
import { fetchWithTimeoutAndRetry } from '@/lib/ark-api'
import { getProviderConfig } from '@/lib/api-config'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { getUserModelConfig } from '@/lib/config-service'
import {
  CHARACTER_IMAGE_BANANA_RATIO,
  getArtStylePrompt,
} from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { generateUniqueKey, getSignedUrl, uploadObject } from '@/lib/storage'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  parseReferenceImages,
  readBoolean,
  readString,
} from './reference-to-character-helpers'

const POLL_MAX_ATTEMPTS = 60
const POLL_INTERVAL_MS = 2000
const REFERENCE_TO_CHARACTER_VIEW_COUNT = 3
const VIEW_REFERENCE_TTL_SECONDS = 7 * 24 * 3600

type CharacterView = 'front' | 'side' | 'back'

function getSingleViewInstruction(view: CharacterView, locale: 'zh' | 'en'): string {
  if (locale === 'en') {
    if (view === 'front') {
      return [
        'Generate exactly one full-body front view of the character.',
        'The character faces the camera directly with a neutral expression and natural standing pose.',
        'Do not create a collage, character sheet, turnaround sheet, multiple views, or multiple characters.',
        'Plain pure white background, centered full body, no extra objects.',
      ].join(' ')
    }
    if (view === 'side') {
      return [
        'Generate exactly one full-body side view of the same character.',
        'Use the provided front view as the identity anchor, preserving the same face traits, hairstyle, body proportions, outfit structure, colors, shoes, and accessories.',
        'Only rotate the character to a clean side profile; do not redesign clothing or hairstyle.',
        'Do not create a collage, character sheet, turnaround sheet, multiple views, or multiple characters.',
        'Plain pure white background, centered full body, no extra objects.',
      ].join(' ')
    }
    return [
      'Generate exactly one full-body back view of the same character.',
      'Use the provided front and side views as identity anchors, preserving the same body proportions, hairstyle, outfit structure, colors, shoes, and accessories.',
      'Only rotate the character to a clean rear view; infer hidden back details consistently from the front and side references.',
      'Do not create a collage, character sheet, turnaround sheet, multiple views, or multiple characters.',
      'Plain pure white background, centered full body, no extra objects.',
    ].join(' ')
  }

  if (view === 'front') {
    return [
      '只生成一张角色正面全身图。',
      '角色正对镜头，自然站立，中性平静表情。',
      '不要生成拼图、设定图排版、三视图、多个视角或多个人物。',
      '纯白背景，完整全身居中展示，无其他元素。',
    ].join('')
  }
  if (view === 'side') {
    return [
      '只生成一张同一角色的侧面全身图。',
      '以前面提供的正面图作为身份锚点，严格保持相同的五官特征、发型、体型比例、服装结构、颜色、鞋子和配饰。',
      '只改变视角为清晰侧面，不要重新设计服装或发型。',
      '不要生成拼图、设定图排版、三视图、多个视角或多个人物。',
      '纯白背景，完整全身居中展示，无其他元素。',
    ].join('')
  }
  return [
    '只生成一张同一角色的背面全身图。',
    '以前面提供的正面图和侧面图作为身份锚点，严格保持相同的体型比例、发型、服装结构、颜色、鞋子和配饰。',
    '只改变视角为清晰背面，根据正面和侧面参考合理补全背部细节。',
    '不要生成拼图、设定图排版、三视图、多个视角或多个人物。',
    '纯白背景，完整全身居中展示，无其他元素。',
  ].join('')
}

function buildSingleViewPrompt(params: {
  basePrompt: string
  view: CharacterView
  locale: 'zh' | 'en'
  artStylePrompt: string
  frontDescription?: string | null
}): string {
  const parts = [
    params.basePrompt,
    params.frontDescription
      ? params.locale === 'en'
        ? `Character consistency notes extracted from the generated front view: ${params.frontDescription}`
        : `从已生成正面图提取的角色一致性描述：${params.frontDescription}`
      : '',
    getSingleViewInstruction(params.view, params.locale),
    params.artStylePrompt,
  ].map((part) => part.trim()).filter(Boolean)

  return parts.join(params.locale === 'en' ? '\n\n' : '\n\n')
}

async function generateReferenceImage(params: {
  job: Job<TaskJobData>
  imageIndex: number
  userId: string
  imageModel: string
  prompt: string
  referenceImages?: string[]
  falApiKey?: string | null
  keyPrefix: string
  labelText?: string
}): Promise<string | null> {
  const {
    job,
    imageIndex,
    userId,
    imageModel,
    prompt,
    referenceImages,
    falApiKey,
    keyPrefix,
    labelText,
  } = params

  try {
    await assertTaskActive(job, `reference_to_character_generate_${imageIndex + 1}`)
    const result = await generateImage(
      userId,
      imageModel,
      prompt,
      {
        referenceImages,
        aspectRatio: CHARACTER_IMAGE_BANANA_RATIO,
      },
    )

    let finalImageUrl = result.imageUrl
    const requestId = typeof result.requestId === 'string' ? result.requestId : ''
    const endpoint = typeof result.endpoint === 'string' ? result.endpoint : ''
    if (result.async && requestId && endpoint) {
      if (!falApiKey) {
        throw new Error('reference_to_character async result requires falApiKey')
      }
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await assertTaskActive(job, `reference_to_character_poll_${imageIndex + 1}_${attempt + 1}`)
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        const status = await queryFalStatus(endpoint, requestId, falApiKey)
        if (status.completed && status.resultUrl) {
          finalImageUrl = status.resultUrl
          break
        }
        if (status.failed) {
          return null
        }
      }
    }

    if (!result.success || !finalImageUrl) {
      return null
    }

    const imgRes = await fetchWithTimeoutAndRetry(finalImageUrl, {
      logPrefix: `[reference-to-character:${imageIndex + 1}]`,
    })
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const processed = labelText
      ? await (async () => {
        const meta = await sharp(buffer).metadata()
        const width = meta.width || 2160
        const height = meta.height || 2160
        const fontSize = Math.floor(height * 0.04)
        const pad = Math.floor(fontSize * 0.5)
        const barHeight = fontSize + pad * 2
        const svg = await createLabelSVG(width, barHeight, fontSize, pad, labelText)
        return await sharp(buffer)
          .extend({
            top: barHeight,
            bottom: 0,
            left: 0,
            right: 0,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          })
          .composite([{ input: svg, top: 0, left: 0 }])
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer()
      })()
      : await sharp(buffer)
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()

    const key = generateUniqueKey(`${keyPrefix}-${Date.now()}-${imageIndex}`, 'jpg')
    return await uploadObject(processed, key)
  } catch {
    return null
  }
}

async function analyzeGeneratedFrontView(params: {
  job: Job<TaskJobData>
  analysisModel: string
  frontImageUrl: string
  isProject: boolean
}): Promise<string | null> {
  if (!params.analysisModel) return null

  const analysisPrompt = buildPrompt({
    promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
    locale: params.job.data.locale,
  })
  const completion = await executeAiVisionStep({
    userId: params.job.data.userId,
    model: params.analysisModel,
    prompt: analysisPrompt,
    imageUrls: [params.frontImageUrl],
    temperature: 0.3,
    ...(params.isProject ? { projectId: params.job.data.projectId } : {}),
  })

  return completion.text || null
}

export async function handleReferenceToCharacterTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const allReferenceImages = parseReferenceImages(payload)
  if (allReferenceImages.length === 0) {
    throw new Error('Missing referenceImageUrl or referenceImageUrls')
  }

  const isAssetHub = job.data.type === TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER
  const isProject = job.data.type === TASK_TYPE.REFERENCE_TO_CHARACTER
  if (!isAssetHub && !isProject) {
    throw new Error(`Unsupported task type: ${job.data.type}`)
  }

  const isBackgroundJob = readBoolean(payload.isBackgroundJob)
  const appearanceId = readString(payload.appearanceId)
  const characterId = readString(payload.characterId)
  const extractOnly = readBoolean(payload.extractOnly)
  const customDescription = readString(payload.customDescription)
  const characterName = readString(payload.characterName) || '新角色 - 初始形象'
  const artStyle = readString(payload.artStyle)

  if (isBackgroundJob && (!characterId || !appearanceId)) {
    throw new Error('Missing characterId or appearanceId for background job')
  }

  await reportTaskProgress(job, 15, {
    stage: 'reference_to_character_prepare',
    stageLabel: '准备参考图转换参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'reference_to_character_prepare')
  if (isProject) {
    await initializeFonts()
  }

  const userConfig = await getUserModelConfig(job.data.userId)
  const imageModel = readString(userConfig.characterModel)
  const analysisModel = readString(userConfig.analysisModel)
  if (!imageModel && !extractOnly) {
    throw new Error('请先在设置页面配置角色图片模型')
  }
  if (!analysisModel && extractOnly) {
    throw new Error('请先在设置页面配置分析模型')
  }

  if (extractOnly) {
    await reportTaskProgress(job, 45, {
      stage: 'reference_to_character_extract',
      stageLabel: '提取参考图描述',
      displayMode: 'detail',
    })
    const completion = await executeAiVisionStep({
      userId: job.data.userId,
      model: analysisModel,
      prompt: buildPrompt({
        promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
        locale: job.data.locale,
      }),
      imageUrls: allReferenceImages,
      temperature: 0.3,
      ...(isProject ? { projectId: job.data.projectId } : {}),
    })
    await assertTaskActive(job, 'reference_to_character_extract_done')
    await reportTaskProgress(job, 96, {
      stage: 'reference_to_character_extract_done',
      stageLabel: '参考图描述提取完成',
      displayMode: 'detail',
    })
    return {
      success: true,
      description: completion.text,
    }
  }

  const artStylePrompt = getArtStylePrompt(artStyle, job.data.locale)

  const basePrompt = customDescription || buildPrompt({
    promptId: PROMPT_IDS.CHARACTER_REFERENCE_TO_SHEET,
    locale: job.data.locale,
  })
  const useReferenceImages = !customDescription
  const { apiKey: falApiKey } = await getProviderConfig(job.data.userId, 'fal')
  const keyPrefix = isAssetHub ? 'ref-char' : `proj-ref-char-${job.data.projectId}`

  await reportTaskProgress(job, 35, {
    stage: 'reference_to_character_generate_front',
    stageLabel: '生成角色正面图',
    displayMode: 'detail',
  })

  const frontPrompt = buildSingleViewPrompt({
    basePrompt,
    view: 'front',
    locale: job.data.locale,
    artStylePrompt,
  })
  const frontCosKey = await generateReferenceImage({
    job,
    imageIndex: 0,
    userId: job.data.userId,
    imageModel,
    prompt: frontPrompt,
    referenceImages: useReferenceImages ? allReferenceImages : undefined,
    falApiKey,
    keyPrefix,
    ...(isProject ? { labelText: characterName } : {}),
  })
  if (!frontCosKey) {
    throw new Error('正面图生成失败')
  }

  const frontSignedUrl = getSignedUrl(frontCosKey, VIEW_REFERENCE_TTL_SECONDS)
  const description = await analyzeGeneratedFrontView({
    job,
    analysisModel,
    frontImageUrl: frontSignedUrl,
    isProject,
  })

  await reportTaskProgress(job, 55, {
    stage: 'reference_to_character_generate_side',
    stageLabel: '生成角色侧面图',
    displayMode: 'detail',
  })
  const sidePrompt = buildSingleViewPrompt({
    basePrompt,
    view: 'side',
    locale: job.data.locale,
    artStylePrompt,
    frontDescription: description,
  })
  const sideReferenceImages = [
    ...(useReferenceImages ? allReferenceImages : []),
    frontSignedUrl,
  ]
  const sideCosKey = await generateReferenceImage({
    job,
    imageIndex: 1,
    userId: job.data.userId,
    imageModel,
    prompt: sidePrompt,
    referenceImages: sideReferenceImages,
    falApiKey,
    keyPrefix,
    ...(isProject ? { labelText: characterName } : {}),
  })

  await reportTaskProgress(job, 75, {
    stage: 'reference_to_character_generate_back',
    stageLabel: '生成角色背面图',
    displayMode: 'detail',
  })
  const backPrompt = buildSingleViewPrompt({
    basePrompt,
    view: 'back',
    locale: job.data.locale,
    artStylePrompt,
    frontDescription: description,
  })
  const sideSignedUrl = sideCosKey ? getSignedUrl(sideCosKey, VIEW_REFERENCE_TTL_SECONDS) : null
  const backReferenceImages = [
    ...(useReferenceImages ? allReferenceImages : []),
    frontSignedUrl,
    ...(sideSignedUrl ? [sideSignedUrl] : []),
  ]
  const backCosKey = await generateReferenceImage({
    job,
    imageIndex: 2,
    userId: job.data.userId,
    imageModel,
    prompt: backPrompt,
    referenceImages: backReferenceImages,
    falApiKey,
    keyPrefix,
    ...(isProject ? { labelText: characterName } : {}),
  })

  const successfulCosKeys = [
    frontCosKey,
    sideCosKey,
    backCosKey,
  ].filter((item): item is string => Boolean(item))

  if (successfulCosKeys.length < REFERENCE_TO_CHARACTER_VIEW_COUNT) {
    throw new Error('角色正面、侧面、背面图片未全部生成成功')
  }

  await assertTaskActive(job, 'reference_to_character_persist')
  if (isBackgroundJob && appearanceId) {
    if (isAssetHub) {
      await prisma.globalCharacterAppearance.update({
        where: { id: appearanceId },
        data: {
          imageUrl: successfulCosKeys[0],
          imageUrls: encodeImageUrls(successfulCosKeys),
          description: description || undefined,
        },
      })
    } else {
      await prisma.characterAppearance.update({
        where: { id: appearanceId },
        data: {
          imageUrl: successfulCosKeys[0],
          imageUrls: encodeImageUrls(successfulCosKeys),
          description: description || undefined,
        },
      })
    }
    await reportTaskProgress(job, 96, {
      stage: 'reference_to_character_done',
      stageLabel: '参考图转换完成',
      displayMode: 'detail',
    })
    return { success: true }
  }

  const mainCosKey = successfulCosKeys[0]
  const mainSignedUrl = getSignedUrl(mainCosKey, 7 * 24 * 3600)

  await reportTaskProgress(job, 96, {
    stage: 'reference_to_character_done',
    stageLabel: '参考图转换完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    imageUrl: mainSignedUrl,
    cosKey: mainCosKey,
    cosKeys: successfulCosKeys,
    description,
  }
}
