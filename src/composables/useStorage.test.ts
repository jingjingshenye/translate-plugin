import { describe, it, expect, beforeEach } from 'vitest'
import { installChromeMock } from '../test/chrome-mock'
import { useStorage } from './useStorage'
import { useHistory } from './useHistory'

beforeEach(() => {
  installChromeMock()
})

const flush = () => new Promise(r => setTimeout(r, 0))

describe('useStorage 类型守卫（坏数据自愈）', () => {
  it('数组 key 被写成字符串时：回退默认值，并把默认值修复写回 storage', async () => {
    const { localStore } = installChromeMock({ qt_history: 'bad-string' })
    const items = useStorage<string[]>('qt_history', [])
    await flush()
    expect(items.value).toEqual([])
    expect(localStore.qt_history).toEqual([])
  })

  it('正常数组值照常读取', async () => {
    installChromeMock({ qt_list: ['a', 'b'] })
    const s = useStorage<string[]>('qt_list', [])
    await flush()
    expect(s.value).toEqual(['a', 'b'])
  })

  it('对象默认值不接受字符串存储值', async () => {
    const { localStore } = installChromeMock({ qt_custom_api: 'oops' })
    const s = useStorage('qt_custom_api', { url: '', key: '' })
    await flush()
    expect(s.value).toEqual({ url: '', key: '' })
    expect(localStore.qt_custom_api).toEqual({ url: '', key: '' })
  })

  it('字符串默认值照常读取字符串', async () => {
    installChromeMock({ qt_api: 'google' })
    const s = useStorage<string>('qt_api', 'microsoft')
    await flush()
    expect(s.value).toBe('google')
  })

  it('完整用户时序：坏数据自愈 → 修改 → 写入持久化 → 重新读取保持', async () => {
    const mock = installChromeMock({ qt_fallback_disabled: 'bad-string' })
    const s = useStorage<string[]>('qt_fallback_disabled', [])
    await flush()
    expect(s.value).toEqual([])

    // 模拟用户取消勾选 Google（Options.toggleFallback 的实际操作）
    s.value = [...s.value, 'google']
    await flush() // 等 watch 写入 + onChanged 回流
    await flush()
    expect(mock.localStore.qt_fallback_disabled).toEqual(['google'])

    // 模拟刷新页面：新的 useStorage 实例从 storage 读取
    const s2 = useStorage<string[]>('qt_fallback_disabled', [])
    await flush()
    expect(s2.value).toEqual(['google'])
  })

  it('核心回归防护：数组写入 storage 后仍是数组（Proxy 序列化不降级）', async () => {
    const mock = installChromeMock()
    const s = useStorage<string[]>('qt_arr', [])
    await flush()
    s.value = ['google']
    await flush()
    await flush()
    expect(Array.isArray(mock.localStore.qt_arr)).toBe(true)
    expect(mock.localStore.qt_arr).toEqual(['google'])
  })

  it('历史坏数据 {"0":"google"} 自动恢复为数组（不丢失用户设置）', async () => {
    installChromeMock({ qt_fallback_disabled: { '0': 'google' } })
    const s = useStorage<string[]>('qt_fallback_disabled', [])
    await flush()
    expect(s.value).toEqual(['google'])
  })

  it('非数字键对象不误判为数组', async () => {
    installChromeMock({ qt_words: { hello: { createdAt: 1 } } })
    const s = useStorage<Record<string, { createdAt: number }>>('qt_words', {})
    await flush()
    expect(s.value).toEqual({ hello: { createdAt: 1 } })
  })
})

describe('useHistory 坏数据防御', () => {
  it('storage 中 qt_history 为坏值时 add/remove 不崩且自愈', async () => {
    installChromeMock({ qt_history: 'bad-string' })
    const { add, remove, list } = useHistory()
    await flush() // 等 useStorage 初始化与修复完成
    add({ text: 'hello', translation: '你好', api: 'microsoft', srcLang: 'EN' })
    expect(list.value.length).toBe(1)
    remove('hello')
    expect(list.value.length).toBe(0)
  })
})
