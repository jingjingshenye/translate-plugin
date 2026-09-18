import { createApp } from 'vue'
import App from './App.vue'

// UI 分包入口：bootstrap 动态 import 本模块后挂载划词弹窗。
// 必须暴露具名导出（不能只有副作用），否则 IIFE 化的调用方拿不到挂载函数
export function mountUI(container: HTMLElement) {
  createApp(App).mount(container)
}
