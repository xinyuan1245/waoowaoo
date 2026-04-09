import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateHappyHorseVideo,
  queryHappyHorseVideoStatus,
  submitHappyHorseVideoTask,
} from '@/lib/providers/happyhorse/video'

describe('happyhorse video provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits video task and returns async externalId', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: { task_id: 'hh-task-1', status: 'PENDING' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await generateHappyHorseVideo({
      apiKey: 'hh-key',
      baseUrl: 'https://happyhorse.app',
      imageUrl: 'https://example.com/frame.jpg',
      prompt: 'camera slowly pushes in',
      options: {
        provider: 'happyhorse',
        modelId: 'happyhorse-1.0/video',
        duration: 5,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit] | undefined
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('missing fetch call')

    expect(firstCall[0]).toBe('https://happyhorse.app/api/generate')
    expect(firstCall[1].method).toBe('POST')
    expect(firstCall[1].headers).toEqual({
      Authorization: 'Bearer hh-key',
      'Content-Type': 'application/json',
    })
    expect(firstCall[1].body).toBe(JSON.stringify({
      model: 'happyhorse-1.0/video',
      prompt: 'camera slowly pushes in',
      mode: 'pro',
      image_urls: ['https://example.com/frame.jpg'],
      duration: 5,
      aspect_ratio: '16:9',
      sound: true,
    }))
    expect(result).toEqual({
      success: true,
      async: true,
      requestId: 'hh-task-1',
      externalId: `HAPPYHORSE:VIDEO:${Buffer.from('happyhorse', 'utf8').toString('base64url')}:hh-task-1`,
    })
  })

  it('maps status success response with video url', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: {
          status: 'SUCCESS',
          response: {
            resultUrls: ['https://cdn.example.com/video.mp4'],
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await queryHappyHorseVideoStatus({
      apiKey: 'hh-key',
      taskId: 'hh-task-2',
      baseUrl: 'https://happyhorse.app',
    })

    expect(result).toEqual({
      status: 'SUCCESS',
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.example.com/video.mp4',
    })
  })

  it('maps provider failure status', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: {
          status: 'FAILED',
          error_message: 'quota exceeded',
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await queryHappyHorseVideoStatus({
      apiKey: 'hh-key',
      taskId: 'hh-task-3',
    })

    expect(result).toEqual({
      status: 'FAILED',
      completed: false,
      failed: true,
      error: 'quota exceeded',
    })
  })

  it('rejects unsupported duration before submit', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(
      submitHappyHorseVideoTask({
        apiKey: 'hh-key',
        imageUrl: 'https://example.com/frame.jpg',
        options: {
          provider: 'happyhorse',
          modelId: 'happyhorse-1.0/video',
          prompt: 'test',
          duration: 2,
        },
      }),
    ).rejects.toThrow(/HAPPYHORSE_VIDEO_OPTION_VALUE_UNSUPPORTED/)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
