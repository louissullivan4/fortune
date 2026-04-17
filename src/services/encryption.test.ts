import { describe, it, expect, beforeEach } from 'vitest'
import { encrypt, decrypt } from './encryption.js'

const VALID_KEY = 'a'.repeat(64)

beforeEach(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY
})

describe('encrypt', () => {
  it('returns a colon-delimited string with three hex parts', () => {
    const parts = encrypt('hello').split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatch(/^[0-9a-f]+$/)
    expect(parts[1]).toMatch(/^[0-9a-f]+$/)
    expect(parts[2]).toMatch(/^[0-9a-f]+$/)
  })

  it('uses a random IV so the same plaintext produces different ciphertext each call', () => {
    const a = encrypt('same input')
    const b = encrypt('same input')
    expect(a).not.toBe(b)
  })

  it('produces a non-empty ciphertext segment', () => {
    const [, , ciphertext] = encrypt('test').split(':')
    expect(ciphertext.length).toBeGreaterThan(0)
  })

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY env var is required')
  })

  it('throws when ENCRYPTION_KEY has the wrong byte length', () => {
    process.env.ENCRYPTION_KEY = 'deadbeef'
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be 32 bytes')
  })
})

describe('decrypt', () => {
  it('round-trips arbitrary plaintext', () => {
    const plaintext = 'my-secret-api-key-12345'
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  it('round-trips unicode and special characters', () => {
    const text = '€100 — αβγ 🔑'
    expect(decrypt(encrypt(text))).toBe(text)
  })

  it('throws on ciphertext with wrong number of segments', () => {
    expect(() => decrypt('only:two')).toThrow('Invalid ciphertext format')
    expect(() => decrypt('one')).toThrow('Invalid ciphertext format')
  })

  it('throws when the auth tag has been tampered with', () => {
    const ct = encrypt('original')
    const parts = ct.split(':')
    const tampered = parts[0] + ':' + '0'.repeat(parts[1].length) + ':' + parts[2]
    expect(() => decrypt(tampered)).toThrow()
  })
})
