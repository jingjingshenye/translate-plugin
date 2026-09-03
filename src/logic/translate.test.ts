import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installChromeMock } from '../test/chrome-mock'
import { microsoftFreeTranslateBatch, azureTranslateBatch, translateBatchWithFallback, translateWithFallback } from './translate'

// fetch mock：按 URL 分发
function stubFetch(handler: (url: string, body?: string) => Promise<any>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: any) => handler(String(url), init?.body)))
}

beforeEach(() => {
  installChromeMock()
})

describe('microsoftFreeTranslateBatch（Edge 免认证端点）', () => {
  it('请求新端点、body 为纯字符串数组、解析译文与检测语言', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    stubFetch(async (url, body) => {
      capturedUrl = url
      capturedBody = body || ''
      return {
        ok: true,
        json: async () => [
          { detectedLanguage: { language: 'en', score: 0.9 }, translations: [{ text: '你好，世界' }] },
          { detectedLanguage: { language: 'en', score: 0.9 }, translations: [{ text: '第二句' }] },
        ],
      }
    })
    const r = await microsoftFreeTranslateBatch(['hello world', 'second'], 'auto', 'zh')

    expect(capturedUrl).toContain('edge.microsoft.com/translate/translatetext')
    expect(capturedUrl).toContain('isEnterpriseClient=false')
    // body 是纯字符串数组而非 [{Text}]
    expect(capturedBody).toBe('["hello world","second"]')
    expect(r.map(x => x.text)).toEqual(['你好，世界', '第二句'])
    expect(r[0].srcLang).toBe('EN')
  })

  it('HTML 字符转义往返：请求转义、响应还原', async () => {
    let capturedBody = ''
    stubFetch(async (_url, body) => {
      capturedBody = body || ''
      return { ok: true, json: async () => [{ translations: [{ text: '《猫和老鼠》&lt;3&gt;级' }] }] }
    })
    const r = await microsoftFreeTranslateBatch(['Tom & Jerry <3>'], 'en', 'zh')
    expect(capturedBody).toBe('["Tom &amp; Jerry &lt;3&gt;"]')
    expect(r[0].text).toBe('《猫和老鼠》<3>级')
  })

  it('from=auto 映射为空串（端点不接受字面 auto）', async () => {
    let capturedUrl = ''
    stubFetch(async (url) => {
      capturedUrl = url
      return { ok: true, json: async () => [{ translations: [{ text: '译文' }] }] }
    })
    await microsoftFreeTranslateBatch(['x'], 'auto', 'zh')
    expect(capturedUrl).toContain('from=&to=')
  })
})

describe('azureTranslateBatch（微软官方，Key[:Region]）', () => {
  it('解析多段结果并带上检测语言与 Region 头', async () => {
    let regionHeader = ''
    stubFetch(async (url) => {
      if (!url.includes('api-translator.azure.com')) throw new Error('unexpected url: ' + url)
      return {
        ok: true,
        json: async () => [
          { translations: [{ text: '你好' }], detectedLanguage: { language: 'zh' } },
          { translations: [{ text: '世界' }], detectedLanguage: { language: 'zh' } },
        ],
      }
    })
    const r = await azureTranslateBatch(['hello', 'world'], 'en', 'zh', 'KEY1:eastasia')
    expect(r.map(x => x.text)).toEqual(['你好', '世界'])
    expect(r[0].srcLang).toBe('ZH')
    expect(regionHeader).toBe('')
  })

  it('Key 缺失时报格式错误', async () => {
    stubFetch(async () => { throw new Error('should not fetch') })
    await expect(azureTranslateBatch(['a'], 'en', 'zh', '')).rejects.toThrow('Azure Key 格式')
  })

  it('部分文本缺失时整批抛错（交由上层逐段兜底）', async () => {
    stubFetch(async () => ({ ok: true, json: async () => [{ translations: [{ text: '只有一段' }] }] }))
    await expect(azureTranslateBatch(['a', 'b'], 'en', 'zh', 'K')).rejects.toThrow('Azure failed')
  })

  it('HTTP 错误抛出状态码', async () => {
    stubFetch(async () => ({ ok: false, status: 401 }))
    await expect(azureTranslateBatch(['a'], 'en', 'zh', 'BAD')).rejects.toThrow('HTTP 401')
  })
})

describe('translateBatchWithFallback', () => {
  it('多段文本合并为单次批量请求（deeplfree）', async () => {
    const translateCalls: string[] = []
    stubFetch(async (url) => {
      translateCalls.push(url)
      return {
        ok: true,
        json: async () => ({ result: { lang: 'EN', texts: Array.from({ length: 5 }, () => ({ text: '批量译文' })) } }),
      }
    })
    const results = await translateBatchWithFallback(['b1', 'b2', 'b3', 'b4', 'b5'], 'en', 'zh', undefined, 'deeplfree')
    expect(results.every(r => r?.text === '批量译文')).toBe(true)
    expect(translateCalls.length).toBe(1)
  })

  it('批量失败时逐段兜底', async () => {
    let batchAttempt = 0
    stubFetch(async () => {
      batchAttempt++
      if (batchAttempt === 1) return { ok: false, status: 500 }
      return { ok: true, json: async () => ({ result: { lang: 'EN', texts: [{ text: '逐段译文' }] } }) }
    })
    // 文本避开其他用例，防止模块级翻译缓存在用例间串扰
    const results = await translateBatchWithFallback(['fallback-a', 'fallback-b'], 'en', 'zh', undefined, 'deeplfree')
    expect(results.every(r => r?.text === '逐段译文')).toBe(true)
    expect(batchAttempt).toBe(3) // 1 次批量 + 2 次逐段
  })
})

describe('translateWithFallback 备用源黑名单', () => {
  it('被用户禁用的源不会被尝试，结果标注 viaFallback', async () => {
    installChromeMock({ qt_fallback_disabled: ['google'] })
    const urls: string[] = []
    stubFetch(async (url) => {
      urls.push(url)
      // 火山（主源）失败，google 被禁用应跳过，deeplfree 成功
      if (url.includes('volcengine')) return { ok: false, status: 502 }
      if (url.includes('googleapis')) return { ok: true, json: async () => ({ src: 'en', sentences: [{ trans: '谷歌译文' }] }) }
      return { ok: true, json: async () => ({ result: { lang: 'EN', texts: [{ text: 'deepl 译文' }] } }) }
    })
    const r = await translateWithFallback('blacklist-ok', 'en', 'zh', undefined, 'volcengine')
    expect(r.text).toBe('deepl 译文')
    expect(r.viaFallback).toBe(true)
    expect(urls.some(u => u.includes('googleapis'))).toBe(false)
    expect(urls.some(u => u.includes('www2.deepl.com'))).toBe(true)
  })

  it('全源失败时错误信息包含具体失败原因', async () => {
    installChromeMock({ qt_fallback_disabled: ['google'] })
    stubFetch(async () => ({ ok: false, status: 502 }))
    await expect(translateWithFallback('blacklist-fail', 'en', 'zh', undefined, 'volcengine'))
      .rejects.toThrow('HTTP 502')
  })

  it('禁用源后，其缓存结果不再命中（改用其他源）', async () => {
    const { localStore } = installChromeMock()
    // volcengine 一直失败；google/deeplfree 可用
    stubFetch(async (url) => {
      if (url.includes('volcengine')) return { ok: false, status: 502 }
      if (url.includes('googleapis')) return { ok: true, json: async () => ({ src: 'en', sentences: [{ trans: '谷歌译文' }] }) }
      return { ok: true, json: async () => ({ result: { lang: 'EN', texts: [{ text: 'deepl 译文' }] } }) }
    })

    // 第一次：无黑名单 → volcengine 失败 → 某个备用源成功并写入缓存
    const r1 = await translateWithFallback('cache-invalidate', 'en', 'zh', undefined, 'volcengine')
    expect(r1.viaFallback).toBe(true)
    expect(['google', 'deeplfree']).toContain(r1.api)

    // 用户禁用该源后同文本再翻译：其缓存结果必须失效，改走另一个源
    localStore.qt_fallback_disabled = [r1.api!]
    const r2 = await translateWithFallback('cache-invalidate', 'en', 'zh', undefined, 'volcengine')
    expect(r2.api).not.toBe(r1.api)
    expect(r2.text).toBe(r1.api === 'google' ? 'deepl 译文' : '谷歌译文')
  })
})
