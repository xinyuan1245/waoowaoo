import { executeAiTextStep } from '@/lib/ai-runtime'
import { renderAssistantSystemPrompt } from '@/lib/assistant-platform/system-prompts'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'

const logger = createScopedLogger({ module: 'video.prompt-skills' })

const SEEDANCE_2_MODEL_IDS = new Set([
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
])

function sanitizeOptimizedPrompt(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const unfenced = trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim()
  return unfenced.replace(/^["'`]+|["'`]+$/gu, '').trim()
}

export function usesSeedance20VideoSkill(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  return parsed.provider === 'ark' && SEEDANCE_2_MODEL_IDS.has(parsed.modelId)
}

export async function maybeOptimizeVideoPromptForModel(params: {
  userId: string
  projectId: string
  locale: 'zh' | 'en'
  modelKey: string
  analysisModel: string | null
  prompt: string
  durationSeconds?: number
  aspectRatio?: string | null
  generationMode?: 'normal' | 'firstlastframe'
}): Promise<string> {
  const prompt = params.prompt.trim()
  if (!prompt) return params.prompt
  if (!usesSeedance20VideoSkill(params.modelKey)) return params.prompt
  if (!params.analysisModel) return params.prompt

  const systemPrompt = renderAssistantSystemPrompt('seedance-2.0-video', {
    aspectRatio: params.aspectRatio?.trim() || 'unspecified',
    durationSeconds:
      typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds)
        ? String(params.durationSeconds)
        : 'unspecified',
    generationMode: params.generationMode || 'normal',
  })

  try {
    const result = await executeAiTextStep({
      userId: params.userId,
      model: params.analysisModel,
      projectId: params.projectId,
      action: 'seedance_2_video_prompt_optimize',
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      meta: {
        stepId: 'seedance_2_video_prompt_optimize',
        stepTitle: params.locale === 'zh' ? '优化 Seedance 2.0 视频提示词' : 'Optimize Seedance 2.0 video prompt',
        stepIndex: 1,
        stepTotal: 1,
      },
    })

    const optimizedPrompt = sanitizeOptimizedPrompt(result.text)
    return optimizedPrompt || params.prompt
  } catch (error) {
    logger.warn({
      message: 'seedance 2.0 prompt optimization failed, falling back to original prompt',
      details: {
        modelKey: params.modelKey,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return params.prompt
  }
}

function sanitizeComposedPrompt(text: string): string {
  return sanitizeOptimizedPrompt(text)
}

export async function composeVideoPromptWithAgent(params: {
  userId: string
  projectId: string
  locale: 'zh' | 'en'
  analysisModel: string | null
  fallbackPrompt: string
  panelContext: {
    hasReferenceImage: boolean
    imagePrompt: string
    videoPrompt: string
    description: string
    sourceText: string
    shotType: string
    cameraMove: string
    location: string
    characters: unknown
    photographyRules: unknown
    actingNotes: unknown
  }
}): Promise<string> {
  const fallbackPrompt = params.fallbackPrompt.trim()
  if (!fallbackPrompt) return params.fallbackPrompt
  if (!params.analysisModel) return params.fallbackPrompt

  const systemPrompt = params.locale === 'zh'
    ? [
      '你是资深视频提示词整合导演。',
      '任务：将输入中的分镜细化、摄影规则、演技指导、分镜图提示词锚点融合为一个高质量视频生成提示词。',
      '要求：',
      '1. 必须融合，不允许丢弃摄影规则或演技指导。',
      '2. 以镜头语言输出：摄影规则 + 机位景别 + 运镜 + 画面事件 + 角色名 + 动作连续。',
      '3. 分镜图提示词只作为视觉锚点，不重复静态外观堆砌。',
      '4. 输出纯文本，不要 JSON，不要解释，不要标题。',
      '5. 若输入字段冲突，优先保证时序连续、动作连续与空间连续。',
    ].join('\n')
    : [
      'You are a senior cinematic video prompt synthesizer.',
      'Task: fuse storyboard refinement, cinematography rules, acting direction, and storyboard image-anchor prompt into one production-ready video prompt.',
      'Requirements:',
      '1. Preserve cinematography and acting constraints; do not drop them.',
      '2. Output complete cinematic language: camera/framing/movement/scene events/character names/action continuity.',
      '3. Use image prompt as visual anchor; avoid static appearance repetition.',
      '4. Output plain text only, no JSON/explanations/headings.',
      '5. Resolve conflicts by preserving temporal/action/spatial continuity.',
    ].join('\n')

  try {
    const result = await executeAiTextStep({
      userId: params.userId,
      model: params.analysisModel,
      projectId: params.projectId,
      action: 'video_prompt_compose',
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            panel_context: params.panelContext,
            fallback_prompt: fallbackPrompt,
          }, null, 2),
        },
      ],
      meta: {
        stepId: 'video_prompt_compose',
        stepTitle: params.locale === 'zh' ? '整合视频提示词' : 'Compose Video Prompt',
        stepIndex: 1,
        stepTotal: 1,
      },
    })

    const composed = sanitizeComposedPrompt(result.text)
    return composed || params.fallbackPrompt
  } catch (error) {
    logger.warn({
      message: 'video prompt compose failed, falling back to deterministic prompt',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return params.fallbackPrompt
  }
}
