import { md5 } from './md5'
import { FREE_META, SUBSCRIBE_META, AI_META, getMeta } from './translators-meta'
import { decryptKeys } from './crypto'

export interface TranslateResult {
  text: string
  srcLang: string
  api?: string
  /** true = 主源失败后由备用源完成（UI 据此标注） */
  viaFallback?: boolean
}

// ============================================
// 语言映射
// ============================================
const LANG_MAP: Record<string, Record<string, string>> = {
  azure: { 'zh': 'zh-Hans', 'zh-TW': 'zh-Hant', 'auto': '' },
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
let _modelsPromise: Promise<Record<string, string>> | null = null
const MODEL_TTL = 10000

function getModels(): Promise<Record<string, string>> {
  if (_modelsCache && Date.now() - _modelsLoadTime < MODEL_TTL) return Promise.resolve(_modelsCache)
  if (_modelsPromise) return _modelsPromise
  const p = (async () => {
    try {
      const { qt_api_models } = await chrome.storage.local.get('qt_api_models')
      _modelsCache = (qt_api_models as Record<string, string>) || {}
    } catch { _modelsCache = {} }
    _modelsLoadTime = Date.now()
    return _modelsCache!
  })()
  _modelsPromise = p
  return p.finally(() => { if (_modelsPromise === p) _modelsPromise = null })
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
// 免费翻译 API（无需 Key）
// ============================================

// 微软免费翻译：Edge 浏览器免认证端点（/translate/auth token 方案已于 2025-08 下线，
// 2026-07 起 Edge 改用此未认证接口，read-frog 等工具同期迁移）。
// 限制：from 仅支持 en（其余语言返回 500，会快速失败并走 fallback）。
// 请求体是纯字符串数组（非旧版 [{Text}]），请求前需 HTML 转义防端点标签对齐破坏文本，
// 响应保留转义形式需还原。
const MS_EDGE_URL = 'https://edge.microsoft.com/translate/translatetext'

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeHtmlText(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export async function microsoftFreeTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const [r] = await microsoftFreeTranslateBatch([text], from, to, signal)
  if (r?.text) return r
  throw new Error('Microsoft failed')
}

export async function microsoftFreeTranslateBatch(texts: string[], from: string, to: string, signal?: AbortSignal): Promise<TranslateResult[]> {
  const res = await fetch(`${MS_EDGE_URL}?from=${lang(from, 'azure')}&to=${lang(to, 'azure')}&isEnterpriseClient=false`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(texts.map(escapeHtmlText)),
  })
  checkRes(res, 'Microsoft')
  const data = await res.json()
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('Microsoft failed')
  const results = data.map((d: any) => ({
    text: unescapeHtmlText(d?.translations?.[0]?.text || ''),
    srcLang: (d?.detectedLanguage?.language || from).toUpperCase(),
  }))
  if (results.some(r => !r.text)) throw new Error('Microsoft failed')
  return results
}

// 微软 Azure Translator（官方 API）：key 格式 "Key" 或 "Key:Region"（如 "abc:eastasia"）
// 替代已下线的 edge.microsoft.com 免费通道（2025-08 关停），新用户每月 200 万字符免费
export async function azureTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const [r] = await azureTranslateBatch([text], from, to, key, signal)
  if (r?.text) return r
  throw new Error('Azure failed')
}

// Azure 官方支持单请求多文本，整页翻译时合并为单次请求
export async function azureTranslateBatch(texts: string[], from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult[]> {
  const [apiKey, region] = key.split(':')
  if (!apiKey) throw new Error('Azure Key 格式: Key 或 Key:Region')
  const res = await fetch(`https://api-translator.azure.com/translate?from=${lang(from, 'azure')}&to=${lang(to, 'azure')}&api-version=3.0`, {
    signal, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': apiKey,
      ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
    },
    body: JSON.stringify(texts.map(t => ({ Text: t }))),
  })
  checkRes(res, 'Azure')
  const data = await res.json()
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('Azure failed')
  const results = data.map((d: any) => ({
    text: d?.translations?.[0]?.text || '',
    srcLang: (d?.detectedLanguage?.language || from).toUpperCase(),
  }))
  if (results.some(r => !r.text)) throw new Error('Azure failed')
  return results
}

export async function googleTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const params = new URLSearchParams({ client: 'gtx', dt: 't', dj: '1', ie: 'UTF-8', sl: from, tl: to, q: text })
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal })
  checkRes(res, 'Google')
  const data = await res.json()
  if (data?.sentences) return { text: data.sentences.map((s: any) => s.trans).join(''), srcLang: (data.src || from).toUpperCase() }
  throw new Error('Google failed')
}

export async function deeplFreeTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const [r] = await deeplFreeTranslateBatch([text], from, to, signal)
  if (r?.text) return r
  throw new Error('DeepL Free failed')
}

// DeepL web 端 jsonrpc 的 texts 字段原生支持数组，整页翻译时合并为单请求
export async function deeplFreeTranslateBatch(texts: string[], from: string, to: string, signal?: AbortSignal): Promise<TranslateResult[]> {
  const id = Math.floor(Math.random() * 1000000000)
  const ts = Date.now()
  const iCount = (texts.join('').match(/i/gi) || []).length + 1
  const adjustedTs = ts - (ts % iCount) + iCount
  const res = await fetch('https://www2.deepl.com/jsonrpc', {
    signal, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
        texts: texts.map(t => ({ text: t, requestAlternatives: 0 })),
      },
    }),
  })
  checkRes(res, 'DeepL Free')
  const data = await res.json()
  const results = data?.result?.texts
  if (!Array.isArray(results) || results.length !== texts.length) throw new Error('DeepL Free failed')
  const out = results.map((r: any) => ({ text: r?.text || '', srcLang: (data.result.lang || from).toUpperCase() }))
  if (out.some((r: TranslateResult) => !r.text)) throw new Error('DeepL Free failed')
  return out
}

async function tencentTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch('https://transmart.qq.com/api/imt', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Referer': 'https://transmart.qq.com/' },
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
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

const AI_TRANSLATE_INSTRUCTION = 'You are a professional translator. Translate the following text from {FROM} to {TO}. Preserve the original formatting and line breaks. Output ONLY the translated text, no explanations.'

function aiSystemPrompt(from: string, to: string): string {
  return AI_TRANSLATE_INSTRUCTION.replace('{FROM}', from === 'auto' ? 'auto-detected' : from).replace('{TO}', to)
}

async function openaiCompatibleTranslate(text: string, from: string, to: string, url: string, key: string, model: string, signal?: AbortSignal): Promise<TranslateResult> {
  const res = await fetch(url, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: aiSystemPrompt(from, to) },
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
  const model = await getModel('gemini', 'gemini-2.0-flash')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: aiSystemPrompt(from, to) }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: { temperature: 0.3 },
    }),
  })
  const data = await res.json()
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) return { text: data.candidates[0].content.parts[0].text.trim(), srcLang: from.toUpperCase() }
  throw new Error('Gemini failed')
}

export async function claudeTranslate(text: string, from: string, to: string, key: string, signal?: AbortSignal): Promise<TranslateResult> {
  const model = await getModel('claude', 'claude-haiku-4-5-20251001')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    signal, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: aiSystemPrompt(from, to),
      messages: [{ role: 'user', content: text }],
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
// 免费源无 key，统一适配为 (text, from, to, key?, signal?) 签名
type Impl = TranslatorConfig['translate']
const freeImpl = (fn: (t: string, f: string, to: string, s?: AbortSignal) => Promise<TranslateResult>): Impl =>
  (t, f, to, _k, s) => fn(t, f, to, s)

const FREE_IMPL: Record<string, Impl> = {
  microsoft: freeImpl(microsoftFreeTranslate),
  google: freeImpl(googleTranslate),
  deeplfree: freeImpl(deeplFreeTranslate),
  tencent: freeImpl(tencentTranslate),
  volcengine: freeImpl(volcengineTranslate),
  baidu: freeImpl(baiduTranslate),
}

const SUBSCRIBE_IMPL: Record<string, Impl> = {
  azure: (t, f, to, k, s) => { if (!k) throw new Error('Azure Key 格式: Key 或 Key:Region'); return azureTranslate(t, f, to, k, s) },
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

  const systemPrompt = prompt || aiSystemPrompt(from, to)

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
// 熔断器：整页翻译时某源故障会拖慢每一批（每段都重等超时），
// 连续失败 N 次后短期内直接跳过该源
// ============================================

const BREAKER_THRESHOLD = 3
const BREAKER_MS = 60000

const failStreak = new Map<string, number>()
const breakerUntil = new Map<string, number>()

function breakerOpen(id: string): boolean {
  const until = breakerUntil.get(id) || 0
  if (Date.now() < until) return true
  breakerUntil.delete(id)
  return false
}

function noteFail(id: string) {
  const n = (failStreak.get(id) || 0) + 1
  failStreak.set(id, n)
  if (n >= BREAKER_THRESHOLD) breakerUntil.set(id, Date.now() + BREAKER_MS)
}

function noteOk(id: string) {
  failStreak.delete(id)
  breakerUntil.delete(id)
}

// ============================================
// 缓存（LRU + TTL；持久化到 storage.session 对抗 SW 回收）
// ============================================

const CACHE_MAX = 2000
const CACHE_TTL = 30 * 60 * 1000 // 30 分钟
const CACHE_STORAGE_KEY = 'qt_translate_cache'

interface CacheEntry {
  result: TranslateResult
  ts: number
}

const cache = new Map<string, CacheEntry>()

let _restorePromise: Promise<void> | null = null
let _flushTimer: ReturnType<typeof setTimeout> | null = null

// MV3 service worker 空闲即被杀，内存缓存活不过 TTL；启动时从 session storage 恢复。
// 共享同一个 promise：并发的首批请求都等恢复完成，否则部分请求在恢复前就 miss
function restoreCache(): Promise<void> {
  if (!_restorePromise) {
    _restorePromise = (async () => {
      try {
        const saved = await (chrome as any).storage?.session?.get(CACHE_STORAGE_KEY)
        const entries = saved?.[CACHE_STORAGE_KEY]
        if (entries) {
          const now = Date.now()
          for (const [k, entry] of Object.entries(entries)) {
            if ((entry as CacheEntry)?.ts && now - (entry as CacheEntry).ts <= CACHE_TTL) {
              cache.set(k, entry as CacheEntry)
            }
          }
        }
      } catch {}
    })()
  }
  return _restorePromise
}

// 停止写入 2 秒后落盘一次，避免翻译进行中每段都全量序列化
function scheduleFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    try { (chrome as any).storage?.session?.set({ [CACHE_STORAGE_KEY]: Object.fromEntries(cache) }) } catch {}
  }, 2000)
}

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
  scheduleFlush()
}

// 清空全部翻译缓存（内存 + session 持久层）
function clearAllCache() {
  cache.clear()
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  try { (chrome as any).storage?.session?.remove(CACHE_STORAGE_KEY) } catch {}
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
  apiId = 'volcengine',
  apiKey?: string,
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<TranslateResult> {
  await restoreCache()
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

// 带容错的翻译（自动 fallback；熔断中的源直接跳过，不重复等超时）
// lastGoodFree：记住最近成功的免费源，fallback 从它先试——不同网络环境可用源不同
let lastGoodFree = ''

// 用户禁用的备用源（如因隐私/网络原因不想让 fallback 用 Google）；不做缓存避免陈旧
let _lastFallbackDisabled: string[] | null = null

async function getFallbackDisabled(): Promise<string[]> {
  let disabled: string[] = []
  try {
    const { qt_fallback_disabled } = await chrome.storage.local.get('qt_fallback_disabled')
    if (Array.isArray(qt_fallback_disabled)) disabled = qt_fallback_disabled
  } catch {}
  // 黑名单发生变化：旧翻译缓存不可信，就地清空（调用时序在缓存读取之前，本次翻译即生效）
  if (_lastFallbackDisabled !== null && JSON.stringify(disabled) !== JSON.stringify(_lastFallbackDisabled)) {
    clearAllCache()
  }
  _lastFallbackDisabled = disabled
  return disabled
}

function fmtErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.length > 60 ? msg.slice(0, 60) + '…' : msg
}

export async function translateWithFallback(
  text: string,
  from = 'auto',
  to = 'zh',
  signal?: AbortSignal,
  apiId = 'volcengine',
  apiKey?: string,
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<TranslateResult> {
  await restoreCache()
  const fallbackDisabled = await getFallbackDisabled()
  const cHash = apiId === 'custom' ? customConfigHash(customConfig) : ''
  const key = cacheKey(text, from, to, apiId + '_fb', cHash)
  const cached = cacheGet(key)
  // 缓存结果若来自已被禁用的备用源，视为未命中（不依赖 viaFallback 字段，兼容旧缓存条目）
  if (cached && !(cached.api && cached.api !== apiId && fallbackDisabled.includes(cached.api))) {
    return cached
  }

  // 收集各源失败原因，最终抛给用户诊断（如 HTTP 403 / 超时 / 网络不通）
  const errors: string[] = []

  if (!breakerOpen(apiId)) {
    try {
      const result = await translateText(text, from, to, signal, apiId, apiKey, customConfig)
      noteOk(apiId)
      if (FREE_IMPL[apiId]) lastGoodFree = apiId
      cacheSet(key, result)
      return result
    } catch (e) {
      if (signal?.aborted) throw e // 用户取消不计入熔断
      noteFail(apiId)
      errors.push(`${getMeta(apiId).name}: ${fmtErr(e)}`)
    }
  } else if (apiId !== 'custom') {
    errors.push(`${getMeta(apiId).name}: 熔断中（近期连续失败，已跳过）`)
  }

  const ordered = lastGoodFree
    ? [...FREE_TRANSLATORS.filter(t => t.id === lastGoodFree), ...FREE_TRANSLATORS.filter(t => t.id !== lastGoodFree)]
    : FREE_TRANSLATORS

  for (const t of ordered) {
    if (t.id === apiId) continue
    if (breakerOpen(t.id) || fallbackDisabled.includes(t.id)) continue
    try {
      const innerSignal = withTimeout(signal, 30000)
      const result = await t.translate(text, from, to, undefined, innerSignal)
      result.api = t.id
      result.viaFallback = true
      noteOk(t.id)
      lastGoodFree = t.id
      cacheSet(key, result)
      return result
    } catch (e) {
      if (signal?.aborted) throw e
      noteFail(t.id)
      errors.push(`${t.name}: ${fmtErr(e)}`)
    }
  }

  throw new Error(errors.length ? `所有翻译源均失败（${errors.slice(0, 3).join('；')}）` : '所有翻译源均失败')
}

// 批量翻译：先查缓存；主源为 Microsoft 时合并为单次批量请求，其余逐段 fallback
export async function translateBatchWithFallback(
  texts: string[],
  from = 'auto',
  to = 'zh',
  signal?: AbortSignal,
  apiId = 'volcengine',
  apiKey?: string,
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<(TranslateResult | null)[]> {
  await restoreCache()

  const results: (TranslateResult | null)[] = texts.map(() => null)
  const cHash = apiId === 'custom' ? customConfigHash(customConfig) : ''
  const pending: number[] = []

  for (let i = 0; i < texts.length; i++) {
    const hit = cacheGet(cacheKey(texts[i], from, to, apiId, cHash))
    if (hit) results[i] = hit
    else pending.push(i)
  }
  if (pending.length === 0) return results

  // 支持单请求多文本的引擎批量（微软免费 Edge 端点 / Azure 官方 / DeepL Free web）
  const batchable = apiId === 'microsoft' || apiId === 'azure' || apiId === 'deeplfree'
  if (batchable && !breakerOpen(apiId)) {
    try {
      const pendingTexts = pending.map(i => texts[i])
      const inner = withTimeout(signal, 30000)
      const batch = apiId === 'microsoft'
        ? await microsoftFreeTranslateBatch(pendingTexts, from, to, inner)
        : apiId === 'azure'
          ? await azureTranslateBatch(pendingTexts, from, to, apiKey || '', inner)
          : await deeplFreeTranslateBatch(pendingTexts, from, to, inner)
      noteOk(apiId)
      pending.forEach((idx, j) => {
        batch[j].api = apiId
        results[idx] = batch[j]
        cacheSet(cacheKey(texts[idx], from, to, apiId, cHash), batch[j])
      })
      return results
    } catch (e) {
      if (signal?.aborted) throw e
      noteFail(apiId)
    }
  }

  await Promise.all(pending.map(async (i) => {
    try {
      results[i] = await translateWithFallback(texts[i], from, to, signal, apiId, apiKey, customConfig)
    } catch {}
  }))
  return results
}

// ============================================
// AI 对照翻译：与主引擎完全独立的一份附加译文。
// 仅使用已配置 Key 的 AI 源直连（无 fallback），失败/未配置时返回 null（UI 不显示）
// ============================================

/** 选择对照用的 AI 源：'off' 关闭；'auto' 取第一个已配 Key 的；否则用指定源（无 Key 视为不可用） */
export function pickAiId(mode: string, keys: Record<string, string>): string {
  if (mode === 'off') return ''
  if (mode && mode !== 'auto') return keys[mode] ? mode : ''
  const hit = AI_META.find(m => keys[m.id])
  return hit ? hit.id : ''
}

export async function aiCompareTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<TranslateResult | null> {
  try {
    const [{ qt_ai_compare }, storedKeys] = await Promise.all([
      chrome.storage.local.get('qt_ai_compare'),
      chrome.storage.local.get('qt_api_keys'),
    ])
    const mode = (typeof qt_ai_compare === 'string' && qt_ai_compare) || 'auto'
    const rawKeys = (storedKeys as Record<string, unknown>).qt_api_keys
    const keys = await decryptKeys((rawKeys && typeof rawKeys === 'object' ? rawKeys : {}) as Record<string, string>)
    const aiId = pickAiId(mode, keys)
    if (!aiId) return null
    // 走 translateText 复用缓存：同一文本二次划词不重复消耗 AI 额度
    return await translateText(text, from, to, signal, aiId, keys[aiId])
  } catch {
    return null
  }
}
