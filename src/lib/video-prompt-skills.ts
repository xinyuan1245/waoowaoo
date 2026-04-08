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
