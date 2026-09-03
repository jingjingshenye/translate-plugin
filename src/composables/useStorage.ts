import { ref, watch, onUnmounted, type Ref } from 'vue'

// chrome.storage 的序列化会把 Vue 响应式 Proxy 数组降级成普通对象（["a"] → {"0":"a"}），
// 写入前必须做纯数据深拷贝剥掉 Proxy，否则所有数组设置读回来都不是数组
function pureClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

// 历史坏数据自愈：{"0":"a","1":"b"} 这种纯数字键对象是曾被 Proxy 序列化毁掉的数组，恢复成数组
function coerceLike(v: unknown, def: unknown): unknown {
  if (Array.isArray(def) && v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v)
    if (keys.every((k, i) => k === String(i))) return keys.map(k => (v as Record<string, unknown>)[k])
  }
  return v
}

// 存储值与默认值类型是否一致（数组默认必须对应数组，对象默认对应对象，标量按 typeof）
// 用于防御 storage 中的坏数据（如被写成字符串的数组），避免 UI 调 .filter/.includes 崩溃
function matchesDefault(v: unknown, def: unknown): boolean {
  if (Array.isArray(def)) return Array.isArray(v)
  if (def !== null && typeof def === 'object') {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  }
  return typeof v === typeof def
}

export function useStorage<T>(key: string, defaultValue: T): Ref<T> {
  const data = ref<T>(defaultValue) as Ref<T>
  let ignoreWatch = true // 初始化期间禁止写，避免覆盖已有值

  chrome.storage.local.get(key).then(result => {
    const stored = coerceLike(result[key], defaultValue)
    if (stored !== undefined) {
      if (matchesDefault(stored, defaultValue)) {
        (data as Ref<T>).value = pureClone(stored) as T
      } else {
        // 坏数据：用默认值修复写回，保证扩展自愈可用
        chrome.storage.local.set({ [key]: pureClone(defaultValue) }).catch(() => {})
      }
    }
    ignoreWatch = false
  }).catch(() => { ignoreWatch = false })

  watch(data, (val) => {
    if (ignoreWatch) return
    chrome.storage.local.set({ [key]: pureClone(val) })
  }, { deep: true })

  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[key]) {
      const next = coerceLike(changes[key].newValue, defaultValue)
      if (matchesDefault(next, defaultValue)) {
        // 回声抑制：storage.set 的 onChanged 也会广播回本页面，且 Chrome 传回的是
        // 结构化克隆的新引用（内容相同引用不同）。若直接赋值会触发 watch 再 set，
        // 形成 set→onChanged→赋值→set 的无限循环，循环中在途旧事件还会覆盖用户刚写的值。
        // 内容与内存一致时跳过赋值即可断链。
        if (JSON.stringify(next) !== JSON.stringify(data.value)) {
          ignoreWatch = true
          ;(data as Ref<T>).value = pureClone(next) as T
          ignoreWatch = false
        }
      } else if (next !== undefined) {
        // 其他上下文写入了坏数据：用当前内存值覆盖回去，防止污染扩散
        chrome.storage.local.set({ [key]: pureClone(data.value) }).catch(() => {})
      }
    }
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => chrome.storage.onChanged.removeListener(listener))

  return data
}
