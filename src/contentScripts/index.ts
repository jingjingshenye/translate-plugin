import './immersive/controller'
import styleText from './style.css?inline'

const style = document.createElement('style')
style.textContent = styleText
document.head.appendChild(style)

// 划词 UI（Vue 应用）按需加载：bootstrap 只含触发逻辑与全文翻译控制器，
// 首次需要 UI 时才动态 import 分包，避免每 frame 都解析几十 KB 的 Vue
let uiPromise: Promise<void> | null = null
let uiContainer: HTMLElement | null = null

function loadUI(): Promise<void> {
  if (uiPromise) return uiPromise
  const container = document.createElement('div')
  container.id = __NAME__
  container.setAttribute('data-qt', '')
  document.body.appendChild(container)
  uiContainer = container
  const uiUrl = chrome.runtime.getURL('dist/contentScripts/ui.js')
  uiPromise = import(/* @vite-ignore */ uiUrl)
    .then(m => { m.mountUI(container); })
    .catch(e => {
      console.warn('[QT] UI 分包加载失败:', e)
      uiContainer?.remove()
      uiContainer = null
      uiPromise = null
      appMounted = false
      throw e
    })
  return uiPromise
}

let appMounted = false

// 兜底：requestIdleCallback 前 document.body 可能尚未就绪
function ensureBody(): boolean {
  if (document.body) return true
  return false
}

function requestMountApp() {
  if (appMounted || !ensureBody()) return
  appMounted = true
  loadUI().catch(() => {})
}

// 懒挂载：document_end 时主线程常被页面初始化占用，等空闲再加载 UI 分包；
// IIFE 单文件打包下无法按需加载 bundle，这里只推迟加载与实例化开销
if ('requestIdleCallback' in window) {
  const tick = () => (ensureBody() ? requestMountApp() : setTimeout(tick, 120))
  requestIdleCallback(tick, { timeout: 2000 })
} else {
  setTimeout(requestMountApp, 300)
}

// 首次 mouseup 时若尚未挂载：同步挂载后重放本次事件，
// 否则 App 错过这次 mouseup、划词无反应
document.addEventListener('mouseup', function bootstrap(e: MouseEvent) {
  document.removeEventListener('mouseup', bootstrap)
  if (appMounted) return
  if (!ensureBody()) return
  appMounted = true
  loadUI()
    .then(() => {
      const replay = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: e.button,
        clientX: e.clientX, clientY: e.clientY,
      })
      ;(e.target as EventTarget | null)?.dispatchEvent(replay)
    })
    .catch(() => {})
}, { capture: true })

// 右键菜单翻译：App 可能尚未挂载，先确保挂载，再经 window 事件转发给它。
// 消息会广播到 tab 的所有 frame，仅顶层响应，避免 iframe 内重复弹窗
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translate-text' && msg.text) {
    if (window.self !== window.top) return
    if (!ensureBody()) return
    appMounted = true
    // mountUI 是同步 mount，loadUI resolve 时 App 的 window 监听已就绪
    loadUI()
      .then(() => window.dispatchEvent(new CustomEvent('qt-translate-text', { detail: msg.text })))
      .catch(() => {})
  }
})
