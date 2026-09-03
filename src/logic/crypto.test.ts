import { describe, it, expect, beforeEach } from 'vitest'
import { installChromeMock } from '../test/chrome-mock'
import { encryptValue, decryptValue } from './crypto'

beforeEach(() => {
  installChromeMock()
})

describe('AES-GCM API Key 加密', () => {
  it('roundtrip：密文可解回明文', async () => {
    const enc = await encryptValue('sk-test-123456')
    expect(enc).not.toContain('sk-test-123456')
    expect(await decryptValue(enc)).toBe('sk-test-123456')
  })

  it('随机 IV：两次加密产生不同密文', async () => {
    const a = await encryptValue('same-input')
    const b = await encryptValue('same-input')
    expect(a).not.toBe(b)
    expect(await decryptValue(a)).toBe('same-input')
    expect(await decryptValue(b)).toBe('same-input')
  })

  it('未加密的旧数据原样返回（兼容）', async () => {
    expect(await decryptValue('legacy-plain-key')).toBe('legacy-plain-key')
  })

  it('空值', async () => {
    expect(await encryptValue('')).toBe('')
    expect(await decryptValue('')).toBe('')
  })
})
