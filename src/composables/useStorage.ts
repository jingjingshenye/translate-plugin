import { ref, watch, onUnmounted, type Ref } from 'vue'

export function useStorage<T>(key: string, defaultValue: T): Ref<T> {
  const data = ref<T>(defaultValue)
  let ignoreWatch = false

  // 读取
  chrome.storage.local.get(key).then(result => {
    if (result[key] !== undefined) {
      (data as Ref<T>).value = result[key]
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
      (data as Ref<T>).value = changes[key].newValue
      ignoreWatch = false
    }
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => chrome.storage.onChanged.removeListener(listener))

  return data as Ref<T>
}
