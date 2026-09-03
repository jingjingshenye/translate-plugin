import { ref, watch, onUnmounted, type Ref } from 'vue'
import { encryptKeys, decryptKeys } from '~/logic/crypto'

// API Keys 加密存储：返回明文 ref，写入时自动加密、读取时自动解密
// 解决循环更新：用 lastEncrypted 哈希比对，避免 plain→encrypt→storage→decrypt→plain 死循环

const WRITE_DEBOUNCE = 300

export function useEncryptedKeys(storageKey: string): Ref<Record<string, string>> {
  const plain = ref<Record<string, string>>({})
  let syncing = false
  let lastEncrypted = '{}'
  let writeTimer: ReturnType<typeof setTimeout> | null = null

  async function syncFromStorage() {
    try {
      const stored = await chrome.storage.local.get(storageKey)
      const enc = (stored[storageKey] as Record<string, string>) || {}
      const encStr = JSON.stringify(enc)
      if (encStr === lastEncrypted) return
      lastEncrypted = encStr
      syncing = true
      if (Object.keys(enc).length === 0) {
        plain.value = {}
      } else {
        plain.value = await decryptKeys(enc)
      }
      syncing = false
    } catch (e) {
      console.warn('[QT] useEncryptedKeys sync error:', e)
      syncing = false
    }
  }

  // 每敲一个字符就全量 AES 加密 + 写 storage 太重，去抖合并；卸载时冲刷防丢
  function flushWrite() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null }
    encryptKeys(plain.value).then((enc) => {
      const encStr = JSON.stringify(enc)
      if (encStr === lastEncrypted) return
      lastEncrypted = encStr
      return chrome.storage.local.set({ [storageKey]: enc })
    }).catch((e) => console.warn('[QT] useEncryptedKeys write error:', e))
  }

  watch(plain, () => {
    if (syncing) return
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = setTimeout(flushWrite, WRITE_DEBOUNCE)
  }, { deep: true })

  syncFromStorage()

  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[storageKey]) syncFromStorage()
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => {
    chrome.storage.onChanged.removeListener(listener)
    flushWrite()
  })

  return plain as Ref<Record<string, string>>
}
