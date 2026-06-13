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
  .qt-lang-wrap { position:relative }
  .qt-lang-btn { padding:2px 8px; font-size:10px; border:1px solid rgba(56,189,248,.25); background:transparent; color:#0ea5e9; border-radius:3px; cursor:pointer; transition:all .15s }
  .qt-lang-btn:hover { background:rgba(14,165,233,.1) }
  .qt-lang-menu { position:absolute; top:100%; right:0; margin-top:4px; background:#f0f9ff; border:1px solid rgba(56,189,248,.25); border-radius:6px; padding:8px; z-index:10; box-shadow:0 4px 12px rgba(0,0,0,.15); min-width:200px }
  .qt-lang-row { display:flex; align-items:center; gap:6px; margin-bottom:6px }
  .qt-lang-sel { flex:1; padding:4px 6px; font-size:11px; border:1px solid rgba(56,189,248,.2); border-radius:4px; background:#fff; color:#0c4a6e; outline:none }
  .qt-lang-sel:focus { border-color:#38bdf8 }
  .qt-lang-arrow { color:#0ea5e9; font-size:12px }
  .qt-lang-go { width:100%; padding:4px 0; font-size:11px; border:none; border-radius:4px; background:linear-gradient(135deg,#0ea5e9,#38bdf8); color:#fff; cursor:pointer; font-weight:600 }
  .qt-fav-btn { padding:2px 6px; font-size:14px; border:1px solid rgba(56,189,248,.25); background:transparent; color:#ef4444; border-radius:3px; cursor:pointer; transition:all .15s; line-height:1 }
  .qt-fav-btn:hover { background:rgba(239,68,68,.1) }
  .qt-close { color:#64748b; cursor:pointer; font-size:14px; line-height:1; transition:color .15s }
  .qt-close:hover { color:#ef4444 }
  .qt-body { padding:8px 12px 10px }
  .qt-label { color:#64748b; font-size:12px; margin-bottom:3px; text-transform:uppercase; letter-spacing:.5px }
  .qt-label-accent { color:#0ea5e9 }
  .qt-source { color:#0c4a6e; font-size:12px; line-height:1.4; max-height:60px; overflow-y:auto; word-break:break-all; margin-bottom:6px }
  .qt-dict-tag { margin-bottom:4px }
  .qt-dict-badge { font-size:9px; color:#10b981; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:3px; font-weight:600; letter-spacing:.5px }
  .qt-trans-tag { margin-bottom:4px; margin-top:6px }
  .qt-trans-badge { font-size:9px; color:#3b82f6; background:rgba(59,130,246,0.1); padding:2px 6px; border-radius:3px; font-weight:600; letter-spacing:.5px }
  .qt-divider { border-top:1px solid rgba(56,189,248,.12); padding-top:6px }
  .qt-loading { display:flex; align-items:center; gap:6px; padding:4px 0; color:#0ea5e9; font-size:12px }
  .qt-spinner { width:12px; height:12px; border:2px solid rgba(56,189,248,.12); border-top-color:#0ea5e9; border-radius:50%; animation:qt-spin .7s linear infinite; display:inline-block }
  @keyframes qt-spin { to { transform:rotate(360deg) } }
  .qt-error { color:#dc2626; font-size:12px; padding:4px 0 }
  .qt-result { color:#0c4a6e; font-size:12px; line-height:1.5; max-height:200px; overflow-y:auto; word-break:break-all }
  .qt-phonetic { display:flex; gap:12px; margin-bottom:6px; padding:4px 0 }
  .qt-phonetic-item { font-size:12px; color:#0c4a6e; display:flex; align-items:center; gap:3px }
  .qt-bing-link { font-size:10px; color:#0ea5e9; text-decoration:none; margin-left:6px; opacity:.7; transition:opacity .15s }
  .qt-bing-link:hover { opacity:1; text-decoration:underline }
  .qt-speaker { font-size:11px }
  .qt-dict-loading { display:flex; align-items:center; gap:6px; padding:4px 0; color:#0ea5e9; font-size:11px }
  .qt-defs { margin-bottom:6px }
  .qt-def-item { font-size:12px; line-height:1.6; color:#0c4a6e; padding:1px 0 }
  .qt-pos { color:#0ea5e9; font-weight:600; margin-right:4px }
  .qt-def { color:#334155 }
  .qt-presents { font-size:11px; color:#64748b; margin-bottom:6px; padding:2px 0 }
  .qt-ecs { margin-bottom:6px }
  .qt-ecs-title { font-size:10px; color:#0ea5e9; font-weight:600; margin-bottom:4px }
  .qt-ecs-group { margin-bottom:4px }
  .qt-ecs-pos { font-size:11px; color:#0ea5e9; font-weight:500; margin-bottom:2px }
  .qt-ecs-item { font-size:11px; color:#334155; line-height:1.5; padding-left:8px }
  .qt-sentences { margin-bottom:6px }
  .qt-sent-title { font-size:10px; color:#64748b; margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px }
  .qt-sent-item { margin-bottom:6px }
  .qt-sent-en { font-size:11px; color:#334155; line-height:1.5 }
  .qt-sent-zh { font-size:11px; color:#94a3b8; line-height:1.5; font-style:italic }
`
document.head.appendChild(style)

const container = document.createElement('div')
container.id = __NAME__
document.body.appendChild(container)

createApp(App).mount(container)
