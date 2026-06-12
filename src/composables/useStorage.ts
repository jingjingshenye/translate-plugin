import { ref, watch, onUnmounted } from 'vue'

export function useStorage<T>(key: string, defaultValue: T) {
  const data = ref<T>(defaultValue) as any
  let ignoreWatch = false

  // 读取
  chrome.storage.local.get(key).then(result => {
    if (result[key] !== undefined) {
      data.value = result[key]
    }
  })

  // 写入
  watch(data, (val) => {
    if (ignoreWatch) return
    chrome.storage.local.set({ [key]: val })
  }, { deep: true })

  // 监听外部变更
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[key]) {
      ignoreWatch = true
      data.value = changes[key].newValue
      ignoreWatch = false
    }
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => chrome.storage.onChanged.removeListener(listener))

  return data
}
