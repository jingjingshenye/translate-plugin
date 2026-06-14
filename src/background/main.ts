import { translateWithFallback, type TranslateResult } from '~/logic/translate'
import { localDict, bingDict, lookupDict, onlineLookup, type DictResult } from '~/logic/dict'

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
// 消息处理：翻译/词典请求集中到 background
// - 绕过目标页面 CSP 限制
// - 缓存共享（所有 tab + popup）
// ============================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
  if (msg.type === 'qt-cancel') {
    sendResponse({})
    return false
  }
  return false
})
