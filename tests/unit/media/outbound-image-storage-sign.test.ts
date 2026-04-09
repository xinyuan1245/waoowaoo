import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'

const getObjectBufferMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/storage', () => ({
  getObjectBuffer: getObjectBufferMock,
  getSignedUrl: vi.fn(
    (key: string, expires: number) => `/api/storage/sign?key=${encodeURIComponent(key)}&expires=${expires}`,
  ),
  toFetchableUrl: vi.fn((value: string) => (
    value.startsWith('/') ? `http://localhost:3000${value}` : value
  )),
}))

vi.stubGlobal('fetch', fetchMock)

function pngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}

describe('outbound image storage sign normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getObjectBufferMock.mockResolvedValue(Buffer.from(pngBytes()))
  })

  it('reads storage sign urls directly without fetching the app route', async () => {
    const dataUrl = await normalizeToBase64ForGeneration(
      'http://127.0.0.1:3000/api/storage/sign?key=images%2Fpanel-candidate.jpg&expires=3600',
    )

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(getObjectBufferMock).toHaveBeenCalledWith('images/panel-candidate.jpg')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
