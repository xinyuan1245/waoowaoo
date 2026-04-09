import { StorageConfigError } from './errors'
import { getInternalBaseUrl } from '@/lib/env'

export const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60

export function resolveBaseUrl(): string {
  return getInternalBaseUrl()
}

export function toFetchableUrl(inputUrl: string): string {
  if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://') || inputUrl.startsWith('data:')) {
    return inputUrl
  }
  if (inputUrl.startsWith('/')) {
    return `${resolveBaseUrl()}${inputUrl}`
  }
  return inputUrl
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new StorageConfigError(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

export function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function normalizeKey(raw: string): string {
  return raw.replace(/^\/+/, '')
}

function decodeRepeatedly(raw: string): string {
  let value = raw
  for (let i = 0; i < 6; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  return value
}

export function extractAppStorageKey(input: string | null | undefined): string | null {
  if (!input) return null

  try {
    const parsed = isHttpUrl(input) || input.startsWith('/')
      ? new URL(input, 'http://localhost')
      : null
    if (!parsed) return null

    if (parsed.pathname === '/api/storage/sign') {
      const key = parsed.searchParams.get('key')
      return key ? normalizeKey(decodeRepeatedly(key)) : null
    }

    if (parsed.pathname.startsWith('/api/files/')) {
      return normalizeKey(decodeRepeatedly(parsed.pathname.slice('/api/files/'.length)))
    }
  } catch {
    return null
  }

  return null
}

export async function withRetry<T>(
  action: () => Promise<T>,
  maxRetries: number,
  delayBaseMs: number,
): Promise<T> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await action()
    } catch (error: unknown) {
      lastError = error
      if (attempt === maxRetries) break
      const delayMs = delayBaseMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError ?? new Error('Unknown retry failure')
}

export async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty response body from storage provider')
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }
  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<unknown>) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk)
      continue
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk))
      continue
    }
    chunks.push(Buffer.from(String(chunk)))
  }

  return Buffer.concat(chunks)
}
