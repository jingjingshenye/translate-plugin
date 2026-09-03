import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installChromeMock } from '../test/chrome-mock'
import { pickAiId, aiCompareTranslate } from './translate'

beforeEach(() => {
  installChromeMock()
})

describe('pickAiId（AI 对照源选择）', () => {
  it('off 返回空', () => {
    expect(pickAiId('off', { zai: 'k' })).toBe('')
  })

  it('auto 取 AI_META 顺序中第一个已配 Key 的源', () => {
    expect(pickAiId('auto', {})).toBe('')
    expect(pickAiId('auto', { zai: 'k' })).toBe('zai')
    expect(pickAiId('auto', { openai: 'k', deepseek: 'k' })).toBe('deepseek')
    expect(pickAiId('auto', { zai: 'k', openai: 'k' })).toBe('openai') // AI_META 声明顺序优先
  })

  it('指定源有 Key 才可用，无 Key 返回空', () => {
    expect(pickAiId('gemini', { gemini: 'k' })).toBe('gemini')
    expect(pickAiId('gemini', {})).toBe('')
  })

  it('空 mode 视为 auto', () => {
    expect(pickAiId('', { zai: 'k' })).toBe('zai')
  })
})

describe('aiCompareTranslate', () => {
  it('未配置任何 Key 时返回 null（不发请求）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await aiCompareTranslate('hello', 'en', 'zh')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('off 模式返回 null', async () => {
    const { localStore } = installChromeMock()
    localStore.qt_ai_compare = 'off'
    localStore.qt_api_keys = { zai: 'plain-key' } // 明文兼容旧数据
    expect(await aiCompareTranslate('hello', 'en', 'zh')).toBeNull()
  })

  it('有 Key 的源直连翻译并返回结果（不 fallback 到免费源）', async () => {
    const { localStore } = installChromeMock()
    localStore.qt_api_keys = { zai: 'plain-key' }
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      urls.push(String(url))
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'AI 译文' } }] }) }
    }))
    const r = await aiCompareTranslate('ai-compare-test', 'en', 'zh')
    expect(r?.text).toBe('AI 译文')
    expect(r?.api).toBe('zai')
    // 只请求了智谱，没有触达任何免费源
    expect(urls.every(u => u.includes('bigmodel'))).toBe(true)
  })
})
