import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'happyhorse',
  apiKey: 'hh-key',
  baseUrl: 'https://happyhorse.app',
})))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getUserModels: vi.fn(async () => []),
}))

import { pollAsyncTask } from '@/lib/async-poll'

describe('async poll HAPPYHORSE video status mapping', () => {
  const providerToken = Buffer.from('happyhorse', 'utf8').toString('base64url')

  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'happyhorse',
      apiKey: 'hh-key',
      baseUrl: 'https://happyhorse.app',
    })
  })

  it('maps PENDING to pending', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: { status: 'PENDING' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await pollAsyncTask(`HAPPYHORSE:VIDEO:${providerToken}:task_pending`, 'user-1')
    expect(result).toEqual({ status: 'pending' })
  })

  it('maps SUCCESS to completed with videoUrl', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: {
          status: 'SUCCESS',
          response: { resultUrls: ['https://cdn.example.com/hh.mp4'] },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await pollAsyncTask(`HAPPYHORSE:VIDEO:${providerToken}:task_done`, 'user-1')
    expect(result).toEqual({
      status: 'completed',
      resultUrl: 'https://cdn.example.com/hh.mp4',
      videoUrl: 'https://cdn.example.com/hh.mp4',
    })
  })
})
