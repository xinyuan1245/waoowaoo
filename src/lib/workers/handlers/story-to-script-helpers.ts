import { prisma } from '@/lib/prisma'
import { removeLocationPromptSuffix } from '@/lib/constants'
import type { StoryToScriptClipCandidate } from '@/lib/novel-promotion/story-to-script/orchestrator'
import { seedProjectLocationBackedImageSlots } from '@/lib/assets/services/location-backed-assets'
import { normalizeLocationAvailableSlots } from '@/lib/location-available-slots'
import { resolvePropVisualDescription } from '@/lib/assets/prop-description'

export type AnyObj = Record<string, unknown>

export function parseEffort(value: unknown): 'minimal' | 'low' | 'medium' | 'high' | null {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') return value
  return null
}

export function parseTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.7
  return Math.max(0, Math.min(2, value))
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export function resolveClipRecordId(clipMap: Map<string, string>, clipId: string): string | null {
  return clipMap.get(clipId) || null
}

type CharacterCreateDb = {
  novelPromotionCharacter: typeof prisma.novelPromotionCharacter
}

type LocationCreateDb = {
  novelPromotionLocation: typeof prisma.novelPromotionLocation
  locationImage: typeof prisma.locationImage
}

type ClipPersistDb = {
  novelPromotionClip: typeof prisma.novelPromotionClip
}

export async function persistAnalyzedCharacters(params: {
  projectInternalId: string
  existingNames: Set<string>
  analyzedCharacters: Record<string, unknown>[]
  db?: CharacterCreateDb
}) {
  const created: Array<{ id: string; name: string }> = []
  const db = params.db ?? prisma

  for (const item of params.analyzedCharacters) {
    const name = asString(item.name).trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (params.existingNames.has(key)) continue

    const profileData = {
      role_level: item.role_level,
      archetype: item.archetype,
      personality_tags: toStringArray(item.personality_tags),
      era_period: item.era_period,
      social_class: item.social_class,
      occupation: item.occupation,
      costume_tier: item.costume_tier,
      suggested_colors: toStringArray(item.suggested_colors),
      primary_identifier: item.primary_identifier,
      visual_keywords: toStringArray(item.visual_keywords),
      gender: item.gender,
      age_range: item.age_range,
    }

    const createdRow = await db.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: params.projectInternalId,
        name,
        aliases: JSON.stringify(toStringArray(item.aliases)),
        introduction: asString(item.introduction) || null,
        profileData: JSON.stringify(profileData),
        profileConfirmed: false,
      },
      select: {
        id: true,
        name: true,
      },
    })

    params.existingNames.add(key)
    created.push(createdRow)
  }

  return created
}

export async function persistAnalyzedLocations(params: {
  projectInternalId: string
  existingNames: Set<string>
  analyzedLocations: Record<string, unknown>[]
  db?: LocationCreateDb
}) {
  const created: Array<{ id: string; name: string }> = []
  const invalidKeywords = ['幻想', '抽象', '无明确', '空间锚点', '未说明', '不明确']
  const db = params.db ?? prisma

  for (const item of params.analyzedLocations) {
    const name = asString(item.name).trim()
    if (!name) continue

    const descriptions = toStringArray(item.descriptions)
    const mergedDescriptions = descriptions.length > 0
      ? descriptions
      : (asString(item.description) ? [asString(item.description)] : [])

    const firstDescription = mergedDescriptions[0] || ''
    const isInvalid = invalidKeywords.some((keyword) =>
      name.includes(keyword) || firstDescription.includes(keyword),
    )
    if (isInvalid) continue

    const key = name.toLowerCase()
    if (params.existingNames.has(key)) continue

    const location = await db.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: params.projectInternalId,
        name,
        summary: asString(item.summary) || null,
      },
      select: {
        id: true,
        name: true,
      },
    })

    const cleanDescriptions = mergedDescriptions
      .map((desc) => removeLocationPromptSuffix(desc || ''))
      .slice(0, 1)
    const availableSlots = normalizeLocationAvailableSlots(item.available_slots)
    await seedProjectLocationBackedImageSlots({
      locationId: location.id,
      descriptions: cleanDescriptions,
      fallbackDescription: asString(item.summary) || name,
      availableSlots,
      locationImageModel: db.locationImage,
    })

    params.existingNames.add(key)
    created.push(location)
  }

  return created
}

export async function persistAnalyzedProps(params: {
  projectInternalId: string
  existingNames: Set<string>
  analyzedProps: Record<string, unknown>[]
  db?: LocationCreateDb
}) {
  const created: Array<{ id: string; name: string }> = []
  const db = params.db ?? prisma

  for (const item of params.analyzedProps) {
    const name = asString(item.name).trim()
    const summary = asString(item.summary).trim()
    const description = resolvePropVisualDescription({
      name,
      summary,
      description: asString(item.description).trim(),
    })
    if (!name || !summary || !description) continue

    const key = name.toLowerCase()
    if (params.existingNames.has(key)) continue

    const prop = await db.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: params.projectInternalId,
        name,
        summary,
        assetKind: 'prop',
      },
      select: {
        id: true,
        name: true,
      },
    })
    await seedProjectLocationBackedImageSlots({
      locationId: prop.id,
      descriptions: [description],
      fallbackDescription: description,
      availableSlots: [],
      locationImageModel: db.locationImage,
    })

    params.existingNames.add(key)
    created.push(prop)
  }

  return created
}

export async function persistClips(params: {
  episodeId: string
  clipList: StoryToScriptClipCandidate[]
  db?: ClipPersistDb
}) {
  const db = params.db ?? prisma
  const clipModel = db.novelPromotionClip as unknown as {
    update: (args: { where: { id: string }; data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>
    create: (args: { data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>
    findMany: typeof db.novelPromotionClip.findMany
    deleteMany: typeof db.novelPromotionClip.deleteMany
  }
  const existing = await clipModel.findMany({
    where: { episodeId: params.episodeId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const createdClips: Array<{ id: string; clipKey: string }> = []
  for (let index = 0; index < params.clipList.length; index += 1) {
    const clip = params.clipList[index]
    const target = existing[index]
    if (target) {
      const updated = await clipModel.update({
        where: { id: target.id },
        data: {
          startText: clip.startText,
          endText: clip.endText,
          summary: clip.summary,
          location: clip.location,
          characters: clip.characters.length > 0 ? JSON.stringify(clip.characters) : null,
          props: clip.props.length > 0 ? JSON.stringify(clip.props) : null,
          content: clip.content,
        },
        select: {
          id: true,
        },
      })
      createdClips.push({ id: updated.id, clipKey: clip.id })
      continue
    }

    const created = await clipModel.create({
      data: {
        episodeId: params.episodeId,
        startText: clip.startText,
        endText: clip.endText,
        summary: clip.summary,
        location: clip.location,
        characters: clip.characters.length > 0 ? JSON.stringify(clip.characters) : null,
        props: clip.props.length > 0 ? JSON.stringify(clip.props) : null,
        content: clip.content,
      },
      select: {
        id: true,
      },
    })
    createdClips.push({ id: created.id, clipKey: clip.id })
  }

  const staleClipIds = existing.slice(params.clipList.length).map((item) => item.id)
  if (staleClipIds.length > 0) {
    await clipModel.deleteMany({
      where: {
        id: {
          in: staleClipIds,
        },
      },
    })
  }

  return createdClips
}
