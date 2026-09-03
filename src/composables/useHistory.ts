import { computed, type ComputedRef, type Ref } from 'vue'
import { useStorage } from './useStorage'

// 翻译历史：最近 100 条成功翻译，同文本去重（重译后提到最前）

export interface HistoryItem {
  text: string
  translation: string
  api: string
  srcLang: string
  ts: number
}

const HISTORY_MAX = 100

export function useHistory(): {
  items: Ref<HistoryItem[]>
  list: ComputedRef<HistoryItem[]>
  add: (item: Omit<HistoryItem, 'ts'>) => void
  remove: (text: string) => void
  clear: () => void
  exportList: () => string
} {
  const items = useStorage<HistoryItem[]>('qt_history', [])

  // 防御：storage 坏数据（非数组）时不崩，按空处理
  function current(): HistoryItem[] {
    return Array.isArray(items.value) ? items.value : []
  }

  function add(item: Omit<HistoryItem, 'ts'>) {
    if (!item.text || !item.translation) return
    const rest = current().filter(i => i.text !== item.text)
    items.value = [{ ...item, ts: Date.now() }, ...rest].slice(0, HISTORY_MAX)
  }

  function remove(text: string) {
    items.value = current().filter(i => i.text !== text)
  }

  function clear() {
    items.value = []
  }

  function exportList(): string {
    return items.value
      .map(i => `${i.text}\t${i.translation}`)
      .join('\n')
  }

  const list = computed(() => items.value)

  return { items, list, add, remove, clear, exportList }
}
