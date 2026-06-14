import { createApp } from 'vue'
import App from './views/App.vue'
import styleText from './style.css?inline'

// 注入隔离样式到主页面（content script 标准做法）
const style = document.createElement('style')
style.textContent = styleText
document.head.appendChild(style)

const container = document.createElement('div')
container.id = __NAME__
container.setAttribute('data-qt', '')
document.body.appendChild(container)

createApp(App).mount(container)
