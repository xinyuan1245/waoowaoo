import { describe, expect, it } from 'vitest'
import { createStorageProvider } from '@/lib/storage/factory'
import { StorageConfigError, StorageProviderNotImplementedError } from '@/lib/storage/errors'

describe('storage factory', () => {
  it('creates local provider when STORAGE_TYPE=local', () => {
    const provider = createStorageProvider({ storageType: 'local' })
    expect(provider.kind).toBe('local')
  })

  it('creates minio provider when STORAGE_TYPE=minio', () => {
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000'
    process.env.MINIO_REGION = 'us-east-1'
    process.env.MINIO_BUCKET = 'waoowaoo'
    process.env.MINIO_ACCESS_KEY = 'minioadmin'
    process.env.MINIO_SECRET_KEY = 'minioadmin'
    process.env.MINIO_FORCE_PATH_STYLE = 'true'

    const provider = createStorageProvider({ storageType: 'minio' })
    expect(provider.kind).toBe('minio')
  })

  it('extracts app signed storage keys for minio provider', () => {
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000'
    process.env.MINIO_REGION = 'us-east-1'
    process.env.MINIO_BUCKET = 'waoowaoo'
    process.env.MINIO_ACCESS_KEY = 'minioadmin'
    process.env.MINIO_SECRET_KEY = 'minioadmin'
    process.env.MINIO_FORCE_PATH_STYLE = 'true'

    const provider = createStorageProvider({ storageType: 'minio' })
    expect(provider.extractStorageKey('http://127.0.0.1:3000/api/storage/sign?key=images%2Fpanel-candidate.jpg&expires=3600'))
      .toBe('images/panel-candidate.jpg')
    expect(provider.extractStorageKey('/api/files/images%2Fpanel-candidate.jpg'))
      .toBe('images/panel-candidate.jpg')
  })

  it('extracts app signed storage keys for local provider', () => {
    const provider = createStorageProvider({ storageType: 'local' })
    expect(provider.extractStorageKey('/api/storage/sign?key=images%2Fpanel-candidate.jpg&expires=3600'))
      .toBe('images/panel-candidate.jpg')
    expect(provider.extractStorageKey('http://localhost:3000/api/files/images%2Fpanel-candidate.jpg'))
      .toBe('images/panel-candidate.jpg')
  })

  it('throws explicit not-implemented error when STORAGE_TYPE=cos', () => {
    expect(() => createStorageProvider({ storageType: 'cos' })).toThrow(StorageProviderNotImplementedError)
  })

  it('throws config error on unknown storage type', () => {
    expect(() => createStorageProvider({ storageType: 'unknown' })).toThrow(StorageConfigError)
  })
})
