import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveLlmRuntimeModelMock = vi.hoisted(() =>
  vi.fn(async () => ({
    provider: 'bailian',
    modelId: 'qwen3.5-plus',
    modelKey: 'bailian::qwen3.5-plus',
  })),
)

const completeBailianLlmMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_stream_mock',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.5-plus',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'stream-ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 2,
      total_tokens: 4,
    },
  })),
)

const completeSiliconFlowLlmMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('siliconflow should not be called')
  }),
)

const runOpenAICompatChatCompletionMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('openai-compat should not be called')
  }),
)

const getProviderConfigMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').getProviderConfig>(async () => ({
    id: 'bailian',
    name: 'Alibaba Bailian',
    apiKey: 'bl-key',
    baseUrl: undefined,
    gatewayRoute: 'official' as const,
  })),
)

const logLlmRawInputMock = vi.hoisted(() => vi.fn())
const logLlmRawOutputMock = vi.hoisted(() => vi.fn())
const recordCompletionUsageMock = vi.hoisted(() => vi.fn())
const streamTextMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('ai sdk stream should not be called')
  }),
)
const openAIStreamCreateMock = vi.hoisted(() =>
  vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: {
              content: 'deepseek-stream-ok',
            },
          },
        ],
      }
    },
  })),
)

vi.mock('@/lib/model-gateway', () => ({
  resolveModelGatewayRoute: vi.fn(() => 'official'),
  runOpenAICompatChatCompletion: runOpenAICompatChatCompletionMock,
}))

vi.mock('ai', () => ({
  streamText: streamTextMock,
  generateText: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: openAIStreamCreateMock,
      },
    }
  },
}))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getProviderKey: vi.fn((providerId: string) => providerId),
}))

vi.mock('@/lib/providers/bailian', () => ({
  completeBailianLlm: completeBailianLlmMock,
}))

vi.mock('@/lib/providers/siliconflow', () => ({
  completeSiliconFlowLlm: completeSiliconFlowLlmMock,
}))

vi.mock('@/lib/llm/runtime-shared', () => ({
  completionUsageSummary: vi.fn(() => ({ promptTokens: 2, completionTokens: 2 })),
  llmLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  logLlmRawInput: logLlmRawInputMock,
  logLlmRawOutput: logLlmRawOutputMock,
  recordCompletionUsage: recordCompletionUsageMock,
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletionStream } from '@/lib/llm/chat-stream'

describe('llm chatCompletionStream official provider branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams from bailian completion result and exits early', async () => {
    const onChunk = vi.fn()
    const onComplete = vi.fn()

    const completion = await chatCompletionStream(
      'user-1',
      'bailian::qwen3.5-plus',
      [{ role: 'user', content: 'hello' }],
      {},
      {
        onChunk,
        onComplete,
      },
    )

    expect(completeBailianLlmMock).toHaveBeenCalledWith({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
      baseUrl: undefined,
      temperature: 0.7,
    })
    expect(runOpenAICompatChatCompletionMock).not.toHaveBeenCalled()
    expect(completeSiliconFlowLlmMock).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith('stream-ok', undefined)
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        delta: 'stream-ok',
      }),
    )
    expect(completion.choices[0]?.message?.content).toBe('stream-ok')
    expect(recordCompletionUsageMock).toHaveBeenCalledTimes(1)
  })

  it('uses native openai sdk stream path for deepseek official provider', async () => {
    resolveLlmRuntimeModelMock.mockResolvedValueOnce({
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      modelKey: 'deepseek::deepseek-chat',
    })
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'ds-key',
      baseUrl: 'https://api.deepseek.com',
      gatewayRoute: 'official' as const,
    })

    const onChunk = vi.fn()
    const onComplete = vi.fn()

    const completion = await chatCompletionStream(
      'user-1',
      'deepseek::deepseek-chat',
      [{ role: 'user', content: 'hello deepseek' }],
      {},
      { onChunk, onComplete },
    )

    expect(streamTextMock).not.toHaveBeenCalled()
    expect(openAIStreamCreateMock).toHaveBeenCalledWith({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hello deepseek' }],
      temperature: 0.7,
      stream: true,
    })
    expect(onComplete).toHaveBeenCalledWith('deepseek-stream-ok', undefined)
    expect(completion.choices[0]?.message?.content).toBe('deepseek-stream-ok')
  })

  it('uses moonshot native sdk stream path with thinking params instead of temperature', async () => {
    resolveLlmRuntimeModelMock.mockResolvedValueOnce({
      provider: 'moonshot',
      modelId: 'kimi-k2.5',
      modelKey: 'moonshot::kimi-k2.5',
    })
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'moonshot',
      name: 'Moonshot',
      apiKey: 'ms-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      gatewayRoute: 'official' as const,
    })

    const onChunk = vi.fn()
    const onComplete = vi.fn()

    const completion = await chatCompletionStream(
      'user-1',
      'moonshot::kimi-k2.5',
      [{ role: 'user', content: 'hello moonshot' }],
      { reasoning: false, temperature: 0.1 },
      { onChunk, onComplete },
    )

    expect(streamTextMock).not.toHaveBeenCalled()
    expect(openAIStreamCreateMock).toHaveBeenCalledWith({
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'hello moonshot' }],
      stream: true,
      thinking: { type: 'disabled' },
    })
    expect(onComplete).toHaveBeenCalledWith('deepseek-stream-ok', undefined)
    expect(completion.choices[0]?.message?.content).toBe('deepseek-stream-ok')
  })
})
