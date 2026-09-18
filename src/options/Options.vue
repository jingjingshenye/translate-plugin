<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { useEncryptedKeys } from '~/composables/useEncryptedKeys'
import { useFavorites } from '~/composables/useFavorites'
import { useHistory } from '~/composables/useHistory'
import { FREE_META, SUBSCRIBE_META, AI_META, ALL_META, isKnownApi } from '~/logic/translators-meta'

const api = useStorage<string>('qt_api', FREE_META[0].id)
const fromLang = useStorage<string>('qt_from', 'auto')
const toLang = useStorage<string>('qt_to', 'zh')
const apiKeys = useEncryptedKeys('qt_api_keys')
const apiModels = useStorage<Record<string, string>>('qt_api_models', {})
const dictMode = useStorage<string>('qt_dict_mode', 'both')
const immersiveApi = useStorage<string>('qt_immersive_api', '')
const immersiveMode = useStorage<'bilingual' | 'translated-only'>('qt_immersive_mode', 'bilingual')
const immersiveTo = useStorage<string>('qt_immersive_to', '')
const aiCompare = useStorage<string>('qt_ai_compare', 'auto')
const immersiveExclude = useStorage<string>('qt_immersive_exclude', '')
const skipLangs = useStorage<string[]>('qt_skip_langs', ['zh'])
const fallbackDisabled = useStorage<string[]>('qt_fallback_disabled', [])
const selectionAuto = useStorage<boolean>('qt_selection_auto', false)
const autoSpeak = useStorage<boolean>('qt_auto_speak', false)
const immersiveStyle = useStorage<'underline' | 'dashed' | 'quote' | 'none'>('qt_immersive_style', 'underline')
const autoSites = useStorage<Record<string, boolean>>('qt_auto_sites', {})
const autoSiteList = computed(() =>
  Object.entries(autoSites.value || {})
    .filter(([, on]) => on)
    .map(([origin]) => origin)
    .sort()
)
function removeAutoSite(origin: string) {
  const { [origin]: _removed, ...rest } = autoSites.value
  autoSites.value = rest
}

function isFallbackOn(id: string) { return !fallbackList().includes(id) }
function fallbackList(): string[] {
  // 防御：storage 坏数据（非数组）时不崩
  return Array.isArray(fallbackDisabled.value) ? fallbackDisabled.value : []
}
function toggleFallback(id: string) {
  fallbackDisabled.value = isFallbackOn(id)
    ? [...fallbackList(), id]
    : fallbackList().filter(i => i !== id)
}

const skipLangOptions = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'ru', label: 'Русский' },
  { id: 'ar', label: 'العربية' },
]

const customApi = useStorage('qt_custom_api', {
  url: '',
  key: '',
  model: 'gpt-4o-mini',
  prompt: '',
})

const { list: favList, count: favCount, toggle: toggleFav, setTranslation: setFavTranslation, clear: clearFavs, exportList, importList } = useFavorites()
const { list: historyList, remove: removeHistory, clear: clearHistory, exportList: exportHistory } = useHistory()

function copyText(text: string) { navigator.clipboard.writeText(text) }
function clearAllHistory() { if (confirm('确定清空所有翻译历史？')) clearHistory() }

const tab = ref<'api' | 'immersive' | 'dict' | 'fav' | 'history'>('api')
const editingApi = ref<string>('')
const version = __VERSION__

// 已下线引擎（如 microsoft 免费源）的存量配置迁移到可用默认值；
// storage 异步加载完成后值才会到达，用 watch 捕获
watch(api, (v) => { if (v && !isKnownApi(v)) api.value = FREE_META[0].id })

function setApiKey(id: string, key: string) {
  apiKeys.value = { ...apiKeys.value, [id]: key }
}

function setApiModel(id: string, model: string) {
  apiModels.value = { ...apiModels.value, [id]: model }
}

// API 连通性测试：经 background 直连引擎，真实校验 key（不走缓存）
const testingApi = ref('')
const testResults = ref<Record<string, { ok: boolean; text?: string; error?: string }>>({})

async function testApi(id: string) {
  if (testingApi.value) return
  testingApi.value = id
  delete testResults.value[id]
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'qt-test-api',
      payload: { api: id, apiKey: apiKeys.value[id], customConfig: id === 'custom' ? customApi.value : undefined },
    })
    testResults.value = { ...testResults.value, [id]: res?.ok ? { ok: true, text: res.text } : { ok: false, error: res?.error || '连接失败' } }
  } catch (e: any) {
    testResults.value = { ...testResults.value, [id]: { ok: false, error: e?.message || '发送失败' } }
  } finally {
    testingApi.value = ''
  }
}

// 收藏
const importText = ref('')
const showImport = ref(false)
function doExport() { navigator.clipboard.writeText(exportList()).then(() => alert('已复制到剪贴板')) }
function doImport() { if (importText.value.trim()) { importList(importText.value); importText.value = ''; showImport.value = false } }

const searchQuery = ref('')
const sortBy = ref<'date' | 'alpha'>('date')
const editingWord = ref('')
const editTranslation = ref('')

const stats = computed(() => {
  const entries = favList.value || []
  const today = new Date().toDateString()
  return { total: entries.length, today: entries.filter(([, d]) => new Date(d.createdAt).toDateString() === today).length, withTrans: entries.filter(([, d]) => d.translation).length }
})

const filteredWords = computed(() => {
  let entries = favList.value || []
  if (searchQuery.value.trim()) { const q = searchQuery.value.toLowerCase(); entries = entries.filter(([w, d]) => w.toLowerCase().includes(q) || (d.translation || '').toLowerCase().includes(q)) }
  return sortBy.value === 'alpha' ? [...entries].sort((a, b) => a[0].localeCompare(b[0])) : entries
})

function removeWord(word: string) { toggleFav(word) }
function clearAll() { if (confirm('确定清空所有收藏？')) clearFavs() }
function startEdit(word: string) { editingWord.value = word; editTranslation.value = favList.value?.find(([w]) => w === word)?.[1]?.translation || '' }
function saveEdit() {
  if (editingWord.value) setFavTranslation(editingWord.value, editTranslation.value)
  editingWord.value = ''
}
function copyWord(word: string) { navigator.clipboard.writeText(word) }

function formatDate(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return new Date(ts).toLocaleDateString()
}

function exportTXT() { download(exportList(), 'vocabulary.txt', 'text/plain') }
function exportCSV() {
  const lines = [['Word', 'Translation', 'Date']]
  filteredWords.value.forEach(([w, d]) => lines.push([w, d.translation || '', new Date(d.createdAt).toLocaleDateString()]))
  download(lines.map(r => r.map(c => `"${c}"`).join(',')).join('\n'), 'vocabulary.csv', 'text/csv')
}
function exportJSON() { download(JSON.stringify(Object.fromEntries(filteredWords.value), null, 2), 'vocabulary.json', 'application/json') }
function download(content: string, name: string, type: string) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(new Blob([content], { type }))
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="logo">译</div>
      <h1>Quick Translate <span>设置</span></h1>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'api' }" @click="tab = 'api'">翻译源</button>
      <button :class="{ active: tab === 'immersive' }" @click="tab = 'immersive'">沉浸式翻译</button>
      <button :class="{ active: tab === 'dict' }" @click="tab = 'dict'">词典</button>
      <button :class="{ active: tab === 'fav' }" @click="tab = 'fav'">生词本 <em v-if="stats.total">({{ stats.total }})</em></button>
      <button :class="{ active: tab === 'history' }" @click="tab = 'history'">历史 <em v-if="historyList.length">({{ historyList.length }})</em></button>
    </nav>

    <main class="main">
      <!-- ==================== 翻译源 ==================== -->
      <template v-if="tab === 'api'">
        <section class="card">
          <h2>默认翻译引擎</h2>
          <div class="row">
            <label>引擎</label>
            <select v-model="api">
              <optgroup label="免费"><option v-for="t in FREE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="订阅源（需Key）"><option v-for="t in SUBSCRIBE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="AI（需Key）"><option v-for="t in AI_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <option value="custom">自定义 API</option>
            </select>
          </div>
          <div class="row">
            <label>源语言</label>
            <select v-model="fromLang"><option value="auto">自动</option><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
          </div>
          <div class="row">
            <label>目标语言</label>
            <select v-model="toLang"><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
          </div>
        </section>

        <section class="card">
          <h2>自动备用源（Fallback）</h2>
          <p class="hint" style="margin-bottom:6px">所选引擎翻译失败时，自动改用勾选的免费源完成翻译（结果旁会标注「备用」）。不想被自动使用的源（如 Google）取消勾选即可。</p>
          <p class="hint" style="margin-bottom:12px">注意：此列表<b>不影响默认引擎本身</b>——若「默认翻译引擎」选了某个源，它会始终优先使用且不标「备用」。想让划词结果不出现某源，请直接更换默认翻译引擎。</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px 16px;">
            <label v-for="t in FREE_META" :key="t.id" style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--qt-text);cursor:pointer;">
              <input type="checkbox" :checked="isFallbackOn(t.id)" @change="toggleFallback(t.id)" style="accent-color:#0ea5e9;" />
              {{ t.name }}<span v-if="t.id === api" class="hint" style="margin-left:-2px">（当前默认）</span>
            </label>
          </div>
        </section>

        <section class="card">
          <h2>免费源连通性测试</h2>
          <p class="hint" style="margin-bottom:12px">免费源无需 Key，点「测试」检查在你的网络下是否可用。测出不可用的源建议在上方「自动备用源」中取消勾选，避免翻译时白等超时。</p>
          <div v-for="t in FREE_META" :key="t.id" class="free-test-row">
            <label class="free-test-name">{{ t.name }}</label>
            <button class="test-btn" :disabled="!!testingApi" @click="testApi(t.id)">{{ testingApi === t.id ? '测试中' : '测试' }}</button>
            <span v-if="testResults[t.id]" class="test-result-inline" :class="testResults[t.id].ok ? 'ok' : 'fail'">
              {{ testResults[t.id].ok ? '✓ 可用：' + testResults[t.id].text : '✗ ' + testResults[t.id].error }}
            </span>
          </div>
        </section>

        <section class="card">
          <h2>划词行为</h2>
          <p class="hint" style="margin-bottom:12px">选中以下语言的文本时，不显示翻译图标（可多选）</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px 16px;">
            <label v-for="l in skipLangOptions" :key="l.id" style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--qt-text);cursor:pointer;">
              <input type="checkbox" :value="l.id" v-model="skipLangs" style="accent-color:#0ea5e9;" />
              {{ l.label }}
            </label>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--qt-text);cursor:pointer;">
              <input type="checkbox" v-model="selectionAuto" style="accent-color:#0ea5e9;" />
              划选后自动弹出译文（免点击翻译图标）
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--qt-text);cursor:pointer;">
              <input type="checkbox" v-model="autoSpeak" style="accent-color:#0ea5e9;" />
              翻译完成后自动朗读译文
            </label>
          </div>
        </section>

        <section class="card">
          <h2>订阅源 API Key</h2>
          <p class="hint" style="margin-bottom:12px">传统翻译接口，按量付费，翻译质量稳定。Key 本地 AES-GCM 加密存储。DeepL 有每月 50 万字符免费额度。</p>
          <div v-for="t in SUBSCRIBE_META" :key="t.id" class="api-block">
            <div class="api-head">
              <label>{{ t.name }}</label>
              <div class="api-head-actions">
                <a v-if="t.freeTier" class="free-badge" :title="t.freeTier">有免费额度</a>
                <a v-if="t.signupUrl" :href="t.signupUrl" target="_blank" class="signup-link">{{ t.freeTier ? '免费注册 ↗' : '获取 Key ↗' }}</a>
              </div>
            </div>
            <p v-if="t.freeTier" class="free-tier-desc">{{ t.freeTier }}</p>
            <p v-if="t.pricing" class="pricing-desc">{{ t.pricing }}</p>
            <div class="api-row">
              <label>Key</label>
              <input :type="editingApi === t.id ? 'text' : 'password'" :value="apiKeys[t.id] || ''"
                @input="setApiKey(t.id, ($event.target as HTMLInputElement).value)"
                @focus="editingApi = t.id" @blur="editingApi = ''"
                :placeholder="t.id === 'azure' ? 'Key 或 Key:Region（如 xxx:eastasia）' : t.id === 'tencent_official' ? 'SecretId:SecretKey' : t.id === 'baidu_official' ? 'AppID:密钥' : 'API Key'" />
              <button class="test-btn" :disabled="!!testingApi" @click="testApi(t.id)">{{ testingApi === t.id ? '测试中' : '测试' }}</button>
            </div>
            <div v-if="testResults[t.id]" class="test-result" :class="testResults[t.id].ok ? 'ok' : 'fail'">
              {{ testResults[t.id].ok ? '✓ 连接成功：' + testResults[t.id].text : '✗ ' + testResults[t.id].error }}
            </div>
          </div>
        </section>

        <section class="card">
          <h2>AI 翻译 API Key</h2>
          <p class="hint" style="margin-bottom:12px">大语言模型翻译，支持上下文理解。标注「有免费额度」的源可免费注册领取额度直接使用；填好 Key 后点「测试」验证连通性。模型名留空使用默认。</p>
          <div v-for="t in AI_META" :key="t.id" class="api-block">
            <div class="api-head">
              <label>{{ t.name }}</label>
              <div class="api-head-actions">
                <span v-if="t.freeTier" class="free-badge" :title="t.freeTier">有免费额度</span>
                <a v-if="t.signupUrl" :href="t.signupUrl" target="_blank" class="signup-link">{{ t.freeTier ? '免费注册 ↗' : '获取 Key ↗' }}</a>
              </div>
            </div>
            <p v-if="t.freeTier" class="free-tier-desc">{{ t.freeTier }}</p>
            <p v-if="t.pricing" class="pricing-desc">{{ t.pricing }}</p>
            <div class="api-row">
              <label>Key</label>
              <input :type="editingApi === t.id ? 'text' : 'password'" :value="apiKeys[t.id] || ''"
                @input="setApiKey(t.id, ($event.target as HTMLInputElement).value)"
                @focus="editingApi = t.id" @blur="editingApi = ''"
                :placeholder="t.name + ' API Key'" />
              <button class="test-btn" :disabled="!!testingApi" @click="testApi(t.id)">{{ testingApi === t.id ? '测试中' : '测试' }}</button>
            </div>
            <div class="api-row api-row-model">
              <label>模型</label>
              <input :value="apiModels[t.id] || ''" @input="setApiModel(t.id, ($event.target as HTMLInputElement).value)" placeholder="留空使用默认模型" />
            </div>
            <div v-if="testResults[t.id]" class="test-result" :class="testResults[t.id].ok ? 'ok' : 'fail'">
              {{ testResults[t.id].ok ? '✓ 连接成功：' + testResults[t.id].text : '✗ ' + testResults[t.id].error }}
            </div>
          </div>
        </section>

        <section class="card">
          <h2>AI 对照翻译</h2>
          <p class="hint" style="margin-bottom:12px">划词/弹窗翻译时，额外请求一份 AI 译文对照显示（与主引擎互相独立、不参与备用切换）。未配置任何 AI Key 或请求失败时自动不显示。同一文本的结果会缓存，不重复消耗额度。</p>
          <div class="row">
            <label>模式</label>
            <select v-model="aiCompare">
              <option value="auto">自动（第一个已配置 Key 的 AI 源）</option>
              <option value="off">关闭</option>
              <option v-for="t in AI_META" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
        </section>

        <section class="card">
          <h2>自定义 API</h2>
          <p class="hint" style="margin-bottom:12px">配置自定义翻译接口（OpenAI 兼容格式）</p>
          <div class="row">
            <label>接口地址</label>
            <input v-model="customApi.url" type="text" placeholder="https://your-api.com/v1/chat/completions" />
          </div>
          <div class="row">
            <label>API Key</label>
            <input v-model="customApi.key" type="password" placeholder="可选" />
          </div>
          <div class="row">
            <label>模型</label>
            <input v-model="customApi.model" type="text" placeholder="gpt-4o-mini" />
          </div>
          <div class="row">
            <label>Prompt</label>
            <input v-model="customApi.prompt" type="text" placeholder="自定义系统提示词（可选）" />
          </div>
          <div class="custom-test-row">
            <button class="test-btn" :disabled="!!testingApi || !customApi.url" @click="testApi('custom')">{{ testingApi === 'custom' ? '测试中' : '测试连接' }}</button>
            <span v-if="testResults.custom" class="test-result" :class="testResults.custom.ok ? 'ok' : 'fail'">
              {{ testResults.custom.ok ? '✓ ' + testResults.custom.text : '✗ ' + testResults.custom.error }}
            </span>
          </div>
        </section>
      </template>

      <!-- ==================== 沉浸式翻译 ==================== -->
      <template v-if="tab === 'immersive'">
        <section class="card">
          <h2>沉浸式翻译设置</h2>
          <p class="hint" style="margin-bottom:14px">整页翻译：点击插件图标 → 「全文翻译」tab 触发；也可用快捷键 Alt+Shift+T 或右键菜单。页面延迟渲染时会自动等待内容出现，滚动与路由变化自动补翻。</p>
          <div class="row">
            <label>翻译引擎</label>
            <select v-model="immersiveApi">
              <option value="">跟随默认设置（{{ FREE_META.find(t => t.id === api)?.name || 'Microsoft' }}）</option>
              <optgroup label="免费"><option v-for="t in FREE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="订阅源（需Key）"><option v-for="t in SUBSCRIBE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="AI（需Key）"><option v-for="t in AI_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <option value="custom">自定义 API</option>
            </select>
          </div>
          <div class="row">
            <label>翻译模式</label>
            <select v-model="immersiveMode">
              <option value="bilingual">双语对照（原文+译文）</option>
              <option value="translated-only">仅显示译文</option>
            </select>
          </div>
          <div class="row">
            <label>双语样式</label>
            <select v-model="immersiveStyle">
              <option value="underline">下划线（默认）</option>
              <option value="dashed">虚线标记</option>
              <option value="quote">引用块</option>
              <option value="none">无样式纯文本</option>
            </select>
          </div>
          <div class="row" style="align-items:flex-start;flex-direction:column;gap:6px;">
            <label>自动翻译站点</label>
            <p class="hint">在弹窗「全文翻译」中勾选「此站点自动翻译」即可添加；以下站点打开页面时自动翻译。</p>
            <div v-if="autoSiteList.length" style="display:flex;flex-direction:column;gap:4px;width:100%;">
              <div v-for="origin in autoSiteList" :key="origin" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;background:var(--qt-input);border-radius:6px;font-size:12px;font-family:monospace;color:var(--qt-text);">
                <span style="word-break:break-all">{{ origin }}</span>
                <button class="hint" style="cursor:pointer;border:none;background:none;color:#ef4444;flex-shrink:0" @click="removeAutoSite(origin)">移除</button>
              </div>
            </div>
            <p v-else class="hint">暂无站点（默认关闭，在弹窗中按站点开启）</p>
          </div>
          <div class="row">
            <label>目标语言</label>
            <select v-model="immersiveTo">
              <option value="">跟随划词设置</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </div>
        </section>

        <section class="card">
          <h2>排除选择器</h2>
          <p class="hint" style="margin-bottom:8px">指定不翻译的区域（每行一个 CSS 选择器）。内置排除：代码块、文件名/标识符、数据网格、站点骨架、广告、评论区、侧边栏、内嵌编辑器、图标字体，以及 translate="no" / notranslate 标准约定区域。</p>
          <textarea v-model="immersiveExclude" rows="4" placeholder="例如：&#10;.my-sidebar&#10;#ad-container&#10;.code-block" style="width:100%;padding:8px;background:var(--qt-input);border:1px solid rgba(56,189,248,.15);border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;outline:none;color:var(--qt-text)"></textarea>
          <div style="margin-top:8px">
            <div class="hint" style="margin-bottom:4px"><strong>内置排除规则（始终生效）：</strong></div>
            <div class="hint" style="font-family:monospace;font-size:10px;line-height:1.6;word-break:break-all">[translate="no"], .notranslate, [role="navigation"], [role="banner"], [role="contentinfo"], [role="grid"], .sidebar, .side-bar, #sidebar, .ad, .ads, .advert, [class^="ad-"], [class*=" ad-"], [id*="google_ads"], .comments, .related-posts, .social-share, .newsletter, .cookie-banner, .popup-overlay, .react-code-lines, .blob-code, .CodeMirror, .cm-editor, .monaco-editor, .material-icons, [aria-hidden="true"]；另含结构化 header/footer/nav 判断与代码标签（pre/code/samp/kbd/var）、文件名标识符启发式</div>
          </div>
        </section>

        <section class="card">
          <h2>使用说明</h2>
          <div class="source-list">
            <div class="source-item">
              <span class="source-badge local">1</span>
              <span class="source-detail">打开任意英文网页，点击插件图标 → 「全文翻译」tab</span>
            </div>
            <div class="source-item">
              <span class="source-badge local">2</span>
              <span class="source-detail">点击「翻译可视区域」或「翻译全部」（快捷键 Alt+Shift+T / 右键菜单也可触发）</span>
            </div>
            <div class="source-item">
              <span class="source-badge local">3</span>
              <span class="source-detail">页面右下角控制面板可切换模式、显示/隐藏原文、重试失败段、清除译文</span>
            </div>
            <div class="source-item">
              <span class="source-badge local">4</span>
              <span class="source-detail">按住 Alt 悬停高亮元素，Alt+点击可强制翻译被排除规则跳过的区域</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">推荐</span>
              <span class="source-detail">整页翻译建议使用免费引擎（微软/火山等），速度快且无成本</span>
            </div>
          </div>
        </section>
      </template>

      <!-- ==================== 词典设置 ==================== -->
      <template v-if="tab === 'dict'">
        <section class="card">
          <h2>词典模式</h2>
          <div class="dict-options">
            <label class="dict-option" :class="{ active: dictMode === 'local' }" @click="dictMode = 'local'">
              <div class="dict-icon">📚</div>
              <div class="dict-info">
                <div class="dict-name">本地词典</div>
                <div class="dict-desc">内置 15000 高频词 + 18789 词形映射，瞬间响应，无需网络</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'local'">✓</div>
            </label>
            <label class="dict-option" :class="{ active: dictMode === 'online' }" @click="dictMode = 'online'">
              <div class="dict-icon">🌐</div>
              <div class="dict-info">
                <div class="dict-name">网络词典</div>
                <div class="dict-desc">Bing/有道词典，含音标、发音、例句、双解</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'online'">✓</div>
            </label>
            <label class="dict-option" :class="{ active: dictMode === 'both' }" @click="dictMode = 'both'">
              <div class="dict-icon">⚡</div>
              <div class="dict-info">
                <div class="dict-name">混合模式</div>
                <div class="dict-desc">本地优先（瞬间），同时异步补充网络数据</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'both'">✓</div>
            </label>
          </div>
        </section>

        <section class="card">
          <h2>数据来源</h2>
          <div class="source-list">
            <div class="source-item">
              <span class="source-badge local">本地</span>
              <span class="source-name">ECDICT 词典</span>
              <span class="source-detail">15000 词 · 音标 · 释义 · 词性 · 时态变形</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">Bing 词典</span>
              <span class="source-detail">发音 · 例句 · 英汉双解</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">有道词典</span>
              <span class="source-detail">备用 · 释义 · 例句</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">百度 TTS</span>
              <span class="source-detail">英美发音</span>
            </div>
          </div>
        </section>
      </template>

      <!-- ==================== 生词本 ==================== -->
      <template v-if="tab === 'fav'">
        <div class="stats-row">
          <div class="stat-card"><div class="stat-num">{{ stats.total }}</div><div class="stat-label">总词汇</div></div>
          <div class="stat-card"><div class="stat-num">{{ stats.today }}</div><div class="stat-label">今日新增</div></div>
          <div class="stat-card"><div class="stat-num">{{ stats.withTrans }}</div><div class="stat-label">有翻译</div></div>
        </div>

        <section class="card">
          <div class="toolbar">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input v-model="searchQuery" placeholder="搜索单词或翻译..." />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">&times;</button>
            </div>
            <div class="toolbar-actions">
              <select v-model="sortBy" class="sort-sel"><option value="date">按时间</option><option value="alpha">按字母</option></select>
              <button class="tool-btn" @click="showImport = !showImport" title="导入">📥</button>
              <button class="tool-btn" @click="exportTXT" title="TXT">📄</button>
              <button class="tool-btn" @click="exportCSV" title="CSV">📊</button>
              <button class="tool-btn" @click="exportJSON" title="JSON">{ }</button>
              <button v-if="stats.total" class="tool-btn tool-danger" @click="clearAll" title="清空">🗑</button>
            </div>
          </div>

          <div v-if="showImport" class="import-area">
            <textarea v-model="importText" placeholder="粘贴单词列表（每行一个，Tab分隔翻译）" rows="3"></textarea>
            <div class="import-actions">
              <button class="btn btn-sm" @click="doImport" :disabled="!importText.trim()">导入</button>
              <button class="btn btn-sm btn-ghost" @click="showImport = false; importText = ''">取消</button>
            </div>
          </div>

          <div v-if="filteredWords.length" class="word-list">
            <div v-for="[word, data] in filteredWords" :key="word" class="word-item">
              <div class="word-main">
                <div class="word-text">{{ word }}</div>
                <div v-if="editingWord === word" class="word-edit">
                  <input v-model="editTranslation" @keydown.enter="saveEdit" @keydown.escape="editingWord = ''" />
                  <button class="edit-save" @click="saveEdit">✓</button>
                </div>
                <div v-else class="word-trans" @click="startEdit(word)">{{ data.translation || '点击添加翻译...' }}</div>
              </div>
              <div class="word-meta">
                <span class="word-time">{{ formatDate(data.createdAt) }}</span>
                <div class="word-actions">
                  <button class="word-btn" @click="copyWord(word)" title="复制">📋</button>
                  <button class="word-btn" @click="startEdit(word)" title="编辑">✏️</button>
                  <button class="word-btn word-btn-del" @click="removeWord(word)" title="删除">&times;</button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty">
            <div class="empty-icon">📚</div>
            <div class="empty-title">{{ searchQuery ? '未找到匹配的单词' : '生词本为空' }}</div>
            <div class="empty-desc">{{ searchQuery ? '尝试其他关键词' : '划词翻译时点击 ♡ 收藏单词' }}</div>
          </div>
        </section>
      </template>
      <!-- ==================== 翻译历史 ==================== -->
      <template v-if="tab === 'history'">
        <section class="card">
          <div class="toolbar">
            <span class="hint">最近 {{ historyList.length }} 条翻译记录（同文本自动去重，最多保留 100 条）</span>
            <div class="toolbar-actions">
              <button class="tool-btn" @click="copyText(exportHistory())" title="复制全部">📋 复制</button>
              <button v-if="historyList.length" class="tool-btn tool-danger" @click="clearAllHistory" title="清空">🗑 清空</button>
            </div>
          </div>

          <div v-if="historyList.length" class="history-list">
            <div v-for="item in historyList" :key="item.text" class="history-item">
              <div class="history-main">
                <div class="history-text">{{ item.text }}</div>
                <div class="history-trans">{{ item.translation }}</div>
              </div>
              <div class="history-meta">
                <span class="history-time">{{ formatDate(item.ts) }} · {{ item.api }}</span>
                <div class="word-actions">
                  <button class="word-btn" @click="copyText(item.translation)" title="复制译文">📋</button>
                  <button class="word-btn word-btn-del" @click="removeHistory(item.text)" title="删除">&times;</button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty">
            <div class="empty-icon">🕘</div>
            <div class="empty-title">暂无翻译历史</div>
            <div class="empty-desc">划词翻译和弹窗翻译的成功记录会出现在这里</div>
          </div>
        </section>
      </template>
    </main>

    <footer class="footer">
      <p>Quick Translate v{{ version }} · {{ ALL_META.length }}种翻译源 · API Key AES-GCM 加密</p>
    </footer>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: var(--qt-bg); color: var(--qt-text); font-family: system-ui, sans-serif; }
.header { display: flex; align-items: center; gap: 12px; padding: 20px 32px; border-bottom: 1px solid var(--qt-border-light); background: linear-gradient(90deg, var(--qt-bar), transparent); }
.logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, #38bdf8, #7dd3fc); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: #fff; }
.header h1 { font-size: 18px; font-weight: 700; }
.header span { color: var(--qt-text-light); font-weight: 400; }

.tabs { display: flex; gap: 0; max-width: 760px; margin: 0 auto; padding: 0 32px; border-bottom: 1px solid var(--qt-border-light); }
.tabs button { padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--qt-text-light); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.tabs button.active { color: #0ea5e9; border-bottom-color: #0ea5e9; }
.tabs button em { font-style: normal; color: var(--qt-text-dim); font-size: 11px; }

.main { max-width: 760px; margin: 0 auto; padding: 16px 32px; }
.card { background: var(--qt-card); border: 1px solid var(--qt-border-light); border-radius: 10px; padding: 18px 22px; margin-bottom: 16px; }
.card h2 { font-size: 14px; font-weight: 600; color: #0ea5e9; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid var(--qt-bar); }
.hint { font-size: 11px; color: var(--qt-text-dim); }

.row { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.row:last-child { margin-bottom: 0; }
.row label:first-child { width: 72px; flex-shrink: 0; font-size: 13px; color: var(--qt-text-light); }
.row select, .row input[type="text"] { flex: 1; padding: 7px 10px; background: var(--qt-bg); border: 1px solid var(--qt-border); border-radius: 6px; color: var(--qt-text); font-size: 13px; outline: none; }
.row select:focus, .row input:focus { border-color: #38bdf8; }
.row select option, .row select optgroup { background: var(--qt-bg); color: var(--qt-text); }

.api-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.api-row label { width: 90px; flex-shrink: 0; font-size: 12px; color: var(--qt-text-light); }
.api-row input { flex: 1; padding: 6px 8px; background: var(--qt-input); border: 1px solid var(--qt-border-light); border-radius: 5px; color: var(--qt-text); font-size: 12px; outline: none; }
.api-row input:focus { border-color: #38bdf8; }

.api-block { padding: 10px 12px; background: var(--qt-input); border: 1px solid var(--qt-bar); border-radius: 8px; margin-bottom: 10px; }
.api-block .api-row { margin-bottom: 6px; }
.api-block .api-row:last-child { margin-bottom: 0; }

.api-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.api-head label { font-size: 12px; color: var(--qt-text-light); }
.api-head-actions { display: flex; align-items: center; gap: 8px; }
.free-badge { font-size: 10px; font-weight: 600; color: #10b981; background: rgba(16,185,129,0.14); padding: 1px 6px; border-radius: 3px; cursor: default; }
.free-tier-desc { font-size: 11px; color: #10b981; margin: -2px 0 6px; }
.pricing-desc { font-size: 11px; color: var(--qt-text-dim); margin: -2px 0 6px; }
.signup-link { font-size: 11px; color: var(--qt-primary-dark); text-decoration: none; opacity: .85; }
.signup-link:hover { opacity: 1; text-decoration: underline; }
.test-btn { flex-shrink: 0; padding: 5px 10px; font-size: 11px; border: 1px solid var(--qt-border); background: var(--qt-card); color: var(--qt-primary-dark); border-radius: 4px; cursor: pointer; transition: all .15s; }
.test-btn:hover:not(:disabled) { background: var(--qt-bar); }
.test-btn:disabled { opacity: .5; cursor: not-allowed; }
.test-result { font-size: 11px; margin-top: 6px; word-break: break-all; }
.test-result.ok { color: #10b981; }
.test-result.fail { color: #ef4444; }
.custom-test-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }

.free-test-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.free-test-row:last-child { margin-bottom: 0; }
.free-test-name { flex-shrink: 0; width: 110px; font-size: 12px; color: var(--qt-text-light); }
.test-result-inline { font-size: 11px; min-width: 0; word-break: break-all; }
.test-result-inline.ok { color: #10b981; }
.test-result-inline.fail { color: #ef4444; }

.history-list { margin-top: 12px; max-height: 500px; overflow-y: auto; }
.history-item { padding: 8px 0; border-bottom: 1px solid var(--qt-border-light); }
.history-item:last-child { border-bottom: none; }
.history-main { min-width: 0; }
.history-text { font-size: 12px; font-weight: 600; color: var(--qt-text); word-break: break-all; }
.history-trans { font-size: 12px; color: var(--qt-text-light); margin-top: 2px; word-break: break-all; }
.history-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.history-time { font-size: 10px; color: var(--qt-text-dim); }
.api-row-model label { color: var(--qt-text-dim); font-size: 11px; }
.api-row-model input { font-size: 11px; padding: 4px 8px; }

.dict-options { display: flex; flex-direction: column; gap: 8px; }
.dict-option {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: var(--qt-input); border: 2px solid var(--qt-border-light); border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
}
.dict-option:hover { border-color: rgba(56,189,248,0.3); }
.dict-option.active { border-color: #0ea5e9; background: rgba(56,189,248,0.05); }
.dict-icon { font-size: 24px; }
.dict-info { flex: 1; }
.dict-name { font-size: 14px; font-weight: 600; color: var(--qt-text); margin-bottom: 2px; }
.dict-desc { font-size: 11px; color: var(--qt-text-light); }
.dict-check { width: 20px; height: 20px; border-radius: 50%; background: #0ea5e9; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; }

.source-list { display: flex; flex-direction: column; gap: 8px; }
.source-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.source-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.source-badge.local { background: rgba(16,185,129,0.14); color: #10b981; }
.source-badge.online { background: rgba(59,130,246,0.1); color: #3b82f6; }
.source-name { font-weight: 500; color: var(--qt-text); min-width: 70px; }
.source-detail { color: var(--qt-text-light); }

.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; background: var(--qt-card); border: 1px solid var(--qt-border-light); border-radius: 10px; padding: 14px; text-align: center; }
.stat-num { font-size: 24px; font-weight: 700; color: #0ea5e9; }
.stat-label { font-size: 11px; color: var(--qt-text-dim); margin-top: 2px; }

.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.search-box { flex: 1; min-width: 140px; position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 8px; font-size: 12px; opacity: 0.5; }
.search-box input { width: 100%; padding: 6px 28px 6px 28px; background: var(--qt-bg); border: 1px solid var(--qt-border); border-radius: 6px; font-size: 12px; outline: none; color: var(--qt-text); }
.search-box input:focus { border-color: #38bdf8; }
.search-clear { position: absolute; right: 6px; background: none; border: none; color: var(--qt-text-dim); cursor: pointer; font-size: 14px; }
.toolbar-actions { display: flex; gap: 4px; align-items: center; }
.sort-sel { padding: 5px 6px; background: var(--qt-bg); border: 1px solid var(--qt-border-light); border-radius: 5px; font-size: 11px; color: var(--qt-text-light); outline: none; }
.tool-btn { padding: 4px 8px; background: var(--qt-bg); border: 1px solid var(--qt-border-light); border-radius: 5px; cursor: pointer; font-size: 12px; transition: all 0.15s; }
.tool-btn:hover { background: var(--qt-bar); }
.tool-danger:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); }

.import-area { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--qt-bar); }
.import-area textarea { width: 100%; padding: 6px 8px; background: var(--qt-input); border: 1px solid var(--qt-border-light); border-radius: 5px; font-size: 12px; resize: vertical; outline: none; color: var(--qt-text); }
.import-actions { display: flex; gap: 6px; margin-top: 6px; }

.word-list { margin-top: 12px; max-height: 500px; overflow-y: auto; }
.word-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(56,189,248,0.06); }
.word-item:last-child { border-bottom: none; }
.word-main { flex: 1; min-width: 0; }
.word-text { font-size: 14px; font-weight: 600; color: var(--qt-text); margin-bottom: 2px; }
.word-trans { font-size: 12px; color: var(--qt-text-light); cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: background 0.15s; }
.word-trans:hover { background: var(--qt-bar); }
.word-edit { display: flex; gap: 4px; align-items: center; }
.word-edit input { flex: 1; padding: 3px 6px; background: var(--qt-bg); border: 1px solid #38bdf8; border-radius: 4px; font-size: 12px; outline: none; color: var(--qt-text); }
.edit-save { padding: 2px 6px; background: #0ea5e9; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; }
.word-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.word-time { font-size: 10px; color: var(--qt-text-dim); }
.word-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.word-item:hover .word-actions { opacity: 1; }
.word-btn { padding: 2px 4px; background: none; border: none; cursor: pointer; font-size: 11px; opacity: 0.5; transition: opacity 0.15s; }
.word-btn:hover { opacity: 1; }
.word-btn-del { color: #ef4444; font-size: 14px; }

.empty { text-align: center; padding: 40px 20px; }
.empty-icon { font-size: 36px; margin-bottom: 8px; }
.empty-title { font-size: 14px; font-weight: 500; color: var(--qt-text-light); margin-bottom: 4px; }
.empty-desc { font-size: 12px; color: var(--qt-text-dim); }

.btn { padding: 6px 14px; background: linear-gradient(135deg, #0ea5e9, #38bdf8); color: #fff; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; transition: all 0.15s; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 4px 10px; font-size: 11px; }
.btn-ghost { background: transparent; color: var(--qt-text-light); }
.btn-ghost:hover { background: var(--qt-bar); }

.footer { text-align: center; padding: 16px 0; color: var(--qt-text-dim); font-size: 11px; }
</style>
