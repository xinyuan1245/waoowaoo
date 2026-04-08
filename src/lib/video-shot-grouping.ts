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

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
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

function buildCharacterSignature(value: PanelCharacterInput): string {
  return Array.from(new Set(parseCharacterArray(value))).join('|')
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

export function buildMergedVideoPromptSource<TPanel extends VideoShotGroupingPanel>(group: VideoShotGroup<TPanel>): string {
  if (group.members.length <= 1) {
    const panel = group.members[0]
    return (panel?.videoPrompt || panel?.description || '').trim()
  }

  const lines = group.members.map((panel, index) => {
    const parts = [
      panel.videoPrompt?.trim() || '',
      panel.description?.trim() || '',
    ].filter(Boolean)
    const shotType = panel.shotType?.trim()
    const cameraMove = panel.cameraMove?.trim()
    const prefix = [
      `段落${index + 1}`,
      shotType ? `景别${shotType}` : '',
      cameraMove ? `运镜${cameraMove}` : '',
    ].filter(Boolean).join('，')
    return `${prefix}：${parts.join('；')}`
  }).filter(Boolean)

  return [
    '这是一个连续单镜头视频，参考首帧图片即可，不要重复描述图片里已经明确的场景布置、人物外观和静态构图。',
    '请重点表现连续动作、运镜变化、节奏推进和镜头内事件衔接。',
    ...lines,
  ].join('\n')
}
