import { describe, expect, it } from 'vitest'
import { renderAssistantSystemPrompt } from '@/lib/assistant-platform/system-prompts'

describe('assistant-platform system prompts', () => {
  it('loads api-config-template prompt from lib/prompts/skills and injects providerId', () => {
    const prompt = renderAssistantSystemPrompt('api-config-template', {
      providerId: 'openai-compatible:oa-1',
    })

    expect(prompt).toContain('你是 API 配置助手')
    expect(prompt).toContain('当前 providerId=openai-compatible:oa-1')
    expect(prompt).not.toContain('{{providerId}}')
  })

  it('loads tutorial prompt from lib/prompts/skills', () => {
    const prompt = renderAssistantSystemPrompt('tutorial')

    expect(prompt).toContain('你是产品教程助手')
    expect(prompt).toContain('禁止编造不存在的页面')
  })

  it('loads seedance 2.0 video skill prompt from lib/prompts/skills', () => {
    const prompt = renderAssistantSystemPrompt('seedance-2.0-video', {
      aspectRatio: '16:9',
      durationSeconds: '5',
      generationMode: 'normal',
    })

    expect(prompt).toContain('你是 Seedance 2.0 视频提示词优化技能')
    expect(prompt).toContain('画幅比例：16:9')
    expect(prompt).toContain('视频时长（秒）：5')
    expect(prompt).not.toContain('{{aspectRatio}}')
  })
})
