// 语言工具：纯函数，无网络/状态依赖
// 让 content script 不必为 detectLang 拉入整个 translate.ts

export function detectLang(text: string): string {
  const t = text.trim()
  if (!t) return 'en'
  const zhRatio = (t.match(/[一-鿿]/g) || []).length / t.length
  if (zhRatio > 0.3) return 'zh'
  if (/[぀-ゟ゠-ヿ]/.test(t)) return 'ja'
  if (/[가-힯]/.test(t)) return 'ko'
  if (/[Ѐ-ӿ]/.test(t)) return 'ru'
  if (/[؀-ۿ]/.test(t)) return 'ar'
  return 'en'
}

export function getTargetLang(srcLang: string): string {
  return srcLang === 'zh' ? 'en' : 'zh'
}
