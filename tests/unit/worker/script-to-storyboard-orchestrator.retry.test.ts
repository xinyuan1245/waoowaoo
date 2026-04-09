import { describe, expect, it, vi } from 'vitest'
import { runScriptToStoryboardOrchestrator } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'

describe('script-to-storyboard orchestrator retry', () => {
  it('runs phase1 merge and feeds merged panels into downstream phases', async () => {
    const promptsByAction = new Map<string, string>()
    const runStep = vi.fn(async (_meta, prompt: string, action: string) => {
      promptsByAction.set(action, prompt)
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '张三走进办公室', location: '场景A', source_text: '张三走进办公室', characters: [{ name: '角色A' }] },
            { panel_number: 2, description: '张三在办公室说话特写', location: '场景A', source_text: '张三说话', characters: [{ name: '角色A' }] },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase1_merge') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: '张三站在办公室门口说话',
              location: '场景A',
              source_text: '张三走进办公室 张三说话',
              characters: [{ name: '角色A' }],
              video_prompt: '张三走进办公室后停下说话，镜头从中景缓推到近景',
            },
          ]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_cinematography') {
        return { text: JSON.stringify([{ panel_number: 1, composition: '中景构图' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase3_detail') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: '张三站在办公室门口说话', location: '场景A', source_text: '张三走进办公室 张三说话', characters: [{ name: '角色A' }] },
          ]),
          reasoning: '',
        }
      }
      throw new Error(`unexpected action: ${action}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: '文本',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase1MergeTemplate: 'merge {panels_json} {clip_json} {clip_content} {characters_full_description} {locations_description} {props_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
      runStep,
    })

    expect(runStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'clip_clip-1_phase1_merge' }),
      expect.any(String),
      'storyboard_phase1_merge',
      2800,
    )
    expect(promptsByAction.get('storyboard_phase2_cinematography')).toContain('张三站在办公室门口说话')
    expect(promptsByAction.get('storyboard_phase2_cinematography')).not.toContain('张三在办公室说话特写')
    expect(result.summary.totalPanelCount).toBe(1)
    expect(result.summary.totalStepCount).toBe(7)
  })

  it('retries retryable step failures up to 3 attempts', async () => {
    const attemptsByAction = new Map<string, number>()
    const phase1Metas: Array<{ stepId: string; stepAttempt?: number }> = []
    const runStep = vi.fn(async (meta, _prompt, action: string) => {
      attemptsByAction.set(action, (attemptsByAction.get(action) || 0) + 1)

      if (action === 'storyboard_phase1_plan') {
        phase1Metas.push({ stepId: meta.stepId, stepAttempt: meta.stepAttempt })
        const attempt = attemptsByAction.get(action) || 0
        if (attempt < 3) {
          throw new TypeError('terminated')
        }
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return { text: JSON.stringify([{ panel_number: 1, composition: '居中' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }
      return {
        text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: '文本',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(runStep).toHaveBeenCalled()
    expect(attemptsByAction.get('storyboard_phase1_plan')).toBe(3)
    expect(phase1Metas).toEqual([
      { stepId: 'clip_clip-1_phase1', stepAttempt: undefined },
      { stepId: 'clip_clip-1_phase1', stepAttempt: 2 },
      { stepId: 'clip_clip-1_phase1', stepAttempt: 3 },
    ])
  })

  it('does not retry non-retryable step failure', async () => {
    let callCount = 0
    const runStep = vi.fn(async () => {
      callCount += 1
      throw new Error('SENSITIVE_CONTENT: blocked')
    })

    await expect(
      runScriptToStoryboardOrchestrator({
        clips: [
          {
            id: 'clip-1',
            content: '文本',
            characters: JSON.stringify([{ name: '角色A' }]),
            location: '场景A',
            screenplay: null,
          },
        ],
        novelPromotionData: {
          characters: [{ name: '角色A', appearances: [] }],
          locations: [{ name: '场景A', images: [] }],
        },
        promptTemplates: {
          phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
          phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
          phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
          phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
        },
        runStep,
      }),
    ).rejects.toThrow('SENSITIVE_CONTENT')

    expect(callCount).toBe(1)
  })

  it('does not retry Ark invalid parameter error even when message contains json', async () => {
    let callCount = 0
    const runStep = vi.fn(async () => {
      callCount += 1
      throw new Error(
        'Ark Responses 调用失败: 400 - {"error":{"code":"InvalidParameter","message":"json: unknown field \\"reasoning_effort\\""}}',
      )
    })

    await expect(
      runScriptToStoryboardOrchestrator({
        clips: [
          {
            id: 'clip-1',
            content: '文本',
            characters: JSON.stringify([{ name: '角色A' }]),
            location: '场景A',
            screenplay: null,
          },
        ],
        novelPromotionData: {
          characters: [{ name: '角色A', appearances: [] }],
          locations: [{ name: '场景A', images: [] }],
        },
        promptTemplates: {
          phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
          phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
          phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
          phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
        },
        runStep,
      }),
    ).rejects.toThrow('unknown field')

    expect(callCount).toBe(1)
  })

  it('enforces topology: phase3 runs after both phase2 steps complete', async () => {
    const actionOrder: string[] = []
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      actionOrder.push(action)
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_cinematography') {
        return { text: JSON.stringify([{ panel_number: 1, composition: '居中' }]), reasoning: '' }
      }
      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase3_detail') {
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }
      throw new Error(`unexpected action: ${action}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: '文本',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    const phase3Index = actionOrder.indexOf('storyboard_phase3_detail')
    const phase2CineIndex = actionOrder.indexOf('storyboard_phase2_cinematography')
    const phase2ActingIndex = actionOrder.indexOf('storyboard_phase2_acting')
    expect(phase3Index).toBeGreaterThan(phase2CineIndex)
    expect(phase3Index).toBeGreaterThan(phase2ActingIndex)
  })

  it('limits clip fan-out by configured concurrency', async () => {
    let activePhase1 = 0
    let maxActivePhase1 = 0

    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        activePhase1 += 1
        maxActivePhase1 = Math.max(maxActivePhase1, activePhase1)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activePhase1 -= 1
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([{
            panel_number: 1,
            composition: '居中',
            lighting: '顶光',
            color_palette: '冷色',
            atmosphere: '紧张',
            technical_notes: 'note',
          }]),
          reasoning: '',
        }
      }
      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }
      if (action === 'storyboard_phase3_detail') {
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }
      throw new Error(`unexpected action: ${action}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      concurrency: 1,
      clips: [
        {
          id: 'clip-1',
          content: '文本1',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
        {
          id: 'clip-2',
          content: '文本2',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
        {
          id: 'clip-3',
          content: '文本3',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(3)
    expect(maxActivePhase1).toBe(1)
  })

  it('pipelines clips so one clip can enter phase2 before another clip finishes phase1', async () => {
    let releaseClip1Phase1: (() => void) | null = null
    const clip1Phase1Gate = new Promise<void>((resolve) => {
      releaseClip1Phase1 = resolve
    })
    let clip2Phase2Started = false
    let clip1Phase1ResolvedAfterClip2Phase2 = false

    const runStep = vi.fn(async (meta, _prompt, action: string) => {
      const stepId = String(meta.stepId)

      if (action === 'storyboard_phase1_plan' && stepId === 'clip_clip-1_phase1') {
        await clip1Phase1Gate
        clip1Phase1ResolvedAfterClip2Phase2 = clip2Phase2Started
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头1', location: '场景A', source_text: '原文1', characters: [] }]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase1_plan' && stepId === 'clip_clip-2_phase1') {
        return {
          text: JSON.stringify([{ panel_number: 1, description: '镜头2', location: '场景A', source_text: '原文2', characters: [] }]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography' && stepId === 'clip_clip-2_phase2_cinematography') {
        clip2Phase2Started = true
        releaseClip1Phase1?.()
        return {
          text: JSON.stringify([{ panel_number: 1, composition: '居中', lighting: '顶光', color_palette: '冷色', atmosphere: '紧张', technical_notes: 'note' }]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return { text: JSON.stringify([{ panel_number: 1, characters: [] }]), reasoning: '' }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([{ panel_number: 1, composition: '居中', lighting: '顶光', color_palette: '冷色', atmosphere: '紧张', technical_notes: 'note' }]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase3_detail') {
        return {
          text: JSON.stringify([{ panel_number: 1, description: '细化镜头', location: '场景A', source_text: '原文', characters: [] }]),
          reasoning: '',
        }
      }

      throw new Error(`unexpected action: ${action}:${stepId}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      concurrency: 2,
      clips: [
        {
          id: 'clip-1',
          content: '文本1',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
        {
          id: 'clip-2',
          content: '文本2',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(2)
    expect(clip2Phase2Started).toBe(true)
    expect(clip1Phase1ResolvedAfterClip2Phase2).toBe(true)
  })

  it('falls back to rule index when panel numbers drift between phase2 and phase3', async () => {
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

      throw new Error(`unexpected action: ${action}`)
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: '文本',
          characters: JSON.stringify([{ name: '角色A' }]),
          location: '场景A',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: '角色A', appearances: [] }],
        locations: [{ name: '场景A', images: [] }],
      },
      promptTemplates: {
        phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
        phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
        phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
        phase3DetailTemplate: '{panels_json} {characters_age_gender} {locations_description}',
      },
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
