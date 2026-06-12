export interface TranslateResult {
  text: string
  srcLang: string
}

// ============================================
// 语言映射
// ============================================
const LANG_MAP: Record<string, Record<string, string>> = {
  microsoft: { 'zh': 'zh-Hans', 'zh-TW': 'zh-Hant', 'auto': '' },
  deepl: { 'zh': 'ZH', 'zh-TW': 'ZH', 'auto': '', 'en': 'EN', 'ja': 'JA', 'ko': 'KO', 'fr': 'FR', 'de': 'DE', 'es': 'ES', 'ru': 'RU' },
  baidu: { 'zh': 'zh', 'zh-TW': 'cht', 'ja': 'jp', 'ko': 'kor', 'fr': 'fra', 'de': 'de', 'es': 'spa', 'ru': 'ru', 'ar': 'ara', 'pt': 'pt' },
  tencent: { 'zh-CN': 'zh', 'zh-TW': 'zh', 'fi': 'fil' },
  volcengine: { 'zh-CN': 'zh', 'zh-TW': 'zh-Hant', 'auto': 'auto' },
}

function lang(code: string, api: string): string {
  return LANG_MAP[api]?.[code] ?? code
}

// ============================================
// Token 缓存
// ============================================
let msToken = ''
let msTokenTime = 0
async function getMsToken(signal?: AbortSignal): Promise<string> {
  if (msToken && Date.now() - msTokenTime < 300000) return msToken
  const res = await fetch('https://edge.microsoft.com/translate/auth', { signal })
  msToken = await res.text()
  msTokenTime = Date.now()
  return msToken
}

// ============================================
// 免费翻译 API（无需 Key）
// ============================================

// Microsoft Edge 翻译（最快）
export async function microsoftTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const token = await getMsToken(signal)
  const res = await fetch(`https://api-edge.cognitive.microsofttranslator.com/translate?from=${lang(from, 'microsoft')}&to=${lang(to, 'microsoft')}&api-version=3.0`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify([{ Text: text }]),
  })
  const data = await res.json()
  if (data?.[0]?.translations?.[0]?.text) return { text: data[0].translations[0].text, srcLang: (data[0].detectedLanguage?.language || from).toUpperCase() }
  throw new Error('Microsoft failed')
}

// Google 翻译
export async function googleTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const params = new URLSearchParams({ client: 'gtx', dt: 't', dj: '1', ie: 'UTF-8', sl: from, tl: to, q: text })
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal, headers: { 'Content-Type': 'application/json' } })
  const data = await res.json()
  if (data?.sentences) return { text: data.sentences.map((s: any) => s.trans).join(''), srcLang: (data.src || from).toUpperCase() }
  throw new Error('Google failed')
}

// Google2 翻译
export async function google2Translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[[text], from, to], 'wt_lib']),
  })
  const data = await res.json()
  if (data?.[0]?.[0]) return { text: data[0][0], srcLang: (data[1]?.[0] || from).toUpperCase() }
  throw new Error('Google2 failed')
}

// DeepL 免费（网页逆向）
export async function deeplFreeTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const id = Math.floor(Math.random() * 1000000000)
  const ts = Date.now()
  const iCount = (text.match(/i/gi) || []).length + 1
  const adjustedTs = ts - (ts % iCount) + iCount
  const res = await fetch('https://www2.deepl.com/jsonrpc', {
    signal, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'DeepL-iOS/2.9.1 iOS 16.3.0 (iPhone13,2)',
      'x-app-os-name': 'iOS', 'x-app-os-version': '16.3.0',
      'x-app-device': 'iPhone13,2', 'x-app-build': '510265', 'x-app-version': '2.9.1',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'LMT_handle_texts',
      params: {
        splitting: 'newlines',
        lang: { target_lang: lang(to, 'deepl'), source_lang_user_selected: lang(from, 'deepl') },
        commonJobParams: { wasSpoken: false, transcribe_as: '' },
        id, timestamp: adjustedTs,
        texts: [{ text, requestAlternatives: 0 }],
      },
    }),
  })
  const data = await res.json()
  if (data?.result?.texts?.[0]?.text) return { text: data.result.texts[0].text, srcLang: (data.result.lang || from).toUpperCase() }
  throw new Error('DeepL Free failed')
}

// 腾讯翻译
export async function tencentTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://transmart.qq.com/api/imt', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://transmart.qq.com/' },
    body: JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120-W-' + Date.now() },
      type: 'plain', model_category: 'normal',
      source: { text_list: [text], lang: lang(from, 'tencent') },
      target: { lang: lang(to, 'tencent') },
    }),
  })
  const data = await res.json()
  if (data?.auto_translation?.[0]) return { text: data.auto_translation[0], srcLang: (data.src_lang || from).toUpperCase() }
  throw new Error('Tencent failed')
}

// 火山翻译
export async function volcengineTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://translate.volcengine.com/crx/translate/v1', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_language: lang(from, 'volcengine'), target_language: lang(to, 'volcengine'), text }),
  })
  const data = await res.json()
  if (data?.translation) return { text: data.translation, srcLang: (data.detected_language || from).toUpperCase() }
  throw new Error('Volcengine failed')
}

// 百度翻译
export async function baiduTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const body = `from=${lang(from, 'baidu')}&to=${lang(to, 'baidu')}&query=${encodeURIComponent(text)}&source=txt`
  const res = await fetch('https://fanyi.baidu.com/transapi', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
    body,
  })
  const data = await res.json()
  if (data?.type === 2 && data?.data?.[0]?.dst) return { text: data.data.map((d: any) => d.dst).join(' '), srcLang: (data.from || from).toUpperCase() }
  if (data?.type === 1) {
    try { return { text: Object.keys(JSON.parse(data.result).content[0].mean[0].cont)[0], srcLang: (data.from || from).toUpperCase() } } catch {}
  }
  throw new Error('Baidu failed')
}

// ============================================
// AI 翻译 API（需要 Key）
// ============================================

// 通用 OpenAI 兼容接口
async function openaiCompatibleTranslate(text: string, from: string, to: string, url: string, key: string, model: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const toName = to
  const res = await fetch(url, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are a translator. Translate the following text from ${fromName} to ${toName}. Output ONLY the translated text, no explanations.` },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      stream: false,
    }),
  })
  const data = await res.json()
  if (data?.choices?.[0]?.message?.content) return { text: data.choices[0].message.content.trim(), srcLang: from.toUpperCase() }
  throw new Error('OpenAI compatible failed')
}

export async function deepseekTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://api.deepseek.com/chat/completions', key, 'deepseek-chat', signal)
}

export async function openaiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://api.openai.com/v1/chat/completions', key, 'gpt-4o-mini', signal)
}

export async function siliconflowTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://api.siliconflow.cn/v1/chat/completions', key, 'deepseek-ai/DeepSeek-V3', signal)
}

export async function xiaomimimoTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://api.xiaomimimo.com/v1/chat/completions', key, 'MiMo', signal)
}

export async function aliyunbailianTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key, 'qwen-plus', signal)
}

export async function cerebrasTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://api.cerebras.ai/v1/chat/completions', key, 'llama3.1-8b', signal)
}

export async function zaiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key, 'glm-4-flash', signal)
}

export async function openrouterTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  return openaiCompatibleTranslate(text, from, to, 'https://openrouter.ai/api/v1/chat/completions', key, 'openai/gpt-4o-mini', signal)
}

// Gemini
export async function geminiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Translate from ${fromName} to ${to}. Output ONLY the translated text:\n\n${text}` }] }],
      generationConfig: { temperature: 0.3 },
    }),
  })
  const data = await res.json()
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) return { text: data.candidates[0].content.parts[0].text.trim(), srcLang: from.toUpperCase() }
  throw new Error('Gemini failed')
}

// Claude
export async function claudeTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Translate from ${fromName} to ${to}. Output ONLY the translated text:\n\n${text}` }],
    }),
  })
  const data = await res.json()
  if (data?.content?.[0]?.text) return { text: data.content[0].text.trim(), srcLang: from.toUpperCase() }
  throw new Error('Claude failed')
}

// DeepL 官方
export async function deeplTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'DeepL-Auth-Key ' + key },
    body: JSON.stringify({ text: [text], target_lang: lang(to, 'deepl'), source_lang: lang(from, 'deepl') }),
  })
  const data = await res.json()
  if (data?.translations?.[0]?.text) return { text: data.translations[0].text, srcLang: (data.translations[0].detected_source_language || from).toUpperCase() }
  throw new Error('DeepL failed')
}

// Cloudflare AI
export async function cloudflareTranslate(text: string, from: string, to: string, key: string, accountId: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/m2m100-1.2b`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ text, source_lang: from === 'auto' ? 'en' : from, target_lang: to }),
  })
  const data = await res.json()
  if (data?.result?.translated_text) return { text: data.result.translated_text, srcLang: from.toUpperCase() }
  throw new Error('Cloudflare failed')
}

// ============================================
// 语言检测 & 工具函数
// ============================================

export function detectLang(text: string): string {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length > 0.3 ? 'zh' : 'en'
}

export function getTargetLang(srcLang: string): string {
  return srcLang === 'zh' ? 'en' : 'zh'
}

// ============================================
// 翻译源配置
// ============================================

export interface TranslatorConfig {
  id: string
  name: string
  needKey: boolean
  translate: (text: string, from: string, to: string, key?: string, signal?: AbortSignal) => Promise<TranslateResult>
}

export const FREE_TRANSLATORS: TranslatorConfig[] = [
  { id: 'microsoft', name: 'Microsoft', needKey: false, translate: microsoftTranslate },
  { id: 'google', name: 'Google', needKey: false, translate: googleTranslate },
  { id: 'google2', name: 'Google2', needKey: false, translate: google2Translate },
  { id: 'deeplfree', name: 'DeepL Free', needKey: false, translate: deeplFreeTranslate },
  { id: 'tencent', name: '腾讯', needKey: false, translate: tencentTranslate },
  { id: 'volcengine', name: '火山', needKey: false, translate: volcengineTranslate },
  { id: 'baidu', name: '百度', needKey: false, translate: baiduTranslate },
]

export const AI_TRANSLATORS: TranslatorConfig[] = [
  { id: 'deepseek', name: 'DeepSeek', needKey: true, translate: (t, f, to, k, s) => deepseekTranslate(t, f, to, k!, s) },
  { id: 'openai', name: 'OpenAI', needKey: true, translate: (t, f, to, k, s) => openaiTranslate(t, f, to, k!, s) },
  { id: 'gemini', name: 'Gemini', needKey: true, translate: (t, f, to, k, s) => geminiTranslate(t, f, to, k!, s) },
  { id: 'claude', name: 'Claude', needKey: true, translate: (t, f, to, k, s) => claudeTranslate(t, f, to, k!, s) },
  { id: 'deepl', name: 'DeepL', needKey: true, translate: (t, f, to, k, s) => deeplTranslate(t, f, to, k!, s) },
  { id: 'siliconflow', name: 'SiliconFlow', needKey: true, translate: (t, f, to, k, s) => siliconflowTranslate(t, f, to, k!, s) },
  { id: 'xiaomimimo', name: '小米MiMo', needKey: true, translate: (t, f, to, k, s) => xiaomimimoTranslate(t, f, to, k!, s) },
  { id: 'aliyunbailian', name: '阿里百炼', needKey: true, translate: (t, f, to, k, s) => aliyunbailianTranslate(t, f, to, k!, s) },
  { id: 'cerebras', name: 'Cerebras', needKey: true, translate: (t, f, to, k, s) => cerebrasTranslate(t, f, to, k!, s) },
  { id: 'zai', name: '智谱AI', needKey: true, translate: (t, f, to, k, s) => zaiTranslate(t, f, to, k!, s) },
  { id: 'openrouter', name: 'OpenRouter', needKey: true, translate: (t, f, to, k, s) => openrouterTranslate(t, f, to, k!, s) },
]

export const ALL_TRANSLATORS = [...FREE_TRANSLATORS, ...AI_TRANSLATORS]

// ============================================
// 统一翻译入口
// ============================================

const cache = new Map<string, TranslateResult>()
function cacheKey(text: string, from: string, to: string, api: string) { return `${api}|${from}|${to}|${text}` }

export async function translateText(
  text: string,
  from = 'auto',
  to = 'zh',
  signal?: AbortSignal,
  apiId = 'microsoft',
  apiKey?: string,
): Promise<TranslateResult> {
  const key = cacheKey(text, from, to, apiId)
  const cached = cache.get(key)
  if (cached) return cached

  const translator = ALL_TRANSLATORS.find(t => t.id === apiId) || FREE_TRANSLATORS[0]
  const result = await translator.translate(text, from, to, apiKey, signal)

  cache.set(key, result)
  return result
}

// 带容错的翻译（自动 fallback）
export async function translateWithFallback(
  text: string,
  from = 'auto',
  to = 'zh',
  signal?: AbortSignal,
  apiId = 'microsoft',
  apiKey?: string,
): Promise<TranslateResult> {
  const key = cacheKey(text, from, to, apiId + '_fallback')
  const cached = cache.get(key)
  if (cached) return cached

  // 先尝试指定的 API
  try {
    const result = await translateText(text, from, to, signal, apiId, apiKey)
    return result
  } catch {}

  // 失败则尝试所有免费 API
  for (const t of FREE_TRANSLATORS) {
    if (t.id === apiId) continue
    try {
      const result = await t.translate(text, from, to, undefined, signal)
      cache.set(key, result)
      return result
    } catch {}
  }

  return { text: '翻译失败', srcLang: from.toUpperCase() }
}
