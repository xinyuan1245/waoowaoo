type PanelCharacterInput = unknown

export interface VideoShotGroupingPanel {
  id?: string | null
  storyboardId: string
  panelIndex: number
  location?: string | null
  characters?: PanelCharacterInput
  videoPrompt?: string | null
  description?: string | null
  shotType?: string | null
  cameraMove?: string | null
  duration?: number | null
  imageUrl?: string | null
  videoUrl?: string | null
  videoGenerationMode?: 'normal' | 'firstlastframe' | null
  videoTaskRunning?: boolean
  videoErrorCode?: string | null
  videoErrorMessage?: string | null
  videoModel?: string | null
}

export interface VideoShotGroup<TPanel extends VideoShotGroupingPanel = VideoShotGroupingPanel> {
  key: string
  storyboardId: string
  leaderPanelIndex: number
  panelIndices: number[]
  members: TPanel[]
}

function cleanInlineText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeText(value: unknown): string {
  return cleanInlineText(value).toLowerCase()
}

function normalizeCharacterName(value: unknown): string {
  if (typeof value === 'string') return normalizeText(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return normalizeText(record.name)
  }
  return ''
}

function parseCharacterArray(value: PanelCharacterInput): string[] {
  const raw = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return []
      }
    })()
    : value

  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => normalizeCharacterName(item))
    .filter(Boolean)
    .sort()
}

function parseCharacterDisplayNames(value: PanelCharacterInput): string[] {
  const raw = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return []
      }
    })()
    : value

  if (!Array.isArray(raw)) return []

  const names = raw
    .map((item) => {
      if (typeof item === 'string') return cleanInlineText(item)
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>
        return cleanInlineText(record.name)
      }
      return ''
    })
    .filter(Boolean)

  return Array.from(new Set(names))
}

function buildCharacterSignature(value: PanelCharacterInput): string {
  return Array.from(new Set(parseCharacterArray(value))).join('|')
}

function describePanelForPrompt(panel: VideoShotGroupingPanel): string {
  const shotType = cleanInlineText(panel.shotType)
  const cameraMove = cleanInlineText(panel.cameraMove)
  const location = cleanInlineText(panel.location)
  const characters = parseCharacterDisplayNames(panel.characters)
  const visual = cleanInlineText(panel.videoPrompt) || cleanInlineText(panel.description)
  const characterText = characters.length > 0 ? characters.join('、') : '沿用参考图中的角色'
  const shotText = shotType || '延续上镜头景别'
  const moveText = cameraMove || '平滑连续运镜'
  const locationText = location || '参考图所在空间'
  const visualText = visual || '按参考图构图延续当前事件'

  return [
    '摄影规则：严格参考分镜图作为视觉锚点，保持角色身份与空间关系一致，不重复年龄和静态外观描述。',
    `运镜：${moveText}。景别与视角：${shotText}。`,
    `画面：${locationText}。`,
    `角色名：${characterText}。`,
    `动作连续：${visualText}，动作衔接自然，不跳帧、不突兀切断。`,
  ].join('\n')
}

function canAutoMergePair<TPanel extends VideoShotGroupingPanel>(left: TPanel, right: TPanel): boolean {
  if (left.storyboardId !== right.storyboardId) return false
  if (right.panelIndex !== left.panelIndex + 1) return false

  const leftLocation = normalizeText(left.location)
  const rightLocation = normalizeText(right.location)
  if (!leftLocation || !rightLocation || leftLocation !== rightLocation) return false

  const leftCharacters = buildCharacterSignature(left.characters)
  const rightCharacters = buildCharacterSignature(right.characters)
  if (!leftCharacters || !rightCharacters || leftCharacters !== rightCharacters) return false

  return true
}

export function buildVideoShotGroups<TPanel extends VideoShotGroupingPanel>(panels: TPanel[]): VideoShotGroup<TPanel>[] {
  if (panels.length === 0) return []

  const sorted = [...panels].sort((left, right) => {
    if (left.storyboardId !== right.storyboardId) {
      return left.storyboardId.localeCompare(right.storyboardId)
    }
    return left.panelIndex - right.panelIndex
  })

  const groups: VideoShotGroup<TPanel>[] = []
  let currentMembers: TPanel[] = [sorted[0]]

  const flush = () => {
    if (currentMembers.length === 0) return
    const leader = currentMembers[0]
    groups.push({
      key: `${leader.storyboardId}:${leader.panelIndex}`,
      storyboardId: leader.storyboardId,
      leaderPanelIndex: leader.panelIndex,
      panelIndices: currentMembers.map((item) => item.panelIndex),
      members: currentMembers,
    })
    currentMembers = []
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const previous = currentMembers[currentMembers.length - 1]
    if (previous && canAutoMergePair(previous, current)) {
      currentMembers.push(current)
      continue
    }
    flush()
    currentMembers = [current]
  }

  flush()
  return groups
}

export function findVideoShotGroupForPanel<TPanel extends VideoShotGroupingPanel>(
  panels: TPanel[],
  storyboardId: string,
  panelIndex: number,
): VideoShotGroup<TPanel> | null {
  const groups = buildVideoShotGroups(panels)
  return groups.find((group) =>
    group.storyboardId === storyboardId
    && group.panelIndices.includes(panelIndex),
  ) || null
}

export function buildPanelVideoPromptSource(panel: VideoShotGroupingPanel): string {
  return describePanelForPrompt(panel)
}

export function buildMergedVideoPromptSource<TPanel extends VideoShotGroupingPanel>(group: VideoShotGroup<TPanel>): string {
  if (group.members.length <= 1) {
    const panel = group.members[0]
    return panel ? describePanelForPrompt(panel) : ''
  }

  const segmentLines = group.members.map((panel, index) => {
    const shotType = cleanInlineText(panel.shotType) || '延续上镜头景别'
    const cameraMove = cleanInlineText(panel.cameraMove) || '平滑连续运镜'
    const location = cleanInlineText(panel.location) || '参考图所在空间'
    const characters = parseCharacterDisplayNames(panel.characters)
    const characterText = characters.length > 0 ? characters.join('、') : '沿用参考图中的角色'
    const action = cleanInlineText(panel.videoPrompt) || cleanInlineText(panel.description) || '延续当前事件动作'
    return `段落${index + 1}：景别视角=${shotType}；运镜=${cameraMove}；画面=${location}；角色=${characterText}；动作=${action}`
  }).filter(Boolean)

  return [
    '摄影规则：这是连续单镜头视频，严格参考首帧图作为视觉锚点，保持角色身份与空间关系一致，不重复年龄和静态外观描述。',
    '运镜规则：段落之间必须连续衔接，镜头语言完整，节奏递进清晰。',
    '动作连续规则：前一段动作结果要成为后一段动作起点，避免断裂。',
    ...segmentLines,
  ].join('\n')
}
