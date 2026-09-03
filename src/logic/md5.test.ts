import { describe, it, expect } from 'vitest'
import { md5 } from './md5'

describe('md5（百度签名依赖，RFC 1321 已知向量）', () => {
  it('空串', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })
  it('abc', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
  it('长文本', () => {
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6')
  })
})
