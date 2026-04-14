import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseStoryboardRetryTarget,
  runScriptToStoryboardAtomicRetry,
} from '@/lib/workers/handlers/script-to-storyboard-atomic-retry'

const listArtifactsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/run-runtime/service', () => ({
  listArtifacts: listArtifactsMock,
}))

const PROMPTS = {
  phase1PlanTemplate: '{clip_content}',
  phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info} {props_description}',
  phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
  phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
  phase4ImagePromptTemplate: '{panels_json} {characters_info} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
  phase5VideoPromptTemplate: '{panels_json} {characters_info} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
}

function seedArtifactsForClip() {
  listArtifactsMock.mockImplementation(async (params: { runId: string; artifactType?: string; refId?: string }) => {
    if (params.refId !== 'clip-1') return []
    if (params.artifactType === 'storyboard.clip.phase1') {
      return [{
        id: 'a1',
        runId: params.runId,
        stepKey: 'clip_clip-1_phase1',
        artifactType: 'storyboard.clip.phase1',
        refId: 'clip-1',
        versionHash: null,
        payload: { panels: [{ panel_number: 1, description: 'p1', location: 'Office', source_text: 'src', characters: [] }] },
        createdAt: '2026-03-03T00:00:00.000Z',
      }]
    }
    if (params.artifactType === 'storyboard.clip.phase2.cine') {
      return [{
        id: 'a2',
        runId: params.runId,
        stepKey: 'clip_clip-1_phase2_cinematography',
        artifactType: 'storyboard.clip.phase2.cine',
        refId: 'clip-1',
        versionHash: null,
        payload: { rules: [{ panel_number: 1, composition: '居中', lighting: '顶光', color_palette: '冷色', atmosphere: '紧张', technical_notes: 'note' }] },
        createdAt: '2026-03-03T00:00:00.000Z',
      }]
    }
    if (params.artifactType === 'storyboard.clip.phase2.acting') {
      return [{
        id: 'a3',
        runId: params.runId,
        stepKey: 'clip_clip-1_phase2_acting',
        artifactType: 'storyboard.clip.phase2.acting',
        refId: 'clip-1',
        versionHash: null,
        payload: { directions: [{ panel_number: 1, characters: [{ name: 'Narrator', expression: 'serious' }] }] },
        createdAt: '2026-03-03T00:00:00.000Z',
      }]
    }
    if (params.artifactType === 'storyboard.clip.phase3') {
      return [{
        id: 'a4',
        runId: params.runId,
        stepKey: 'clip_clip-1_phase3_detail',
        artifactType: 'storyboard.clip.phase3',
        refId: 'clip-1',
        versionHash: null,
        payload: { panels: [{ panel_number: 1, description: 'p1', location: 'Office', source_text: 'src', characters: [] }] },
        createdAt: '2026-03-03T00:00:00.000Z',
      }]
    }
    return []
  })
}

describe('script-to-storyboard atomic retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('解析 clip+phase stepKey (含 phase4/phase5)', () => {
    expect(parseStoryboardRetryTarget('clip_clip-1_phase3_detail')?.phase).toBe('phase3_detail')
    expect(parseStoryboardRetryTarget('clip_clip-1_phase4_image_prompt')?.phase).toBe('phase4_image_prompt')
    expect(parseStoryboardRetryTarget('clip_clip-1_phase5_video_prompt')?.phase).toBe('phase5_video_prompt')
    expect(parseStoryboardRetryTarget('voice_analyze')).toBeNull()
  })

  it('phase3 重试会级联执行 phase4/phase5 并产出最终面板', async () => {
    seedArtifactsForClip()
    const actions: string[] = []
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      actions.push(action)
      if (action === 'storyboard_phase3_detail') {
        return { text: JSON.stringify([{ panel_number: 1, description: 'phase3-new', location: 'Office', source_text: 'src', characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase4_image_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: 'phase3-new', location: 'Office', source_text: 'src', characters: [], image_prompt: '图像提示词' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase5_video_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: 'phase3-new', location: 'Office', source_text: 'src', characters: [], image_prompt: '图像提示词', video_prompt: '视频提示词' }]), reasoning: '' }
      }
      throw new Error(`unexpected action ${action}`)
    })

    const result = await runScriptToStoryboardAtomicRetry({
      runId: 'run-1',
      retryTarget: { stepKey: 'clip_clip-1_phase3_detail', clipId: 'clip-1', phase: 'phase3_detail' },
      retryStepAttempt: 4,
      clip: { id: 'clip-1', content: 'clip content', characters: JSON.stringify([{ name: 'Narrator' }]), location: 'Office', screenplay: null },
      clipIndex: 0,
      totalClipCount: 1,
      novelPromotionData: {
        characters: [{ name: 'Narrator', appearances: [] }],
        locations: [{ name: 'Office', images: [{ description: 'room desc' }] }],
      },
      promptTemplates: PROMPTS,
      runStep,
    })

    expect(actions).toEqual(['storyboard_phase3_detail', 'storyboard_phase4_image_prompt', 'storyboard_phase5_video_prompt'])
    expect(result.phase5PanelsByClipId['clip-1']?.[0]).toEqual(expect.objectContaining({
      image_prompt: '图像提示词',
      video_prompt: '视频提示词',
    }))
    expect(result.clipPanels[0]?.finalPanels[0]).toEqual(expect.objectContaining({
      description: 'phase3-new',
      photographyPlan: expect.objectContaining({ composition: '居中' }),
      actingNotes: [{ name: 'Narrator', expression: 'serious' }],
    }))
  })

  it('phase4 重试会继续执行 phase5', async () => {
    seedArtifactsForClip()
    const actions: string[] = []
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      actions.push(action)
      if (action === 'storyboard_phase4_image_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: 'p', location: 'Office', source_text: 'src', characters: [], image_prompt: 'ip' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase5_video_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: 'p', location: 'Office', source_text: 'src', characters: [], image_prompt: 'ip', video_prompt: 'vp' }]), reasoning: '' }
      }
      throw new Error(`unexpected action ${action}`)
    })

    const result = await runScriptToStoryboardAtomicRetry({
      runId: 'run-2',
      retryTarget: { stepKey: 'clip_clip-1_phase4_image_prompt', clipId: 'clip-1', phase: 'phase4_image_prompt' },
      retryStepAttempt: 2,
      clip: { id: 'clip-1', content: 'clip content', characters: JSON.stringify([{ name: 'Narrator' }]), location: 'Office', screenplay: null },
      clipIndex: 0,
      totalClipCount: 1,
      novelPromotionData: {
        characters: [{ name: 'Narrator', appearances: [] }],
        locations: [{ name: 'Office', images: [{ description: 'room desc' }] }],
      },
      promptTemplates: PROMPTS,
      runStep,
    })

    expect(actions).toEqual(['storyboard_phase4_image_prompt', 'storyboard_phase5_video_prompt'])
    expect(result.phase4PanelsByClipId['clip-1']?.[0]?.image_prompt).toBe('ip')
    expect(result.phase5PanelsByClipId['clip-1']?.[0]?.video_prompt).toBe('vp')
  })
})
