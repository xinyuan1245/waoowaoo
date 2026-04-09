import type { GenerateResult } from '@/lib/generators/base'
import { toFetchableUrl } from '@/lib/storage/utils'

export interface HappyHorseVideoGenerateOptions {
  provider: string
  modelId: string
  modelKey?: string
  prompt?: string
  mode?: string
  duration?: number
  aspectRatio?: string
  sound?: boolean
  generateAudio?: boolean
}

export interface HappyHorseVideoGenerateParams {
  apiKey: string
  baseUrl?: string
  imageUrl: string
  prompt?: string
  options: HappyHorseVideoGenerateOptions
}

export interface HappyHorseStatusResponse {
  code?: number
  message?: string
  data?: {
    task_id?: string
    status?: string
    response?: {
      resultUrls?: unknown
    }
    error_message?: string | null
  }
}

const HAPPYHORSE_DEFAULT_BASE_URL = 'https://happyhorse.app'
const HAPPYHORSE_MODEL_ID = 'happyhorse-1.0/video'
const HAPPYHORSE_DURATION_MIN = 3
const HAPPYHORSE_DURATION_MAX = 15

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveHappyHorseUrl(baseUrl: string | undefined, path: string): string {
  const base = readTrimmedString(baseUrl) || HAPPYHORSE_DEFAULT_BASE_URL
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

function assertNoUnsupportedOptions(options: HappyHorseVideoGenerateOptions): void {
  const allowed = new Set([
    'provider',
    'modelId',
    'modelKey',
    'prompt',
    'mode',
    'duration',
    'aspectRatio',
    'sound',
    'generateAudio',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowed.has(key)) {
      throw new Error(`HAPPYHORSE_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function buildSubmitBody(params: HappyHorseVideoGenerateParams): Record<string, unknown> {
  assertNoUnsupportedOptions(params.options)
  const modelId = readTrimmedString(params.options.modelId)
  if (modelId !== HAPPYHORSE_MODEL_ID) {
    throw new Error(`HAPPYHORSE_VIDEO_MODEL_UNSUPPORTED: ${modelId || '(empty)'}`)
  }

  const prompt = readTrimmedString(params.prompt) || readTrimmedString(params.options.prompt)
  if (!prompt) {
    throw new Error('HAPPYHORSE_VIDEO_PROMPT_REQUIRED')
  }

  const body: Record<string, unknown> = {
    model: modelId,
    prompt,
    mode: readTrimmedString(params.options.mode) || 'pro',
  }

  const imageUrl = readTrimmedString(params.imageUrl)
  if (imageUrl) {
    body.image_urls = [toFetchableUrl(imageUrl)]
  }

  const duration = params.options.duration
  if (duration !== undefined) {
    if (!Number.isInteger(duration) || duration < HAPPYHORSE_DURATION_MIN || duration > HAPPYHORSE_DURATION_MAX) {
      throw new Error(`HAPPYHORSE_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${duration}`)
    }
    body.duration = duration
  }

  const aspectRatio = readTrimmedString(params.options.aspectRatio)
  if (aspectRatio) {
    body.aspect_ratio = aspectRatio
  }

  if (typeof params.options.sound === 'boolean') {
    body.sound = params.options.sound
  } else if (typeof params.options.generateAudio === 'boolean') {
    body.sound = params.options.generateAudio
  }

  return body
}

async function parseJsonResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const raw = await response.text()
  if (!raw) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`${errorPrefix}_INVALID_JSON`)
  }
}

function readProviderError(data: unknown): string {
  if (!data || typeof data !== 'object') return 'unknown error'
  const record = data as Record<string, unknown>
  const message = readTrimmedString(record.message)
  if (message) return message
  const error = readTrimmedString(record.error)
  if (error) return error
  const nestedData = record.data
  if (nestedData && typeof nestedData === 'object') {
    const nested = nestedData as Record<string, unknown>
    return readTrimmedString(nested.error_message) || 'unknown error'
  }
  return 'unknown error'
}

export async function submitHappyHorseVideoTask(params: HappyHorseVideoGenerateParams): Promise<string> {
  const response = await fetch(resolveHappyHorseUrl(params.baseUrl, '/api/generate'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSubmitBody(params)),
  })
  const data = await parseJsonResponse<{
    code?: number
    message?: string
    data?: { task_id?: string; status?: string }
  }>(response, 'HAPPYHORSE_VIDEO_SUBMIT_RESPONSE')

  if (!response.ok || (typeof data.code === 'number' && data.code !== 200)) {
    throw new Error(`HAPPYHORSE_VIDEO_SUBMIT_FAILED(${response.status}): ${readProviderError(data)}`)
  }

  const taskId = readTrimmedString(data.data?.task_id)
  if (!taskId) {
    throw new Error('HAPPYHORSE_VIDEO_TASK_ID_MISSING')
  }
  return taskId
}

export async function queryHappyHorseVideoStatus(params: {
  apiKey: string
  baseUrl?: string
  taskId: string
}): Promise<{
  status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED'
  completed: boolean
  failed: boolean
  resultUrl?: string
  error?: string
}> {
  const url = new URL(resolveHappyHorseUrl(params.baseUrl, '/api/status'))
  url.searchParams.set('task_id', params.taskId)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
  })
  const data = await parseJsonResponse<HappyHorseStatusResponse>(response, 'HAPPYHORSE_VIDEO_STATUS_RESPONSE')

  if (!response.ok || (typeof data.code === 'number' && data.code !== 200)) {
    return {
      status: 'FAILED',
      completed: false,
      failed: true,
      error: `HAPPYHORSE_VIDEO_STATUS_FAILED(${response.status}): ${readProviderError(data)}`,
    }
  }

  const status = readTrimmedString(data.data?.status).toUpperCase()
  if (status === 'SUCCESS' || status === 'COMPLETED') {
    const urls = data.data?.response?.resultUrls
    const resultUrl = Array.isArray(urls)
      ? urls.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim()
      : undefined
    return {
      status: 'SUCCESS',
      completed: true,
      failed: false,
      resultUrl,
    }
  }

  if (status === 'FAILED' || status === 'FAILURE' || status === 'ERROR') {
    return {
      status: 'FAILED',
      completed: false,
      failed: true,
      error: readTrimmedString(data.data?.error_message) || readTrimmedString(data.message) || 'HappyHorse task failed',
    }
  }

  return {
    status: 'IN_PROGRESS',
    completed: false,
    failed: false,
  }
}

export function makeHappyHorseExternalId(providerId: string, taskId: string): string {
  const providerToken = Buffer.from(providerId, 'utf8').toString('base64url')
  return `HAPPYHORSE:VIDEO:${providerToken}:${taskId}`
}

export async function generateHappyHorseVideo(params: HappyHorseVideoGenerateParams): Promise<GenerateResult> {
  const taskId = await submitHappyHorseVideoTask(params)
  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: makeHappyHorseExternalId(params.options.provider, taskId),
  }
}
