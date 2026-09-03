// 翻译源元数据（仅数据，无函数引用）
// UI 层用这个显示翻译源列表，content script 也可安全 import
// 不会拉入 md5 / fetch 等实现代码
//
// freeTier：仅当该源当前确实提供免费额度时才有值（UI 显示绿色徽章）
// pricing：计费说明（无免费额度、或免费之外的补充信息）

export interface TranslatorMeta {
  id: string
  name: string
  needKey: boolean
  freeTier?: string
  pricing?: string
  signupUrl?: string
}

export const FREE_META: TranslatorMeta[] = [
  { id: 'microsoft', name: 'Microsoft', needKey: false },
  { id: 'volcengine', name: '火山 (Free)', needKey: false },
  { id: 'tencent', name: '腾讯 (Free)', needKey: false },
  { id: 'baidu', name: '百度 (Free)', needKey: false },
  { id: 'deeplfree', name: 'DeepL Free', needKey: false },
  { id: 'google', name: 'Google (Free)', needKey: false },
]

export const SUBSCRIBE_META: TranslatorMeta[] = [
  {
    id: 'azure', name: '微软 Azure 翻译', needKey: true,
    freeTier: '新用户每月 200 万字符免费，官方 API 最稳定',
    signupUrl: 'https://azure.microsoft.com/pricing/details/cognitive-services/translator/',
  },
  {
    id: 'tencent_official', name: '腾讯云翻译', needKey: true,
    freeTier: '每月 500 万字符免费（用完停服，不自动扣费）',
    signupUrl: 'https://console.cloud.tencent.com/tmt',
  },
  {
    id: 'baidu_official', name: '百度翻译API', needKey: true,
    freeTier: '标准版每月 5 万字符免费；个人认证后每月 100 万字符',
    pricing: '标准版限 1 QPS，超量约 49 元/百万字符',
    signupUrl: 'https://fanyi-api.baidu.com/',
  },
  {
    id: 'google_official', name: 'Google API', needKey: true,
    pricing: '无长期免费额度，新户有试用赠金，约 $20/百万字符',
    signupUrl: 'https://cloud.google.com/translate/docs/setup',
  },
  {
    id: 'deepl', name: 'DeepL API', needKey: true,
    freeTier: 'Free 套餐每月 50 万字符免费',
    pricing: '超出后 DeepL API Pro 按量付费',
    signupUrl: 'https://www.deepl.com/pro-api',
  },
]

export const AI_META: TranslatorMeta[] = [
  {
    id: 'deepseek', name: 'DeepSeek', needKey: true,
    pricing: '无免费额度，按量计费但极低（百万 tokens 约几元）',
    signupUrl: 'https://platform.deepseek.com/',
  },
  {
    id: 'openai', name: 'OpenAI', needKey: true,
    pricing: '无免费额度，gpt-4o-mini 按量计费（很便宜）',
    signupUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini', name: 'Gemini', needKey: true,
    freeTier: 'Google AI Studio 免费层（Flash 模型，每日免费额度；需能访问 Google）',
    signupUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'claude', name: 'Claude', needKey: true,
    pricing: '无免费额度，按量计费',
    signupUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'siliconflow', name: 'SiliconFlow', needKey: true,
    freeTier: '注册送 14 元额度（约 2000 万 tokens），部分小模型长期免费',
    signupUrl: 'https://cloud.siliconflow.cn/',
  },
  {
    id: 'xiaomimimo', name: '小米MiMo', needKey: true,
    freeTier: '官方为新老用户发放免费额度（登录后「账户余额」查收），邀请好友双方各得 ¥10',
    signupUrl: 'https://mimo.mi.com/',
  },
  {
    id: 'aliyunbailian', name: '阿里百炼', needKey: true,
    freeTier: '新用户实名认证领各模型 100 万 tokens（总量超 7000 万，90 天内有效）',
    signupUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'cerebras', name: 'Cerebras', needKey: true,
    freeTier: '每日 100 万 tokens 免费（5 次/分钟，Llama/Qwen 等开源模型，推理极快）',
    signupUrl: 'https://cloud.cerebras.ai/',
  },
  {
    id: 'zai', name: '智谱AI', needKey: true,
    freeTier: '默认模型 glm-4-flash 长期完全免费，注册即可用',
    signupUrl: 'https://open.bigmodel.cn/',
  },
  {
    id: 'openrouter', name: 'OpenRouter', needKey: true,
    freeTier: '模型名带 :free 后缀的模型免费（50 次/天；曾充值 $10 提升到 1000 次/天）',
    pricing: '默认模型 openai/gpt-4o-mini 是收费的，想免费用需在模型栏填 :free 模型',
    signupUrl: 'https://openrouter.ai/keys',
  },
]

export const ALL_META = [...FREE_META, ...SUBSCRIBE_META, ...AI_META]

export const META_MAP: Map<string, TranslatorMeta> = new Map(ALL_META.map(m => [m.id, m]))

export function getMeta(id: string): TranslatorMeta {
  return META_MAP.get(id) || FREE_META[0]
}

/** id 是否为有效引擎（含 custom）；用于把已下线引擎（如 microsoft）迁移到可用默认值 */
export function isKnownApi(id: string): boolean {
  return id === 'custom' || META_MAP.has(id)
}
