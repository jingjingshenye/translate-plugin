import { createApp } from 'vue'
import App from './views/App.vue'
import styleText from './style.css?inline'
import './immersive/controller'

const style = document.createElement('style')
style.textContent = styleText
document.head.appendChild(style)

const container = document.createElement('div')
container.id = __NAME__
container.setAttribute('data-qt', '')
document.body.appendChild(container)

createApp(App).mount(container)
