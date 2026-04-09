import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult, VideoGenerateParams } from '../base'
import { BaseVideoGenerator } from '../base'
import { generateHappyHorseVideo } from '@/lib/providers/happyhorse/video'

export class HappyHorseVideoGenerator extends BaseVideoGenerator {
  private readonly providerId: string

  constructor(providerId?: string) {
    super()
    this.providerId = providerId || 'happyhorse'
  }

  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { apiKey, baseUrl } = await getProviderConfig(params.userId, this.providerId)
    return await generateHappyHorseVideo({
      apiKey,
      baseUrl,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      options: {
        ...(params.options || {}),
        provider: this.providerId,
        modelId: typeof params.options?.modelId === 'string'
          ? params.options.modelId
          : 'happyhorse-1.0/video',
      },
    })
  }
}
