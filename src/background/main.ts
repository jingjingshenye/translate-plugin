import { translateWithFallback, translateBatchWithFallback, customTranslate, getTranslator, aiCompareTranslate, type TranslateResult } from '~/logic/translate'
import { localDict, lookupDict, onlineLookup, type DictResult } from '~/logic/dict'
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
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'translate-text',
      text: info.selectionText,
    }).catch(() => {})
  }
})

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
  if (msg.type === 'qt-cancel') {
    abortSession(msg.payload?.sessionId)
    sendResponse({})
    return false
  }
  return false
})
