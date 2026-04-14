import { describe, expect, it, vi } from 'vitest'
import { runScriptToStoryboardOrchestrator } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'

const PROMPTS = {
  phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
  phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info} {props_description}',
  phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
  phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
  phase4ImagePromptTemplate: '{panels_json} {characters_info} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
  phase5VideoPromptTemplate: '{panels_json} {characters_info} {locations_description} {props_description} {photography_rules_json} {acting_directions_json}',
}

describe('script-to-storyboard orchestrator retry', () => {
  it('retries retryable step failures up to 3 attempts', async () => {
    const attemptsByAction = new Map<string, number>()
    const phase1Metas: Array<{ stepId: string; stepAttempt?: number }> = []

    const runStep = vi.fn(async (meta, _prompt, action: string) => {
      attemptsByAction.set(action, (attemptsByAction.get(action) || 0) + 1)
      if (action === 'storyboard_phase1_plan') {
        phase1Metas.push({ stepId: meta.stepId, stepAttempt: meta.stepAttempt })
        if ((attemptsByAction.get(action) || 0) < 3) throw new TypeError('terminated')
      }

      if (action === 'storyboard_phase2_cinematography') {
        return { text: JSON.stringify([{ panel_number: 1, composition: '居中', lighting: '顶光', color_palette: '冷色', atmosphere: '紧张', technical_notes: 'note' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase3_detail') {
        return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase4_image_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [], image_prompt: '图像提示词' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase5_video_prompt') {
        return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [], image_prompt: '图像提示词', video_prompt: '视频提示词' }]), reasoning: '' }
      }
      return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]), reasoning: '' }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [{ id: 'clip-1', content: '文本', characters: JSON.stringify([{ name: '角色A' }]), location: '场景A', screenplay: null }],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: PROMPTS,
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(attemptsByAction.get('storyboard_phase1_plan')).toBe(3)
    expect(phase1Metas).toEqual([
      { stepId: 'clip_clip-1_phase1', stepAttempt: undefined },
      { stepId: 'clip_clip-1_phase1', stepAttempt: 2 },
      { stepId: 'clip_clip-1_phase1', stepAttempt: 3 },
    ])
  })

  it('enforces topology: phase3 after phase2, and phase5 after phase4', async () => {
    const actionOrder: string[] = []
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      actionOrder.push(action)
      if (action === 'storyboard_phase2_cinematography') {
        return { text: JSON.stringify([{ panel_number: 1, composition: '居中', lighting: '顶光', color_palette: '冷色', atmosphere: '紧张', technical_notes: 'note' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase2_acting') return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      if (action === 'storyboard_phase3_detail') return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]), reasoning: '' }
      if (action === 'storyboard_phase4_image_prompt') return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [], image_prompt: '图像提示词' }]), reasoning: '' }
      if (action === 'storyboard_phase5_video_prompt') return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [], image_prompt: '图像提示词', video_prompt: '视频提示词' }]), reasoning: '' }
      return { text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]), reasoning: '' }
    })

    await runScriptToStoryboardOrchestrator({
      clips: [{ id: 'clip-1', content: '文本', characters: JSON.stringify([{ name: '角色A' }]), location: '场景A', screenplay: null }],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: PROMPTS,
      runStep,
    })

    expect(actionOrder.indexOf('storyboard_phase3_detail')).toBeGreaterThan(actionOrder.indexOf('storyboard_phase2_cinematography'))
    expect(actionOrder.indexOf('storyboard_phase3_detail')).toBeGreaterThan(actionOrder.indexOf('storyboard_phase2_acting'))
    expect(actionOrder.indexOf('storyboard_phase5_video_prompt')).toBeGreaterThan(actionOrder.indexOf('storyboard_phase4_image_prompt'))
  })

  it('falls back to rule index when panel numbers drift between phase2 and phase5', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '镜头1', location: '场景A', source_text: '原文1', characters: [] },
            { panel_number: 2, description: '镜头2', location: '场景A', source_text: '原文2', characters: [] },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 11, composition: '近景', lighting: '侧光', color_palette: '冷色', atmosphere: '压迫', technical_notes: 'note-1' },
            { panel_number: 12, composition: '远景', lighting: '逆光', color_palette: '灰蓝', atmosphere: '寂静', technical_notes: 'note-2' },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 11, characters: [{ name: '角色A', expression: '警觉' }] },
            { panel_number: 12, characters: [{ name: '角色A', expression: '沉默' }] },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase3_detail') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '细化镜头1', location: '场景A', source_text: '原文1', characters: [] },
            { panel_number: 25, description: '细化镜头2', location: '场景A', source_text: '原文2', characters: [] },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase4_image_prompt') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '细化镜头1', location: '场景A', source_text: '原文1', characters: [], image_prompt: '图像提示词1' },
            { panel_number: 25, description: '细化镜头2', location: '场景A', source_text: '原文2', characters: [], image_prompt: '图像提示词2' },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase5_video_prompt') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '细化镜头1', location: '场景A', source_text: '原文1', characters: [], image_prompt: '图像提示词1', video_prompt: '视频提示词1' },
            { panel_number: 25, description: '细化镜头2', location: '场景A', source_text: '原文2', characters: [], image_prompt: '图像提示词2', video_prompt: '视频提示词2' },
          ]),
          reasoning: '',
        }
      }
      throw new Error(`unexpected action: ${action}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [{ id: 'clip-1', content: '文本', characters: JSON.stringify([{ name: '角色A' }]), location: '场景A', screenplay: null }],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: PROMPTS,
      runStep,
    })

    expect(result.clipPanels[0]?.finalPanels).toEqual([
      expect.objectContaining({
        panel_number: 1,
        photographyPlan: expect.objectContaining({ composition: '近景', lighting: '侧光' }),
        actingNotes: [{ name: '角色A', expression: '警觉' }],
      }),
      expect.objectContaining({
        panel_number: 25,
        photographyPlan: expect.objectContaining({ composition: '远景', lighting: '逆光' }),
        actingNotes: [{ name: '角色A', expression: '沉默' }],
      }),
    ])
  })
})
