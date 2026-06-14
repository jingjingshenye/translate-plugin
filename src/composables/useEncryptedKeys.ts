import { ref, watch, onUnmounted, type Ref } from 'vue'
import { encryptKeys, decryptKeys } from '~/logic/crypto'

// API Keys 加密存储：返回明文 ref，写入时自动加密、读取时自动解密
// 解决循环更新：用 lastEncrypted 哈希比对，避免 plain→encrypt→storage→decrypt→plain 死循环
export function useEncryptedKeys(storageKey: string): Ref<Record<string, string>> {
  const plain = ref<Record<string, string>>({})
  let syncing = false
  let lastEncrypted = '{}'

  async function syncFromStorage() {
    try {
      const stored = await chrome.storage.local.get(storageKey)
      const enc = stored[storageKey] || {}
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

  watch(plain, async (val) => {
    if (syncing) return
    try {
      const enc = await encryptKeys(val)
      const encStr = JSON.stringify(enc)
      if (encStr === lastEncrypted) return
      lastEncrypted = encStr
      await chrome.storage.local.set({ [storageKey]: enc })
    } catch (e) {
      console.warn('[QT] useEncryptedKeys write error:', e)
    }
  }, { deep: true })

  syncFromStorage()

  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[storageKey]) syncFromStorage()
  }
  chrome.storage.onChanged.addListener(listener)
  onUnmounted(() => chrome.storage.onChanged.removeListener(listener))

  return plain as Ref<Record<string, string>>
}
