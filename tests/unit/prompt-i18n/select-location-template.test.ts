import { describe, expect, it } from 'vitest'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('select location prompt template', () => {
  it('zh template keeps one canonical reference image per consistent location', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_SELECT_LOCATION, 'zh')

    expect(template).toContain('同一物理地点的不同时间、光线、天气、情绪、镜头状态必须合并为同一个场景资产')
    expect(template).toContain('每个场景只生成 1 条中文环境描述')
    expect(template).toContain('白天、夜晚、雨天、火光、雾气等变化交给分镜/视频提示词表达')
    expect(template).toContain('禁止在场景名中添加时间或状态后缀')
    expect(template).toContain('descriptions 数组必须只包含 1 条描述')
  })

  it('en template keeps one canonical reference image per consistent location', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_SELECT_LOCATION, 'en')

    expect(template).toContain('Merge time-of-day, lighting, weather, mood, and temporary state variants')
    expect(template).toContain('generate exactly 1 wide-angle environment description')
    expect(template).toContain('Day, night, rain, fog, firelight, and similar changes belong in shot/video prompts')
    expect(template).toContain('Do not output multiple time/weather/lighting versions')
    expect(template).toContain('Do not add suffixes such as `_day`, `_night`')
  })
})
