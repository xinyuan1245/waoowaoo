type AnyRecord = Record<string, unknown>

export type StoryboardPromptPanelInput = {
  description?: string | null
  source_text?: string | null
  location?: string | null
  shot_type?: string | null
  camera_move?: string | null
  characters?: unknown
  video_prompt?: string | null
  image_prompt?: string | null
  photographyPlan?: unknown
  actingNotes?: unknown
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function parseCharacterNames(raw: unknown): string[] {
  const value = typeof raw === 'string'
    ? (() => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return []
      }
    })()
    : raw
  if (!Array.isArray(value)) return []
  const names = value
    .map((item) => {
      if (typeof item === 'string') return cleanText(item)
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return cleanText((item as AnyRecord).name)
      }
      return ''
    })
    .filter(Boolean)
  return Array.from(new Set(names))
}

function parseJsonRecord(raw: unknown): AnyRecord | null {
  if (!raw) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as AnyRecord
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AnyRecord
    }
  } catch {
    return null
  }
  return null
}

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function ensureSentence(value: string, fallback: string): string {
  const text = cleanText(value) || fallback
  return /[。.!?]$/.test(text) ? text : `${text}。`
}

export function buildPersistedStoryboardImagePrompt(panel: StoryboardPromptPanelInput): string {
  const existing = cleanText(panel.image_prompt)
  if (existing) return existing

  const names = parseCharacterNames(panel.characters)
  const subject = cleanText(panel.description) || cleanText(panel.source_text) || '按分镜事件呈现画面主体'
  if (names.length > 0) {
    return `${names.join('、')}：${subject}`
  }
  return ensureSentence(subject, '按分镜事件呈现画面主体。')
}

export function buildPersistedStoryboardVideoPrompt(panel: StoryboardPromptPanelInput): string {
  const existing = cleanText(panel.video_prompt)
  if (existing) return existing

  const names = parseCharacterNames(panel.characters)
  const actionCore = cleanText(panel.source_text) || cleanText(panel.description) || '按分镜事件推进动作'
  if (names.length > 0) {
    return `${names.join('、')}：${actionCore}`
  }
  return ensureSentence(actionCore, '按分镜事件推进动作。')
}

export function buildFusedVideoGenerationPrompt(panel: StoryboardPromptPanelInput): string {
  const names = parseCharacterNames(panel.characters)
  const photography = parseJsonRecord(panel.photographyPlan) || {}
  const actingRows = parseJsonArray(panel.actingNotes)

  const narrative = cleanText(panel.video_prompt)
    || cleanText(panel.description)
    || cleanText(panel.source_text)
    || '按分镜事件推进动作'
  const imageAnchor = cleanText(panel.image_prompt)
  const shotType = cleanText(panel.shot_type)
  const cameraMove = cleanText(panel.camera_move)
  const location = cleanText(panel.location)
  const composition = cleanText(photography.composition)
  const lighting = cleanText(photography.lighting)
  const colorPalette = cleanText(photography.colorPalette)
  const atmosphere = cleanText(photography.atmosphere)
  const technicalNotes = cleanText(photography.technicalNotes)

  const actingLines = actingRows
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return ''
      const record = row as AnyRecord
      const name = cleanText(record.name) || '角色'
      const details = Object.entries(record)
        .filter(([key]) => key !== 'name')
        .map(([, value]) => cleanText(value))
        .filter(Boolean)
        .join('，')
      if (!details) return ''
      return `${name}：${details}`
    })
    .filter(Boolean)

  const sections = [
    ensureSentence(`镜头主叙事：${narrative}`, '镜头主叙事：按分镜事件推进动作。'),
    ensureSentence(`角色名：${names.length > 0 ? names.join('、') : '沿用分镜图角色'}`, '角色名：沿用分镜图角色。'),
    ensureSentence(`景别与运镜：${shotType || '延续分镜景别'}，${cameraMove || '连续运镜'}`, '景别与运镜：延续分镜景别，连续运镜。'),
    ensureSentence(`场景空间：${location || '沿用分镜场景'}`, '场景空间：沿用分镜场景。'),
  ]

  const photographyLine = [
    composition ? `构图=${composition}` : '',
    lighting ? `光线=${lighting}` : '',
    colorPalette ? `色彩=${colorPalette}` : '',
    atmosphere ? `氛围=${atmosphere}` : '',
    technicalNotes ? `技术=${technicalNotes}` : '',
  ].filter(Boolean).join('；')
  if (photographyLine) {
    sections.push(ensureSentence(`摄影规则：${photographyLine}`, '摄影规则：保持镜头语言一致。'))
  }
  if (actingLines.length > 0) {
    sections.push(ensureSentence(`演技指导：${actingLines.join('；')}`, '演技指导：动作与情绪连续。'))
  }
  if (imageAnchor) {
    sections.push(ensureSentence(`分镜图提示词锚点：${imageAnchor}`, '分镜图提示词锚点：保持视觉一致。'))
  }
  sections.push('执行要求：动作连续、表演连续、空间连续；严格继承摄影规则与演技指导，不新增无关设定。')

  return sections.join('\n')
}
