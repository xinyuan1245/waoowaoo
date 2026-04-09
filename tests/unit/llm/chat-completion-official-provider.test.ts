import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveLlmRuntimeModelMock = vi.hoisted(() =>
  vi.fn(async () => ({
    provider: 'bailian',
    modelId: 'qwen3.5-flash',
    modelKey: 'bailian::qwen3.5-flash',
  })),
)

const completeBailianLlmMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_mock',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.5-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
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

const llmLoggerInfoMock = vi.hoisted(() => vi.fn())
const llmLoggerWarnMock = vi.hoisted(() => vi.fn())
const logLlmRawInputMock = vi.hoisted(() => vi.fn())
const logLlmRawOutputMock = vi.hoisted(() => vi.fn())
const recordCompletionUsageMock = vi.hoisted(() => vi.fn())
const generateTextMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('ai sdk should not be called')
  }),
)
const openAICompletionCreateMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_deepseek_mock',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'deepseek-ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    },
  })),
)

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  getInternalLLMStreamCallbacks: vi.fn(() => null),
}))

vi.mock('ai', () => ({
  generateText: generateTextMock,
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: openAICompletionCreateMock,
      },
    }
  },
}))

vi.mock('@/lib/model-gateway', () => ({
  resolveModelGatewayRoute: vi.fn(() => 'official'),
  runOpenAICompatChatCompletion: runOpenAICompatChatCompletionMock,
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
  _ulogError: vi.fn(),
  _ulogWarn: vi.fn(),
  completionUsageSummary: vi.fn(() => ({ promptTokens: 1, completionTokens: 1 })),
  isRetryableError: vi.fn(() => false),
  llmLogger: {
    info: llmLoggerInfoMock,
    warn: llmLoggerWarnMock,
  },
  logLlmRawInput: logLlmRawInputMock,
  logLlmRawOutput: logLlmRawOutputMock,
  recordCompletionUsage: recordCompletionUsageMock,
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletion } from '@/lib/llm/chat-completion'

describe('llm chatCompletion official provider branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns completion from bailian official provider without falling through to baseUrl checks', async () => {
    const result = await chatCompletion(
      'user-1',
      'bailian::qwen3.5-flash',
      [{ role: 'user', content: 'hello' }],
      { temperature: 0.1 },
    )

    expect(completeBailianLlmMock).toHaveBeenCalledWith({
      modelId: 'qwen3.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
      baseUrl: undefined,
      temperature: 0.1,
    })
    expect(runOpenAICompatChatCompletionMock).not.toHaveBeenCalled()
    expect(completeSiliconFlowLlmMock).not.toHaveBeenCalled()
    expect(result.choices[0]?.message?.content).toBe('ok')
    expect(recordCompletionUsageMock).toHaveBeenCalledTimes(1)
  })

  it('uses native openai sdk path for deepseek official provider', async () => {
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

    const result = await chatCompletion(
      'user-1',
      'deepseek::deepseek-chat',
      [{ role: 'user', content: 'hello deepseek' }],
      { temperature: 0.1 },
    )

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(openAICompletionCreateMock).toHaveBeenCalledWith({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hello deepseek' }],
      temperature: 0.1,
    })
    expect(result.choices[0]?.message?.content).toBe('deepseek-ok')
  })

  it('uses moonshot native sdk path with thinking params instead of temperature', async () => {
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

    const result = await chatCompletion(
      'user-1',
      'moonshot::kimi-k2.5',
      [{ role: 'user', content: 'hello moonshot' }],
      { reasoning: false, temperature: 0.1 },
    )

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(openAICompletionCreateMock).toHaveBeenCalledWith({
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'hello moonshot' }],
      thinking: { type: 'disabled' },
    })
    expect(result.choices[0]?.message?.content).toBe('deepseek-ok')
  })
})
