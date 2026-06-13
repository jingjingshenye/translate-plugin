import { computed, type Ref } from 'vue'
import { useStorage } from '~/composables/useStorage'

export interface FavWord {
  createdAt: number
  translation?: string
}

// 延迟初始化，避免模块级 useStorage 导致监听器泄漏
let _words: Ref<Record<string, FavWord>> | null = null
function getWords(): Ref<Record<string, FavWord>> {
  if (!_words) _words = useStorage<Record<string, FavWord>>('qt_words', {})
  return _words
}

export function useFavorites() {
  const words = getWords()

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

  return { words, list, count, toggle, has, remove, clear, exportList, importList }
}
