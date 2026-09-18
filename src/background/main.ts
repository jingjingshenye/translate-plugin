import { translateWithFallback, translateBatchWithFallback, customTranslate, getTranslator, aiCompareTranslate, type TranslateResult } from '~/logic/translate'
import { localDict, lookupDict, onlineLookup, type DictResult } from '~/logic/dict'
import { decryptKeys } from '~/logic/crypto'
import { getMeta, isKnownApi } from '~/logic/translators-meta'
import type { BackgroundMessage } from '~/logic/messages'

chrome.runtime.onInstalled.addListener(() => createContextMenus())
chrome.runtime.onStartup.addListener(() => createContextMenus())

function createContextMenus() {
  chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译所选文本',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: 'translate-page',
    title: '全文翻译整个页面',
    contexts: ['page', 'frame'],
  })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'translate-text',
      text: info.selectionText,
    }).catch(() => {})
  } else if (info.menuItemId === 'translate-page') {
    startImmersive(tab.id, false)
  }
})

// 快捷键（默认 Alt+Shift+T）：全文翻译 / 再次按下取消（toggle）
chrome.commands?.onCommand.addListener((command) => {
  if (command !== 'qt-translate-page') return
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) startImmersive(tab.id, true)
  }).catch(() => {})
})

// 从 storage 组装沉浸式翻译 payload（popup 不在场的快捷键/右键菜单入口共用）
async function buildImmersivePayload(toggle: boolean) {
  const stored = await chrome.storage.local.get([
    'qt_immersive_api', 'qt_api', 'qt_api_keys', 'qt_custom_api',
    'qt_immersive_mode', 'qt_immersive_to', 'qt_to', 'qt_immersive_exclude', 'qt_immersive_style',
  ])
  const keys = await decryptKeys((stored.qt_api_keys as Record<string, string>) || {})
  const rawApi = (stored.qt_immersive_api as string) || (stored.qt_api as string) || ''
  let api = isKnownApi(rawApi) ? rawApi : 'microsoft'
  let customConfig = api === 'custom' ? stored.qt_custom_api as { url: string; key?: string; model?: string; prompt?: string } | undefined : undefined
  let apiKey: string | undefined = keys[api]
  // Key/URL 缺失时降级到默认免费引擎：这些入口没有弹窗 UI，静默失败等于功能消失
  if (api === 'custom' && !customConfig?.url) {
    console.warn('[QT] 自定义 API 未配置 URL，降级到 microsoft')
    api = 'microsoft'
    customConfig = undefined
    apiKey = undefined
  } else if (api !== 'custom' && getMeta(api).needKey && !apiKey) {
    console.warn(`[QT] ${getMeta(api).name} 未配置 Key，降级到 microsoft`)
    api = 'microsoft'
    apiKey = undefined
  }
  const exclude = typeof stored.qt_immersive_exclude === 'string'
    ? stored.qt_immersive_exclude.split('\n').map(s => s.trim()).filter(Boolean)
    : []
  return {
    api,
    apiKey,
    customConfig,
    mode: (stored.qt_immersive_mode as 'bilingual' | 'translated-only') || 'bilingual',
    all: true,
    to: (stored.qt_immersive_to as string) || (stored.qt_to as string) || 'zh',
    excludeSelectors: exclude,
    style: (stored.qt_immersive_style as 'underline' | 'dashed' | 'quote' | 'none') || 'underline',
    toggle,
  }
}

async function startImmersive(tabId: number, toggle: boolean) {
  try {
    const payload = await buildImmersivePayload(toggle)
    await chrome.tabs.sendMessage(tabId, { type: 'qt-immersive-translate', payload })
    chrome.action?.setBadgeText({ text: '', tabId }).catch(() => {})
  } catch (e) {
    // 不可注入页面（chrome:// 等）或组装失败：图标角标提示 3 秒，不再完全静默
    console.warn('[QT] immersive trigger failed:', e instanceof Error ? e.message : e)
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
      await chrome.action.setBadgeText({ text: '!', tabId })
      setTimeout(() => { chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}) }, 3000)
    } catch {}
  }
}

// ============================================
// 在途请求管理：content script 取消翻译时真正 abort 网络请求
// ============================================

const activeSessions = new Map<string, Set<AbortController>>()

function abortSession(sessionId?: string) {
  if (!sessionId) return
  const ctrls = activeSessions.get(sessionId)
  if (!ctrls) return
  ctrls.forEach(c => c.abort())
  activeSessions.delete(sessionId)
}

function trackController(sessionId: string | undefined, ctrl: AbortController) {
  if (!sessionId) return
  const set = activeSessions.get(sessionId) || new Set<AbortController>()
  set.add(ctrl)
  activeSessions.set(sessionId, set)
}

function untrackController(sessionId: string | undefined, ctrl: AbortController) {
  if (!sessionId) return
  const set = activeSessions.get(sessionId)
  if (!set) return
  set.delete(ctrl)
  if (set.size === 0) activeSessions.delete(sessionId)
}

// ============================================
// 消息处理：翻译/词典请求集中到 background
// - 绕过目标页面 CSP 限制
// - 缓存共享（所有 tab + popup）
// ============================================
chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
  if (msg.type === 'qt-translate') {
    const p = msg.payload
    translateWithFallback(p.text, p.from, p.to, undefined, p.api, p.apiKey, p.customConfig)
      .then((result: TranslateResult) => sendResponse({ result }))
      .catch((err: Error) => {
        console.warn('[QT] translate failed:', err?.message)
        sendResponse({ error: err?.message || 'translate failed' })
      })
    return true // 异步响应
  }
  if (msg.type === 'qt-dict') {
    const { text, mode } = msg.payload || {}
    const promise: Promise<DictResult | null> =
      mode === 'local' ? localDict(text) :
      mode === 'online' ? onlineLookup(text) :
      lookupDict(text)
    promise
      .then((result) => sendResponse({ result }))
      .catch((err) => {
        console.warn('[QT] dict failed:', err?.message || err)
        sendResponse({ result: null })
      })
    return true
  }
  if (msg.type === 'qt-batch-translate') {
    const { texts, from, to, api, apiKey, customConfig, sessionId } = msg.payload
    const ctrl = new AbortController()
    trackController(sessionId, ctrl)
    translateBatchWithFallback(texts, from, to, ctrl.signal, api, apiKey, customConfig)
      .then((results) => sendResponse({ results }))
      .catch(() => sendResponse({ results: texts.map(() => null) }))
      .finally(() => untrackController(sessionId, ctrl))
    return true
  }
  if (msg.type === 'qt-ai-translate') {
    // AI 对照翻译：与主引擎无关的附加译文，未配置/失败时 skip（UI 静默）
    const { text, from, to } = msg.payload
    aiCompareTranslate(text, from, to, AbortSignal.timeout(20000))
      .then(result => sendResponse(result ? { result } : { skip: true }))
      .catch(() => sendResponse({ skip: true }))
    return true
  }
  if (msg.type === 'qt-test-api') {
    // 直连引擎（不走缓存/熔断），真实校验 key 有效性；15s 超时防引擎悬挂卡死测试按钮
    const { api, apiKey, customConfig } = msg.payload
    const signal = AbortSignal.timeout(15000)
    const testPromise: Promise<TranslateResult> = api === 'custom' && customConfig
      ? customTranslate('Hello, world!', 'en', 'zh', customConfig, signal)
      : getTranslator(api).translate('Hello, world!', 'en', 'zh', apiKey, signal)
    testPromise
      .then(result => sendResponse({ ok: true, text: result.text }))
      .catch((err: Error) => sendResponse({ ok: false, error: err?.message || 'connection failed' }))
    return true
  }
  if (msg.type === 'qt-immersive-auto') {
    // 自动翻译本站：content script 页面加载时发起，payload 组装后回送原 tab
    if (_sender.tab?.id) startImmersive(_sender.tab.id, false)
    sendResponse({})
    return false
  }
  if (msg.type === 'qt-cancel') {
    abortSession(msg.payload?.sessionId)
    sendResponse({})
    return false
  }
  return false
})
