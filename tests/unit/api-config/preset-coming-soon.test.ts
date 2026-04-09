import { describe, expect, it } from 'vitest'
import {
  PRESET_MODELS,
  encodeModelKey,
  isPresetComingSoonModel,
  isPresetComingSoonModelKey,
} from '@/app/[locale]/profile/components/api-config/types'

describe('api-config preset coming soon', () => {
  it('registers Nano Banana 2 under Google AI Studio presets', () => {
    const model = PRESET_MODELS.find(
      (entry) => entry.provider === 'google' && entry.modelId === 'gemini-3.1-flash-image-preview',
    )
    expect(model).toBeDefined()
    expect(model?.name).toBe('Nano Banana 2')
  })

  it('registers Seedance 2.0 and Seedance 2.0 Fast as preset video models', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'ark' && entry.type === 'video')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual(expect.arrayContaining([
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
    ]))
  })

  it('does not mark live preset models as coming soon', () => {
    const modelKey = encodeModelKey('ark', 'doubao-seedance-2-0-260128')
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-2-0-260128')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('does not mark normal preset models as coming soon', () => {
    const modelKey = encodeModelKey('ark', 'doubao-seedance-2-0-fast-260128')
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-2-0-fast-260128')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('keeps existing live preset models non-coming-soon', () => {
    const modelKey = encodeModelKey('ark', 'doubao-seedance-1-5-pro-251215')
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-1-5-pro-251215')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('registers Bailian Wan i2v preset models', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'bailian' && entry.type === 'video')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual(expect.arrayContaining([
      'wan2.7-i2v',
      'wan2.6-i2v-flash',
      'wan2.6-i2v',
      'wan2.5-i2v-preview',
      'wan2.2-i2v-plus',
      'wan2.2-kf2v-flash',
      'wanx2.1-kf2v-plus',
    ]))
  })

  it('registers Kimi K2.5 under Moonshot presets', () => {
    const model = PRESET_MODELS.find(
      (entry) => entry.provider === 'moonshot' && entry.modelId === 'kimi-k2.5',
    )

    expect(model).toBeDefined()
    expect(model?.name).toBe('Kimi K2.5')
  })

  it('registers APIMart OpenAI-compatible preset text models', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'apimart' && entry.type === 'llm')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual(expect.arrayContaining([
      'gpt-5',
      'gpt-5-mini',
      'claude-sonnet-4-5-20250929',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'deepseek-chat',
    ]))
  })

  it('registers APIMart OpenAI-compatible preset image and video models with templates', () => {
    const imageModels = PRESET_MODELS.filter((entry) => entry.provider === 'apimart' && entry.type === 'image')
    const videoModels = PRESET_MODELS.filter((entry) => entry.provider === 'apimart' && entry.type === 'video')

    expect(imageModels.map((entry) => entry.modelId)).toEqual(expect.arrayContaining([
      'gpt-4o-image',
      'gpt-image-1',
      'gpt-image-1.5',
      'seedream-4-5',
      'seedream-5-0-lite',
      'nano-banana-pro',
      'nano-banana-2',
    ]))
    expect(videoModels.map((entry) => entry.modelId)).toEqual(expect.arrayContaining([
      'sora-2',
      'sora-2-pro',
      'veo-3.1',
      'kling-v2.5-turbo-pro',
      'hailuo-02',
    ]))
    expect(imageModels.every((entry) => entry.compatMediaTemplate?.mediaType === 'image')).toBe(true)
    expect(videoModels.every((entry) => entry.compatMediaTemplate?.mediaType === 'video')).toBe(true)
  })
})
