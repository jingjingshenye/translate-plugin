import { describe, it, expect } from 'vitest'
import { detectLang, getTargetLang } from './lang-utils'

describe('detectLang', () => {
  it('中文文本识别为 zh', () => {
    expect(detectLang('这是一段中文文本，用来测试语言检测')).toBe('zh')
  })

  it('汉字占比高的日文不再误判为中文（回归：假名优先）', () => {
    // 汉字 7/12 ≈ 58% > 30%，修复前会被判为 zh 导致划词不显示图标
    expect(detectLang('東京都は日本の首都です')).toBe('ja')
    expect(detectLang('これはテストです')).toBe('ja')
  })

  it('纯汉字（无假名）仍判为中文', () => {
    expect(detectLang('東京都日本首都')).toBe('zh')
  })

  it('韩文 / 俄文 / 阿拉伯文', () => {
    expect(detectLang('안녕하세요 반갑습니다')).toBe('ko')
    expect(detectLang('Привет мир')).toBe('ru')
    expect(detectLang('مرحبا بالعالم')).toBe('ar')
  })

  it('英文与空文本', () => {
    expect(detectLang('The quick brown fox')).toBe('en')
    expect(detectLang('   ')).toBe('en')
  })
})

describe('getTargetLang', () => {
  it('中文→英文，其他→中文', () => {
    expect(getTargetLang('zh')).toBe('en')
    expect(getTargetLang('en')).toBe('zh')
    expect(getTargetLang('ja')).toBe('zh')
  })
})
