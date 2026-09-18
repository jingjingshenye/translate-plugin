// 语言工具：纯函数，无网络/状态依赖
// 让 content script 不必为 detectLang 拉入整个 translate.ts

export function detectLang(text: string): string {
  const t = text.trim()
  if (!t) return 'en'
  // 独占文字系统优先判（无歧义）；日文必含假名，须先于汉字比例判断，
  // 否则汉字占比高的日文文本会被误判为中文
  if (/[぀-ヿ]/.test(t)) return 'ja'
  if (/[가-힯]/.test(t)) return 'ko'
  if (/[Ѐ-ӿ]/.test(t)) return 'ru'
  if (/[؀-ۿ]/.test(t)) return 'ar'
  const zhRatio = (t.match(/[一-鿿]/g) || []).length / t.length
  if (zhRatio > 0.3) return 'zh'
  return 'en'
}

export function getTargetLang(srcLang: string): string {
  return srcLang === 'zh' ? 'en' : 'zh'
}

// 页面级语言检测：优先 chrome.i18n（CLD 模型，整页样本准确率高），
// 不可用/低置信时回退脚本字符启发式（content script 无 chrome.i18n 的极端场景）
export async function detectPageLang(text: string): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.detectLanguage) {
      const res = await chrome.i18n.detectLanguage(text.slice(0, 3000))
      const top = res?.languages?.[0]
      const map: Record<string, string> = {
        zh: 'zh', 'zh-CN': 'zh', 'zh-TW': 'zh',
        en: 'en', ja: 'ja', ko: 'ko', ru: 'ru', ar: 'ar',
      }
      const hit = top ? map[top.language] : undefined
      // 低置信（占比过低）的混合样本回退启发式，避免误判"无需翻译"
      if (hit && (top!.percentage ?? 100) >= 5) return hit
    }
  } catch {}
  return detectLang(text)
}
