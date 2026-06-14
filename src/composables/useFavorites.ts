import { computed, type Ref } from 'vue'
import { useStorage } from '~/composables/useStorage'

export interface FavWord {
  createdAt: number
  translation?: string
}

export function useFavorites() {
  // 每次调用都创建新的 useStorage：避免模块级单例在 mount→unmount→remount 时
  // onUnmounted 把 listener 清掉后无法恢复。多个组件实例通过 chrome.storage.onChanged 自动同步。
  const words = useStorage<Record<string, FavWord>>('qt_words', {})

  function toggle(word: string, translation?: string) {
    const w = { ...words.value }
    if (w[word]) {
      delete w[word]
    } else {
      w[word] = { createdAt: Date.now(), translation }
    }
    words.value = w
  }

  function has(word: string): boolean {
    return !!words.value[word]
  }

  function remove(word: string) {
    const w = { ...words.value }
    delete w[word]
    words.value = w
  }

  function setTranslation(word: string, translation: string) {
    if (!words.value[word]) return
    words.value = { ...words.value, [word]: { ...words.value[word], translation } }
  }

  function clear() {
    words.value = {}
  }

  function exportList(): string {
    return Object.entries(words.value)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([word, data]) => `${word}${data.translation ? '\t' + data.translation : ''}`)
      .join('\n')
  }

  function importList(text: string) {
    const w = { ...words.value }
    text.split('\n').forEach(line => {
      const parts = line.trim().split('\t')
      const word = parts[0]?.trim()
      if (word && !w[word]) {
        w[word] = { createdAt: Date.now(), translation: parts[1]?.trim() }
      }
    })
    words.value = w
  }

  const list = computed(() =>
    Object.entries(words.value).sort((a, b) => a[0].localeCompare(b[0]))
  )

  const count = computed(() => Object.keys(words.value).length)

  return { words, list, count, toggle, has, remove, setTranslation, clear, exportList, importList }
}
