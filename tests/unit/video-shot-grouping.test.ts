import { describe, expect, it } from 'vitest'
import {
  buildMergedVideoPromptSource,
  buildVideoShotGroups,
  findVideoShotGroupForPanel,
} from '@/lib/video-shot-grouping'

describe('video shot grouping', () => {
  const panels = [
    {
      id: 'p1',
      storyboardId: 'sb-1',
      panelIndex: 0,
      location: '客厅',
      characters: JSON.stringify(['张三', '李四']),
      videoPrompt: '两人对视，气氛紧张',
      description: '客厅里两人对峙',
      shotType: '中景',
      cameraMove: '缓慢推进',
      duration: 5,
    },
    {
      id: 'p2',
      storyboardId: 'sb-1',
      panelIndex: 1,
      location: '客厅',
      characters: JSON.stringify(['李四', '张三']),
      videoPrompt: '张三突然转身走向窗边',
      description: '张三移动到窗边',
      shotType: '中近景',
      cameraMove: '跟拍',
      duration: 5,
    },
    {
      id: 'p3',
      storyboardId: 'sb-1',
      panelIndex: 2,
      location: '院子',
      characters: JSON.stringify(['张三', '李四']),
      videoPrompt: '两人冲出房门',
      description: '场景切到院子',
      shotType: '远景',
      cameraMove: '手持',
      duration: 5,
    },
  ]

  it('groups contiguous panels with same location and same characters', () => {
    const groups = buildVideoShotGroups(panels)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.panelIndices).toEqual([0, 1])
    expect(groups[1]?.panelIndices).toEqual([2])
  })

  it('resolves leader group for a follower panel', () => {
    const group = findVideoShotGroupForPanel(panels, 'sb-1', 1)
    expect(group?.leaderPanelIndex).toBe(0)
    expect(group?.panelIndices).toEqual([0, 1])
  })

  it('builds merged prompt source emphasizing motion continuity', () => {
    const group = findVideoShotGroupForPanel(panels, 'sb-1', 0)
    expect(group).toBeTruthy()
    const prompt = buildMergedVideoPromptSource(group!)
    expect(prompt).toContain('连续单镜头视频')
    expect(prompt).toContain('段落1')
    expect(prompt).toContain('段落2')
    expect(prompt).toContain('不要重复描述图片里已经明确的场景布置')
  })
})
