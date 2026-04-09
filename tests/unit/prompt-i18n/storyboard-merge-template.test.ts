import { describe, expect, it } from 'vitest'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('storyboard merge prompt template', () => {
  it('zh template merges same subject/location panels and moves camera changes into video prompt', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_MERGE, 'zh')

    expect(template).toContain('分镜合并师')
    expect(template).toContain('同一场景 + 同一主要人物/人物组 + 同一道具')
    expect(template).toContain('运镜、景别变化、角色连续动作')
    expect(template).toContain('video_prompt 必须整合')
    expect(template).toContain('禁止为了“需要一个特写”拆出独立分镜图')
  })

  it('en template merges same subject/location panels and moves camera changes into video prompt', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_MERGE, 'en')

    expect(template).toContain('storyboard merge editor')
    expect(template).toContain('same main characters, location, and key props')
    expect(template).toContain('Camera moves, shot-size changes, continuous actions')
    expect(template).toContain('`video_prompt` must merge continuous action')
    expect(template).toContain('Do not split just because a close-up is needed')
  })
})
