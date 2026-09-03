// 译文朗读：浏览器内置 speechSynthesis，无需任何外部 API

const SPEAK_LANG: Record<string, string> = {
  zh: 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR',
  fr: 'fr-FR', de: 'de-DE', es: 'es-ES', ru: 'ru-RU', ar: 'ar-SA',
}

export function speak(text: string, langCode: string): void {
  if (!text) return
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = SPEAK_LANG[langCode] || 'zh-CN'
    u.rate = 1
    speechSynthesis.speak(u)
  } catch {}
}

export function stopSpeak(): void {
  try { speechSynthesis.cancel() } catch {}
}
