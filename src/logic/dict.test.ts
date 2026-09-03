import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installChromeMock } from '../test/chrome-mock'
import { localDict, isValidWord, isSingleChineseChar } from './dict'

const DICT_DATA = {
  go: { p: 'gəu', t: 'v. 去；行驶\\nn. 尝试', e: 'd:went/g:gone/i:going/3:goes' },
  went: { l: 'go' },
  running: { l: 'run' },
  run: { t: 'v. 跑；运转' },
}

beforeEach(() => {
  installChromeMock()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(DICT_DATA),
  })))
})

describe('本地词典', () => {
  it('直接命中：释义 + 音标 + 时态变形', async () => {
    const r = await localDict('go')
    expect(r).not.toBeNull()
    expect(r!.definitions!.length).toBeGreaterThan(0)
    expect(r!.phonetic?.uk).toBe('gəu')
    expect(r!.presents).toContain('went')
    expect(r!.presents).toContain('going')
  })

  it('不规则变形 went → go（内嵌 l 字段）', async () => {
    const r = await localDict('went')
    expect(r).not.toBeNull()
    expect(JSON.stringify(r!.definitions)).toContain('去')
  })

  it('规则变形 running → run（双写辅音还原）', async () => {
    const r = await localDict('running')
    expect(r).not.toBeNull()
    expect(JSON.stringify(r!.definitions)).toContain('跑')
  })

  it('查不到的词返回 null', async () => {
    expect(await localDict('zzzznotaword')).toBeNull()
  })
})

describe('词形判断', () => {
  it('isValidWord', () => {
    expect(isValidWord('hello')).toBe(true)
    expect(isValidWord('well-known')).toBe(true)
    expect(isValidWord('hello world')).toBe(false)
    expect(isValidWord('这')).toBe(false)
    expect(isValidWord('a'.repeat(31))).toBe(false)
  })

  it('isSingleChineseChar', () => {
    expect(isSingleChineseChar('中')).toBe(true)
    expect(isSingleChineseChar('中文')).toBe(false)
    expect(isSingleChineseChar('a')).toBe(false)
  })
})
