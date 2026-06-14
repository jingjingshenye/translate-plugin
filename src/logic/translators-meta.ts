// 翻译源元数据（仅 id/name/needKey，无函数引用）
// UI 层用这个显示翻译源列表，content script 也可安全 import
// 不会拉入 md5 / fetch 等实现代码

export interface TranslatorMeta {
  id: string
  name: string
  needKey: boolean
}

export const FREE_META: TranslatorMeta[] = [
  { id: 'microsoft', name: 'Microsoft', needKey: false },
  { id: 'google', name: 'Google (Free)', needKey: false },
  { id: 'deeplfree', name: 'DeepL Free', needKey: false },
  { id: 'tencent', name: '腾讯 (Free)', needKey: false },
  { id: 'volcengine', name: '火山 (Free)', needKey: false },
  { id: 'baidu', name: '百度 (Free)', needKey: false },
]

export const SUBSCRIBE_META: TranslatorMeta[] = [
  { id: 'tencent_official', name: '腾讯云翻译', needKey: true },
  { id: 'baidu_official', name: '百度翻译API', needKey: true },
  { id: 'google_official', name: 'Google API', needKey: true },
  { id: 'deepl', name: 'DeepL API', needKey: true },
]

export const AI_META: TranslatorMeta[] = [
  { id: 'deepseek', name: 'DeepSeek', needKey: true },
  { id: 'openai', name: 'OpenAI', needKey: true },
  { id: 'gemini', name: 'Gemini', needKey: true },
  { id: 'claude', name: 'Claude', needKey: true },
  { id: 'siliconflow', name: 'SiliconFlow', needKey: true },
  { id: 'xiaomimimo', name: '小米MiMo', needKey: true },
  { id: 'aliyunbailian', name: '阿里百炼', needKey: true },
  { id: 'cerebras', name: 'Cerebras', needKey: true },
  { id: 'zai', name: '智谱AI', needKey: true },
  { id: 'openrouter', name: 'OpenRouter', needKey: true },
]

export const ALL_META = [...FREE_META, ...SUBSCRIBE_META, ...AI_META]

export const META_MAP: Map<string, TranslatorMeta> = new Map(ALL_META.map(m => [m.id, m]))

export function getMeta(id: string): TranslatorMeta {
  return META_MAP.get(id) || FREE_META[0]
}
