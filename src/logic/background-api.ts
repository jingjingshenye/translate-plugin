// Background service worker 调用封装
// 把所有翻译/词典请求路由到 background，绕过页面 CSP，缓存共享

import type { TranslateResult } from './translate'
import type { DictResult } from './dict'

export interface TranslatePayload {
  text: string
  from: string
  to: string
  api: string
  apiKey?: string
  customConfig?: { url: string; key?: string; model?: string; prompt?: string }
}

export type DictMode = 'local' | 'online' | 'both'

export interface DictPayload {
  text: string
  mode?: DictMode
}

export function invokeTranslate(payload: TranslatePayload): Promise<TranslateResult> {
  return chrome.runtime.sendMessage({ type: 'qt-translate', payload })
    .then((res: any) => {
      if (res?.error) throw new Error(res.error)
      return res.result as TranslateResult
    })
}

export function invokeLookupDict(payload: DictPayload): Promise<DictResult | null> {
  return chrome.runtime.sendMessage({ type: 'qt-dict', payload })
    .then((res: any) => (res?.result as DictResult | null) || null)
    .catch(() => null)
}

// AI 对照翻译：与主翻译独立；未配置 Key 或失败时返回 null（UI 不显示）
export function invokeAiTranslate(payload: { text: string; from: string; to: string }): Promise<TranslateResult | null> {
  return chrome.runtime.sendMessage({ type: 'qt-ai-translate', payload })
    .then((res: any) => (res?.result as TranslateResult) || null)
    .catch(() => null)
}
