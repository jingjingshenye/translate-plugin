import type { App } from 'vue'

export function setupApp(app: App) {
  app.config.globalProperties.$app = { context: '' }
  app.provide('app', app.config.globalProperties.$app)
}
