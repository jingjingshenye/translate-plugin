import { ref, watch, onUnmounted, type Ref } from 'vue'

export function useStorage<T>(key: string, defaultValue: T): Ref<T> {
  const data = ref<T>(defaultValue) as Ref<T>
  let ignoreWatch = true // 初始化期间禁止写，避免覆盖已有值
  let ready = false

  chrome.storage.local.get(key).then(result => {
    if (result[key] !== undefined) {
      (data as Ref<T>).value = result[key]
    }
    ignoreWatch = false
    ready = true
  }).catch(() => { ignoreWatch = false; ready = true })

  watch(data, (val) => {
    if (ignoreWatch) return
    chrome.storage.local.set({ [key]: val })
  }, { deep: true })

  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[key]) {
      ignoreWatch = true
      ;(data as Ref<T>).value = changes[key].newValue
      ignoreWatch = false
    }
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => chrome.storage.onChanged.removeListener(listener))

  return data
}
