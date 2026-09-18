// Offscreen document 入口：为 service worker 提供 DOMParser 能力。
// MV3 service worker 无 DOM/DOMParser，Bing 词典 HTML 解析在此完成
import { parseBingHtml } from '~/logic/bing-parse'

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'qt-parse-bing' && typeof msg.html === 'string') {
    try {
      sendResponse({ result: parseBingHtml(msg.html) })
    } catch (e) {
      sendResponse({ error: e instanceof Error ? e.message : String(e) })
    }
    return false
  }
  return false
})
