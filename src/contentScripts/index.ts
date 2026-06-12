import { createApp } from 'vue'
import App from './views/App.vue'

// 内联样式注入（避免 CSP 拦截 + 不污染页面）
const style = document.createElement('style')
style.textContent = `
  [data-qt-icon] { all:initial; margin:0; padding:0; border:none; outline:none; position:fixed; z-index:2147483647; width:24px; height:24px; border-radius:5px; background:linear-gradient(135deg,#38bdf8,#7dd3fc); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; font-weight:700; font-family:system-ui,sans-serif; box-shadow:0 0 10px rgba(56,189,248,.5),0 2px 6px rgba(0,0,0,.15); transition:all .15s; user-select:none }
  [data-qt-icon]:hover { transform:scale(1.15); box-shadow:0 0 18px rgba(56,189,248,.7),0 4px 10px rgba(0,0,0,.2) }
  [data-qt-popup] { margin:0; padding:0; border:none; outline:none; position:fixed; z-index:2147483647; width:340px; max-width:90vw; max-height:360px; background:#f0f9ff; border:1px solid rgba(56,189,248,.25); border-radius:8px; overflow:hidden; font-family:system-ui,sans-serif; box-shadow:0 4px 20px rgba(56,189,248,.15),0 6px 24px rgba(0,0,0,.08) }
  [data-qt-popup] * { box-sizing:border-box; margin:0; padding:0 }
  .qt-header { display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:linear-gradient(90deg,rgba(56,189,248,.1),transparent); border-bottom:1px solid rgba(56,189,248,.12) }
  .qt-title { font-size:12px; font-weight:700; letter-spacing:1px; color:#0ea5e9 }
  .qt-header-actions { display:flex; align-items:center; gap:6px }
  .qt-copy-btn { padding:2px 8px; font-size:12px; border:1px solid rgba(56,189,248,.25); background:transparent; color:#0ea5e9; border-radius:3px; cursor:pointer; transition:all .15s }
  .qt-copy-btn:hover { background:rgba(56,189,248,.1) }
  .qt-close { color:#64748b; cursor:pointer; font-size:14px; line-height:1; transition:color .15s }
  .qt-close:hover { color:#ef4444 }
  .qt-body { padding:8px 12px 10px }
  .qt-label { color:#64748b; font-size:12px; margin-bottom:3px; text-transform:uppercase; letter-spacing:.5px }
  .qt-label-accent { color:#0ea5e9 }
  .qt-source { color:#0c4a6e; font-size:12px; line-height:1.4; max-height:60px; overflow-y:auto; word-break:break-all; margin-bottom:6px }
  .qt-divider { border-top:1px solid rgba(56,189,248,.12); padding-top:6px }
  .qt-loading { display:flex; align-items:center; gap:6px; padding:4px 0; color:#0ea5e9; font-size:12px }
  .qt-spinner { width:12px; height:12px; border:2px solid rgba(56,189,248,.12); border-top-color:#0ea5e9; border-radius:50%; animation:qt-spin .7s linear infinite; display:inline-block }
  @keyframes qt-spin { to { transform:rotate(360deg) } }
  .qt-error { color:#dc2626; font-size:12px; padding:4px 0 }
  .qt-result { color:#0c4a6e; font-size:12px; line-height:1.5; max-height:200px; overflow-y:auto; word-break:break-all }
`
document.head.appendChild(style)

const container = document.createElement('div')
container.id = __NAME__
document.body.appendChild(container)

createApp(App).mount(container)
