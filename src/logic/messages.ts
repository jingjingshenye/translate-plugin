// 消息协议类型：background ↔ content script ↔ popup/options 共享的单一事实来源
// 发送端与处理端都从这里取类型，避免字段名/结构漂移

export interface CustomApiConfig {
  url: string
  key?: string
  model?: string
  prompt?: string
}

export interface ImmersiveProgressPayload {
  state: 'idle' | 'translating' | 'done'
  progress: { total: number; done: number; failed: number }
  showOriginal: boolean
  // 等待页面内容 / 未找到可翻译内容 / 语言相同无需翻译 等人读提示；无提示时省略
  message?: string
}

// content script / popup / options → background（chrome.runtime.sendMessage）
export type BackgroundMessage =
  | { type: 'qt-translate'; payload: { text: string; from: string; to: string; api: string; apiKey?: string; customConfig?: CustomApiConfig } }
  | { type: 'qt-dict'; payload: { text: string; mode?: 'local' | 'online' | 'both' } }
  | { type: 'qt-batch-translate'; payload: { texts: string[]; from: string; to: string; api: string; apiKey?: string; customConfig?: CustomApiConfig; sessionId?: string } }
  | { type: 'qt-ai-translate'; payload: { text: string; from: string; to: string } }
  | { type: 'qt-test-api'; payload: { api: string; apiKey?: string; customConfig?: CustomApiConfig } }
  | { type: 'qt-cancel'; payload?: { sessionId?: string } }
  | { type: 'qt-immersive-auto' }

// background / popup → 指定 tab（chrome.tabs.sendMessage）
export type TabMessage =
  | { type: 'translate-text'; text: string }
  | { type: 'qt-immersive-translate'; payload: { api: string; apiKey?: string; customConfig?: CustomApiConfig; mode: 'bilingual' | 'translated-only'; all?: boolean; to?: string; excludeSelectors?: string[]; toggle?: boolean; style?: 'underline' | 'dashed' | 'quote' | 'none' } }
  | { type: 'qt-immersive-cancel' }
  | { type: 'qt-immersive-status' }

// content script → popup（chrome.runtime.sendMessage 广播，popup 按 sender.tab.id 过滤）
export type ProgressMessage =
  | { type: 'qt-immersive-progress'; payload: ImmersiveProgressPayload }
