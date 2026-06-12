import { createApp } from 'vue'
import App from './views/App.vue'

const container = document.createElement('div')
container.id = __NAME__
const root = document.createElement('div')
const styleEl = document.createElement('link')

// Shadow DOM 样式隔离（业界标准）
const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container
styleEl.setAttribute('rel', 'stylesheet')
styleEl.setAttribute('href', chrome.runtime.getURL('dist/contentScripts/style.css'))
shadowDOM.appendChild(styleEl)
shadowDOM.appendChild(root)
document.body.appendChild(container)

createApp(App).mount(root)
