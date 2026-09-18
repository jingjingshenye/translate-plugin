// 词典模块 — 完全对齐 kiss-translator 实现
// 本地词典：运行时从 extension/dict/dict.json 加载（共享，不重复打包）
// Bing 词典：抓取 HTML 页面 + DOMParser 解析
// 有道词典：抓取有道 jsonapi_s 接口
// 发音：Bing 从页面提取 mp3 / 有道用百度 TTS

export interface DictResult {
  word: string
  phonetic?: { uk?: string; us?: string }
  definitions?: Array<{ pos: string; def: string }>
  sentences?: Array<{ en: string; zh: string }>
  audio?: { uk?: string; us?: string }
  presents?: string[]      // 时态变形
  ecs?: Array<{ pos: string; lis: string[] }>  // 英汉双解
}

type DictEntry = { p?: string; pos?: string; t: string; e?: string; c?: number; tag?: string; l?: string }
type LocalDict = Record<string, DictEntry>

// ============================================
// 本地词典加载（运行时 fetch，不打包进 bundle）
// ============================================
let _dictCache: LocalDict | null = null
let _dictLoading: Promise<LocalDict> | null = null

async function loadDict(): Promise<LocalDict> {
  if (_dictCache) return _dictCache
  if (_dictLoading) return _dictLoading
  _dictLoading = (async () => {
    try {
      const url = chrome.runtime.getURL('dict/dict.json')
      const res = await fetch(url)
      const text = await res.text()
      _dictCache = JSON.parse(text)
      return _dictCache!
    } catch (e) {
      console.warn('[QT] Failed to load local dict:', e)
      _dictCache = null // 失败时清空，允许下次重试
      return {}
    } finally {
      _dictLoading = null
    }
  })()
  return _dictLoading
}

// 检测是否为英文单词
export function isValidWord(text: string): boolean {
  return /^[a-zA-Z][a-zA-Z\-]*$/.test(text) && text.length <= 30
}

// 检测是否为单个中文字符
export function isSingleChineseChar(text: string): boolean {
  return /^[\u4e00-\u9fa5]$/.test(text)
}

// ============================================
// 词形还原：查 dict 内嵌的 l 字段（覆盖不规则动词如 went→go）
// ============================================
async function tryLemma(word: string, dict: LocalDict): Promise<string | null> {
  const w = word.toLowerCase()

  // 1. 直接匹配
  if (dict[w]) {
    // 如果命中的是词形条目（有 l 字段，无 t 字段），跳转到原形
    if (dict[w].l && !dict[w].t) return dict[w].l!
    return w
  }

  // 2. 正则后备（映射表未覆盖的规则变形）
  const rules: Array<[RegExp, string[]]> = [
    [/ies$/, ['y']],
    [/ves$/, ['f', 'fe']],
    [/ses$/, ['s', 'se']],
    [/xes$/, ['x']],
    [/ches$/, ['ch']],
    [/shes$/, ['sh']],
    [/oes$/, ['o']],
    [/s$/, ['']],
    [/ed$/, ['', 'e']],
    [/ied$/, ['y']],
    [/ting$/, ['t', 'te']],
    [/ing$/, ['', 'e']],
    [/ying$/, ['ie', 'y']],
    [/ly$/, ['']],
    [/er$/, ['', 'e']],
    [/ier$/, ['y']],
    [/est$/, ['', 'e']],
    [/liest$/, ['ly', 'y']],
    [/able$/, ['', 'e']],
    [/ible$/, ['']],
    [/tion$/, ['te', 't']],
    [/sion$/, ['se', 'd']],
    [/ment$/, ['']],
    [/ness$/, ['']],
    [/ful$/, ['']],
    [/less$/, ['']],
    [/ous$/, ['']],
    [/ive$/, ['', 'e']],
    [/al$/, ['']],
    [/ial$/, ['']],
    [/ual$/, ['']],
    [/ian$/, ['']],
    [/ist$/, ['']],
    [/ism$/, ['']],
    [/ity$/, ['e', 'y']],
    [/ance$/, ['']],
    [/ence$/, ['']],
    [/ant$/, ['']],
    [/ent$/, ['']],
    [/ure$/, ['']],
    [/ate$/, ['']],
    [/ize$/, ['']],
    [/ise$/, ['']],
    [/ify$/, ['y']],
    [/fy$/, ['y']],
  ]

  for (const [pattern, bases] of rules) {
    if (pattern.test(w)) {
      for (const base of bases) {
        const candidate = w.replace(pattern, base)
        if (candidate && candidate.length >= 2 && dict[candidate]) return candidate
      }
    }
  }

  // 3. 双写辅音词尾：running → run
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) {
    const single = w.slice(0, -1)
    if (dict[single]) return single
  }

  return null
}

// ============================================
// 本地词典查询（瞬间响应，无需网络）
// ============================================
export async function localDict(text: string): Promise<DictResult | null> {
  const dict = await loadDict()
  const key = text.toLowerCase().trim()

  // 统一经 tryLemma 找到原形（同时处理直接命中词形条目和正则后备）
  const lemma = await tryLemma(key, dict)
  if (!lemma) return null
  const entry = dict[lemma]
  if (!entry || !entry.t) return null

  const definitions: DictResult['definitions'] = []
  if (entry.t) {
    const lines = entry.t.split('\\n')
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z]+\.)\s*(.*)/)
      if (m) {
        definitions.push({ pos: m[1], def: m[2] })
      } else if (line.trim()) {
        definitions.push({ pos: '', def: line.trim() })
      }
    }
  }

  const phonetic: DictResult['phonetic'] = entry.p ? { uk: entry.p, us: entry.p } : undefined

  // 解析时态变形 (exchange: d:perceived/p:perceived/3:perceives/i:perceiving)
  const presents: string[] = []
  if (entry.e) {
    entry.e.split('/').forEach(part => {
      const [type, word] = part.split(':')
      if (word && ['p', 'd', 'i', '3', 'r', 't', 's'].includes(type)) {
        presents.push(word)
      }
    })
  }

  return {
    word: text,
    phonetic,
    definitions: definitions.length ? definitions : [{ pos: entry.pos || '', def: entry.t }],
    presents: presents.length ? presents : undefined,
  }
}

// ============================================
// Bing 词典 — 抓取 HTML 页面；解析在 offscreen document 完成
// （MV3 service worker 无 DOMParser，实测 ReferenceError 会让 Bing 数据静默丢失）
// ============================================
export async function bingDict(text: string, signal?: AbortSignal): Promise<DictResult | null> {
  const host = 'https://www.bing.com'
  const url = `${host}/dict/search?q=${encodeURIComponent(text)}&FORM=BDVSP6&cc=cn`

  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const html = await res.text()
    return await parseBingInOffscreen(html, signal)
  } catch (e: any) {
    if (e.name === 'AbortError') throw e
    return null
  }
}

// offscreen document 按需创建并常驻（轻量页面），解析结果经 runtime 消息往返
let offscreenEnsured: Promise<void> | null = null

async function ensureOffscreenDocument(): Promise<void> {
  if (!offscreenEnsured) {
    offscreenEnsured = (async () => {
      const offscreen = (chrome as any).offscreen
      if (!offscreen?.createDocument) throw new Error('offscreen API unavailable')
      if (typeof chrome.runtime.getContexts === 'function') {
        const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as any] })
        if (ctx?.length) return
      }
      try {
        await offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_PARSER'],
          justification: '解析 Bing 词典 HTML 页面（service worker 无 DOMParser）',
        })
      } catch { /* 已存在时 createDocument 会报错，忽略 */ }
    })()
    offscreenEnsured.catch(() => { offscreenEnsured = null }) // 失败允许下次重试
  }
  return offscreenEnsured
}

async function parseBingInOffscreen(html: string, signal?: AbortSignal): Promise<DictResult | null> {
  await ensureOffscreenDocument()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('offscreen parse timeout')), 5000)
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    chrome.runtime.sendMessage({ type: 'qt-parse-bing', html })
      .then((r: any) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (r?.error) reject(new Error(r.error))
        else resolve((r?.result as DictResult | null) ?? null)
      })
      .catch((e: any) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(e)
      })
  })
}

// ============================================
// 有道词典 — 抓取 jsonapi_s 接口（对齐 kiss-translator apiYoudaoDict）
// ============================================
export async function youdaoDict(text: string, signal?: AbortSignal): Promise<DictResult | null> {
  const url = 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4'
  const body = `q=${encodeURIComponent(text)}&le=en&t=3&client=web&keyfrom=webdict`

  try {
    const res = await fetch(url, {
      signal,
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) return null
    const data = await res.json()

    const word = data?.ec?.word?.['return-phrase'] || text

    // 音标
    const phonetic: DictResult['phonetic'] = {
      uk: data?.ec?.word?.ukphone,
      us: data?.ec?.word?.usphone,
    }

    // 释义
    const definitions: DictResult['definitions'] = []
    const trs = data?.ec?.word?.trs || []
    trs.forEach((t: any) => {
      if (t.tr) {
        const s = t.tr[0] || ''
        const dotIdx = s.indexOf('.')
        if (dotIdx > 0) {
          definitions.push({ pos: s.slice(0, dotIdx + 1).trim(), def: s.slice(dotIdx + 1).trim() })
        } else {
          definitions.push({ pos: '', def: s })
        }
      }
    })

    // 例句
    const sentences: DictResult['sentences'] = []
    const pairs = data?.blng_sents_part?.['sentence-pair'] || []
    pairs.slice(0, 3).forEach((p: any) => {
      const en = p?.['sentence']?.replace(/<[^>]+>/g, '')?.trim() || ''
      const zh = p?.['sentence-translation']?.trim() || ''
      if (en && zh) sentences.push({ en, zh })
    })

    return { word, phonetic, definitions, sentences }
  } catch (e: any) {
    if (e.name === 'AbortError') throw e
    return null
  }
}

// 百度 TTS 发音（对齐 kiss-translator BaiduAudioBtn）
export function getAudioUrl(word: string, lang: 'uk' | 'en' = 'en'): string {
  // Baidu TTS: lan=uk (British), lan=en (American)
  return `https://fanyi.baidu.com/gettts?lan=${lang}&text=${encodeURIComponent(word)}&spd=3`
}

// 备用 TTS（Google Translate）
export function getGoogleAudioUrl(word: string, lang: string = 'en'): string {
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(word)}`
}

// 统一词典查询入口（本地 → Bing → 有道 fallback）
export async function lookupDict(text: string, signal?: AbortSignal): Promise<DictResult | null> {
  // 1. 先查本地词典（瞬间响应）
  const local = await localDict(text)
  if (local && local.definitions?.length) {
    // 合并 Bing 补充数据（音标、例句、发音）后再返回：
    // 请求在 background 处理，sendResponse 会把当时的结果一次性序列化发走，
    // fire-and-forget 的补充会随序列化丢失。等待上限 2.5s，超时/失败则只返回本地数据
    try {
      const online = await Promise.race([
        bingDict(text, signal),
        new Promise<null>(resolve => setTimeout(resolve, 2500)),
      ])
      if (online) {
        if (online.phonetic) local.phonetic = online.phonetic
        if (online.audio) local.audio = online.audio
        if (online.sentences?.length) local.sentences = online.sentences
        if (online.presents?.length) local.presents = online.presents
        if (online.ecs?.length) local.ecs = online.ecs
      }
    } catch {}
    return local
  }

  // 2. 本地没有，查在线词典
  return onlineLookup(text, signal)
}

// 仅在线查询（Bing 优先，失败 fallback 到有道）
export async function onlineLookup(text: string, signal?: AbortSignal): Promise<DictResult | null> {
  const bing = await bingDict(text, signal)
  if (bing?.definitions?.length) return bing
  return youdaoDict(text, signal)
}
