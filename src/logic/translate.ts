import { md5 } from './md5'
import { FREE_META, SUBSCRIBE_META, AI_META } from './translators-meta'

export interface TranslateResult {
  text: string
  srcLang: string
  api?: string
}

// ============================================
// 语言映射
// ============================================
const LANG_MAP: Record<string, Record<string, string>> = {
  microsoft: { 'zh': 'zh-Hans', 'zh-TW': 'zh-Hant', 'auto': '' },
  deepl: { 'zh': 'ZH', 'zh-TW': 'ZH', 'auto': '', 'en': 'EN', 'ja': 'JA', 'ko': 'KO', 'fr': 'FR', 'de': 'DE', 'es': 'ES', 'ru': 'RU' },
  baidu: { 'zh': 'zh', 'zh-TW': 'cht', 'ja': 'jp', 'ko': 'kor', 'fr': 'fra', 'de': 'de', 'es': 'spa', 'ru': 'ru', 'ar': 'ara', 'pt': 'pt' },
  tencent_free: { 'zh': 'zh-CHS', 'zh-TW': 'zh-CHT' },
  tencent_official: { 'zh': 'zh', 'zh-TW': 'zh-TW' },
  volcengine: { 'zh-CN': 'zh', 'zh-TW': 'zh-Hant', 'auto': 'auto' },
}

function lang(code: string, api: string): string {
  return LANG_MAP[api]?.[code] ?? code
}

function checkRes(res: Response, api: string) {
  if (!res.ok) throw new Error(`${api} HTTP ${res.status}`)
}

// ============================================
// AI 模型覆盖（用户可在 Options 配置 qt_api_models[apiId]）
// ============================================
let _modelsCache: Record<string, string> | null = null
let _modelsLoadTime = 0
const MODEL_TTL = 10000

async function getModels(): Promise<Record<string, string>> {
  if (_modelsCache && Date.now() - _modelsLoadTime < MODEL_TTL) return _modelsCache
  try {
    const { qt_api_models } = await chrome.storage.local.get('qt_api_models')
    _modelsCache = qt_api_models || {}
  } catch { _modelsCache = {} }
  _modelsLoadTime = Date.now()
  return _modelsCache
}

try {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.qt_api_models) _modelsCache = null
  })
} catch {}

async function getModel(id: string, fallback: string): Promise<string> {
  const models = await getModels()
  return models[id] || fallback
}

// ============================================
// Token 缓存（Microsoft Edge）
// ============================================
let msToken = ''
let msTokenTime = 0
async function getMsToken(signal?: AbortSignal): Promise<string> {
  if (msToken && Date.now() - msTokenTime < 300000) return msToken
  const res = await fetch('https://edge.microsoft.com/translate/auth', { signal })
  checkRes(res, 'MsAuth')
  msToken = await res.text()
  msTokenTime = Date.now()
  return msToken
}

// ============================================
// 免费翻译 API（无需 Key）
// ============================================

export async function microsoftTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const token = await getMsToken(signal)
  const res = await fetch(`https://api-edge.cognitive.microsofttranslator.com/translate?from=${lang(from, 'microsoft')}&to=${lang(to, 'microsoft')}&api-version=3.0`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify([{ Text: text }]),
  })
  checkRes(res, 'Microsoft')
  const data = await res.json()
  if (data?.[0]?.translations?.[0]?.text) return { text: data[0].translations[0].text, srcLang: (data[0].detectedLanguage?.language || from).toUpperCase() }
  throw new Error('Microsoft failed')
}

export async function googleTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const params = new URLSearchParams({ client: 'gtx', dt: 't', dj: '1', ie: 'UTF-8', sl: from, tl: to, q: text })
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal, headers: { 'Content-Type': 'application/json' } })
  checkRes(res, 'Google')
  const data = await res.json()
  if (data?.sentences) return { text: data.sentences.map((s: any) => s.trans).join(''), srcLang: (data.src || from).toUpperCase() }
  throw new Error('Google failed')
}

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
  checkRes(res, 'DeepL Free')
  const data = await res.json()
  if (data?.result?.texts?.[0]?.text) return { text: data.result.texts[0].text, srcLang: (data.result.lang || from).toUpperCase() }
  throw new Error('DeepL Free failed')
}

async function tencentTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://transmart.qq.com/api/imt', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://transmart.qq.com/' },
    body: JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120-W-' + Date.now() },
      type: 'plain', model_category: 'normal',
      source: { text_list: [text], lang: lang(from, 'tencent_free') },
      target: { lang: lang(to, 'tencent_free') },
    }),
  })
  const data = await res.json()
  if (data?.auto_translation?.[0]) return { text: data.auto_translation[0], srcLang: (data.src_lang || from).toUpperCase() }
  throw new Error('Tencent failed')
}

// 腾讯云 TC3-HMAC-SHA256 签名
async function sha256Hex(msg: string): Promise<string> {
  const data = new TextEncoder().encode(msg)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}
async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key instanceof ArrayBuffer ? key : key.buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
}
async function hmacSha256Hex(key: ArrayBuffer | Uint8Array, msg: string): Promise<string> {
  const buf = await hmacSha256(key, msg)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function tencentOfficialTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const [secretId, secretKey] = key.split(':')
  if (!secretId || !secretKey) throw new Error('腾讯Key格式: SecretId:SecretKey')

  const service = 'tmt'
  const action = 'TextTranslate'
  const version = '2018-03-21'
  const region = 'ap-guangdong'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const payload = JSON.stringify({ SourceText: text, Source: lang(from, 'tencent_official'), Target: lang(to, 'tencent_official'), ProjectId: 0 })
  const payloadHash = await sha256Hex(payload)

  const canonicalHeaders = `content-type:application/json\nhost:tmt.tencentcloudapi.com\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`

  const secretDate = await hmacSha256(new TextEncoder().encode('TC3' + secretKey), date)
  const secretService = await hmacSha256(new Uint8Array(secretDate), service)
  const secretSigning = await hmacSha256(new Uint8Array(secretService), 'tc3_request')
  const signature = await hmacSha256Hex(new Uint8Array(secretSigning), stringToSign)

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch('https://tmt.tencentcloudapi.com', {
    signal, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': 'tmt.tencentcloudapi.com',
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
      'Authorization': authorization,
    },
    body: payload,
  })
  const data = await res.json()
  if (data?.Response?.TargetText) return { text: data.Response.TargetText, srcLang: from.toUpperCase() }
  throw new Error(data?.Response?.Error?.Message || 'Tencent API failed')
}

// 百度翻译（官方API，需Key）— md5(appid + q + salt + key)
export async function baiduOfficialTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const [appid, secret] = key.split(':')
  if (!appid || !secret) throw new Error('百度Key格式: AppID:密钥')
  const salt = Date.now().toString()
  const sign = md5(appid + text + salt + secret)
  const params = new URLSearchParams({ q: text, from: lang(from, 'baidu'), to: lang(to, 'baidu'), appid, salt, sign })
  const res = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`, { signal })
  checkRes(res, 'Baidu API')
  const data = await res.json()
  if (data?.trans_result?.[0]?.dst) return { text: data.trans_result[0].dst, srcLang: from.toUpperCase() }
  throw new Error(data?.error_msg || 'Baidu API failed')
}

export async function googleOfficialTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const params = new URLSearchParams({ q: text, source: from === 'auto' ? 'auto' : from, target: to, format: 'text', key })
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?${params}`, { signal })
  checkRes(res, 'Google API')
  const data = await res.json()
  if (data?.data?.translations?.[0]?.translatedText) return { text: data.data.translations[0].translatedText, srcLang: from.toUpperCase() }
  throw new Error('Google API failed')
}

export async function volcengineTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://translate.volcengine.com/crx/translate/v1', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_language: lang(from, 'volcengine'), target_language: lang(to, 'volcengine'), text }),
  })
  checkRes(res, 'Volcengine')
  const data = await res.json()
  if (data?.translation) return { text: data.translation, srcLang: (data.detected_language || from).toUpperCase() }
  throw new Error('Volcengine failed')
}

export async function baiduTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const body = `from=${lang(from, 'baidu')}&to=${lang(to, 'baidu')}&query=${encodeURIComponent(text)}&source=txt`
  const res = await fetch('https://fanyi.baidu.com/transapi', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
    body,
  })
  checkRes(res, 'Baidu')
  const data = await res.json()
  if (data?.type === 2 && data?.data?.[0]?.dst) return { text: data.data.map((d: any) => d.dst).join(' '), srcLang: (data.from || from).toUpperCase() }
  if (data?.type === 1) {
    try { return { text: Object.keys(JSON.parse(data.result).content[0].mean[0].cont)[0], srcLang: (data.from || from).toUpperCase() } } catch {}
  }
  throw new Error('Baidu failed')
}

// ============================================
// AI 翻译 API（需要 Key，model 可由用户覆盖）
// ============================================

const AI_DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
  xiaomimimo: 'MiMo',
  aliyunbailian: 'qwen-plus',
  cerebras: 'llama3.1-8b',
  zai: 'glm-4-flash',
  openrouter: 'openai/gpt-4o-mini',
}

async function openaiCompatibleTranslate(text: string, from: string, to: string, url: string, key: string, model: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const res = await fetch(url, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are a translator. Translate the following text from ${fromName} to ${to}. Output ONLY the translated text, no explanations.` },
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

async function aiWrap(id: string, url: string, text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const model = await getModel(id, AI_DEFAULT_MODELS[id])
  return openaiCompatibleTranslate(text, from, to, url, key, model, signal)
}

export async function deepseekTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('deepseek', 'https://api.deepseek.com/chat/completions', text, from, to, key, signal)
}
export async function openaiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('openai', 'https://api.openai.com/v1/chat/completions', text, from, to, key, signal)
}
export async function siliconflowTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('siliconflow', 'https://api.siliconflow.cn/v1/chat/completions', text, from, to, key, signal)
}
export async function xiaomimimoTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('xiaomimimo', 'https://api.xiaomimimo.com/v1/chat/completions', text, from, to, key, signal)
}
export async function aliyunbailianTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('aliyunbailian', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', text, from, to, key, signal)
}
export async function cerebrasTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('cerebras', 'https://api.cerebras.ai/v1/chat/completions', text, from, to, key, signal)
}
export async function zaiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('zai', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', text, from, to, key, signal)
}
export async function openrouterTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal) {
  return aiWrap('openrouter', 'https://openrouter.ai/api/v1/chat/completions', text, from, to, key, signal)
}

export async function geminiTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const model = await getModel('gemini', 'gemini-2.0-flash')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
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

export async function claudeTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const fromName = from === 'auto' ? 'auto-detected' : from
  const model = await getModel('claude', 'claude-haiku-4-5-20251001')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Translate from ${fromName} to ${to}. Output ONLY the translated text:\n\n${text}` }],
    }),
  })
  const data = await res.json()
  if (data?.content?.[0]?.text) return { text: data.content[0].text.trim(), srcLang: from.toUpperCase() }
  throw new Error('Claude failed')
}

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

// ============================================
// 语言检测 & 工具函数（实现在 lang-utils.ts，纯函数无副作用）
// ============================================
export { detectLang, getTargetLang } from './lang-utils'

// ============================================
// 翻译源配置
// ============================================

export interface TranslatorConfig {
  id: string
  name: string
  needKey: boolean
  translate: (text: string, from: string, to: string, key?: string, signal?: AbortSignal) => Promise<TranslateResult>
}

// 实现表（id → translate 函数）：元数据 translators-meta.ts 单独维护
type Impl = TranslatorConfig['translate']

const FREE_IMPL: Record<string, Impl> = {
  microsoft: microsoftTranslate,
  google: googleTranslate,
  deeplfree: deeplFreeTranslate,
  tencent: tencentTranslate,
  volcengine: volcengineTranslate,
  baidu: baiduTranslate,
}

const SUBSCRIBE_IMPL: Record<string, Impl> = {
  tencent_official: (t, f, to, k, s) => { if (!k) throw new Error('Key格式: SecretId:SecretKey'); return tencentOfficialTranslate(t, f, to, k, s) },
  baidu_official: (t, f, to, k, s) => { if (!k) throw new Error('Key格式: AppID:密钥'); return baiduOfficialTranslate(t, f, to, k, s) },
  google_official: (t, f, to, k, s) => { if (!k) throw new Error('需要 API Key'); return googleOfficialTranslate(t, f, to, k, s) },
  deepl: (t, f, to, k, s) => { if (!k) throw new Error('需要 API Key'); return deeplTranslate(t, f, to, k, s) },
}

const AI_IMPL: Record<string, Impl> = {
  deepseek: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return deepseekTranslate(t, f, to, k, s) },
  openai: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return openaiTranslate(t, f, to, k, s) },
  gemini: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return geminiTranslate(t, f, to, k, s) },
  claude: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return claudeTranslate(t, f, to, k, s) },
  siliconflow: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return siliconflowTranslate(t, f, to, k, s) },
  xiaomimimo: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return xiaomimimoTranslate(t, f, to, k, s) },
  aliyunbailian: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return aliyunbailianTranslate(t, f, to, k, s) },
  cerebras: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return cerebrasTranslate(t, f, to, k, s) },
  zai: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return zaiTranslate(t, f, to, k, s) },
  openrouter: (t, f, to, k, s) => { if (!k) throw new Error('API Key required'); return openrouterTranslate(t, f, to, k, s) },
}

export const FREE_TRANSLATORS: TranslatorConfig[] = FREE_META.map(m => ({
  ...m,
  translate: FREE_IMPL[m.id],
}))

export const SUBSCRIBE_TRANSLATORS: TranslatorConfig[] = SUBSCRIBE_META.map(m => ({
  ...m,
  translate: SUBSCRIBE_IMPL[m.id],
}))

export const AI_TRANSLATORS: TranslatorConfig[] = AI_META.map(m => ({
  ...m,
  translate: AI_IMPL[m.id],
}))

export const ALL_TRANSLATORS = [...FREE_TRANSLATORS, ...SUBSCRIBE_TRANSLATORS, ...AI_TRANSLATORS]

// 索引 Map：O(1) 查找
export const TRANSLATOR_MAP: Map<string, TranslatorConfig> = new Map(ALL_TRANSLATORS.map(t => [t.id, t]))

export function getTranslator(id: string): TranslatorConfig {
  return TRANSLATOR_MAP.get(id) || FREE_TRANSLATORS[0]
}

// 自定义翻译 API
export async function customTranslate(text: string, from: string, to: string, config: { url: string; key?: string; model?: string; prompt?: string }, signal?: AbortSignal): Promise<TranslateResult> {
  const { url, key, model, prompt } = config
  if (!url) throw new Error('Custom API URL required')

  const fromName = from === 'auto' ? 'auto-detected' : from
  const systemPrompt = prompt || `You are a translator. Translate from ${fromName} to ${to}. Output ONLY the translated text.`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`

  const body: Record<string, any> = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
    stream: false,
  }

  const res = await fetch(url, {
    signal, method: 'POST', headers,
    body: JSON.stringify(body),
  })
  checkRes(res, 'Custom API')
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content || data?.result?.translated_text || data?.text
  if (content) return { text: content.trim(), srcLang: from.toUpperCase() }
  throw new Error('Custom API failed')
}

// ============================================
// 缓存（LRU + TTL）
// ============================================

const CACHE_MAX = 500
const CACHE_TTL = 30 * 60 * 1000 // 30 分钟

interface CacheEntry {
  result: TranslateResult
  ts: number
}

const cache = new Map<string, CacheEntry>()

function customConfigHash(c?: { url: string; key?: string; model?: string; prompt?: string }): string {
  if (!c) return ''
  return `${c.url}|${c.model || ''}|${c.prompt || ''}`
}

function cacheKey(text: string, from: string, to: string, api: string, cHash = '') {
  return `${api}|${from}|${to}|${cHash}|${text}`
}

function cacheGet(key: string): TranslateResult | undefined {
  const entry = cache.get(key)
  if (!entry) return
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key)
    return
  }
  cache.delete(key)
  cache.set(key, entry)
  return entry.result
}

function cacheSet(key: string, val: TranslateResult) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  cache.set(key, { result: val, ts: Date.now() })
}

// 组合 AbortSignal：外部 signal + 内部 timeout
function withTimeout(signal?: AbortSignal, ms = 30000): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    const t = (AbortSignal as any).timeout(ms) as AbortSignal
    if (!signal) return t
    const ctrl = new AbortController()
    const onAbort = (e: Event) => {
      const s = e.target as AbortSignal
      try { ctrl.abort(s.reason) } catch { ctrl.abort() }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    t.addEventListener('abort', onAbort, { once: true })
    return ctrl.signal
  }
  return signal
}

// ============================================
// 统一翻译入口
// ============================================

export async function translateText(
  text: string,
  from = 'auto',
  to = 'zh',
  signal?: AbortSignal,
  apiId = 'microsoft',
  apiKey?: string,
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<TranslateResult> {
  const cHash = apiId === 'custom' ? customConfigHash(customConfig) : ''
  const key = cacheKey(text, from, to, apiId, cHash)
  const cached = cacheGet(key)
  if (cached) return cached

  const innerSignal = withTimeout(signal, 30000)
  let result: TranslateResult
  if (apiId === 'custom' && customConfig) {
    result = await customTranslate(text, from, to, customConfig, innerSignal)
  } else {
    const translator = getTranslator(apiId)
    result = await translator.translate(text, from, to, apiKey, innerSignal)
  }
  result.api = apiId

  cacheSet(key, result)
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
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<TranslateResult> {
  const cHash = apiId === 'custom' ? customConfigHash(customConfig) : ''
  const key = cacheKey(text, from, to, apiId + '_fb', cHash)
  const cached = cacheGet(key)
  if (cached) return cached

  try {
    const result = await translateText(text, from, to, signal, apiId, apiKey, customConfig)
    cacheSet(key, result)
    return result
  } catch {}

  for (const t of FREE_TRANSLATORS) {
    if (t.id === apiId) continue
    try {
      const innerSignal = withTimeout(signal, 30000)
      const result = await t.translate(text, from, to, undefined, innerSignal)
      result.api = t.id
      cacheSet(key, result)
      return result
    } catch {}
  }

  throw new Error('所有翻译源均失败')
}
