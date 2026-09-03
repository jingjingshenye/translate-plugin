// 测试用 chrome API 内存 mock：storage.local / storage.session / runtime.getURL
import { vi } from 'vitest'
import { isProxy } from 'vue'

export function installChromeMock(initial: Record<string, any> = {}) {
  const localStore: Record<string, any> = { ...initial }
  const sessionStorage: Record<string, any> = {}
  const listeners: Array<(changes: Record<string, any>) => void> = []

  function makeArea(store: Record<string, any>) {
    return {
      get: async (keys?: string | string[] | Record<string, any> | null) => {
        if (keys == null) return { ...store }
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {}
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))
        }
        const out: Record<string, any> = {}
        for (const [k, v] of Object.entries(keys as Record<string, any>)) out[k] = k in store ? store[k] : v
        return out
      },
      set: async (items: Record<string, any>) => {
        // 模拟真实 Chrome 的两个序列化行为：
        // 1. 结构化克隆：存储与事件都传新引用（内容相同引用不同）
        // 2. Proxy 降级：Vue 的 reactive Proxy 数组会丢失数组身份变成普通对象
        //    （["a"] → {"0":"a"}），真实 Chrome 正是如此——忘记剥 Proxy 的写入会在测试里暴露
        const cp = (x: any) => JSON.parse(JSON.stringify(x))
        const degrade = (v: any) => (isProxy(v) ? { ...(v as object) } : v)
        const changes: Record<string, any> = {}
        for (const [k, v] of Object.entries(items)) {
          const degraded = degrade(v)
          changes[k] = { oldValue: store[k], newValue: cp(degraded) }
          store[k] = cp(degraded)
        }
        listeners.forEach(l => l(cp(changes)))
      },
    }
  }

  const chromeMock: any = {
    storage: {
      local: makeArea(localStore),
      session: makeArea(sessionStorage),
      onChanged: {
        addListener: (l: (changes: Record<string, any>) => void) => listeners.push(l),
        removeListener: (l: (changes: Record<string, any>) => void) => {
          const i = listeners.indexOf(l)
          if (i >= 0) listeners.splice(i, 1)
        },
      },
    },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  }
  vi.stubGlobal('chrome', chromeMock)
  return { localStore, sessionStorage }
}
