import { createApp } from 'vue'
import App from './views/App.vue'
import styleText from './style.css?inline'
import './immersive/controller'

const style = document.createElement('style')
style.textContent = styleText
document.head.appendChild(style)

// 懒挂载：document_end 时主线程常被页面初始化占用，等空闲再实例化 Vue；
// IIFE 单文件打包下无法按需加载 bundle，这里只推迟实例化开销
let appMounted = false

function mountApp() {
  if (appMounted) return
  appMounted = true
  const container = document.createElement('div')
  container.id = __NAME__
  container.setAttribute('data-qt', '')
  document.body.appendChild(container)
  createApp(App).mount(container)
}

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => mountApp(), { timeout: 2000 })
} else {
  setTimeout(mountApp, 300)
}

// 首次 mouseup 时若尚未挂载：同步挂载后重放本次事件，
// 否则 App 错过这次 mouseup、划词无反应
document.addEventListener('mouseup', function bootstrap(e: MouseEvent) {
  document.removeEventListener('mouseup', bootstrap)
  if (appMounted) return
  mountApp()
  const replay = new MouseEvent('mouseup', {
    bubbles: true, cancelable: true, button: e.button,
    clientX: e.clientX, clientY: e.clientY,
  })
  ;(e.target as EventTarget | null)?.dispatchEvent(replay)
}, { capture: true })

// 右键菜单翻译：App 可能尚未挂载，先确保挂载，再经 window 事件转发给它
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translate-text' && msg.text) {
    mountApp()
    window.dispatchEvent(new CustomEvent('qt-translate-text', { detail: msg.text }))
  }
})
