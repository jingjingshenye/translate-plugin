<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { useEncryptedKeys } from '~/composables/useEncryptedKeys'
import { invokeTranslate, invokeLookupDict, type DictMode } from '~/logic/background-api'
import { detectLang, getTargetLang } from '~/logic/lang-utils'
import { FREE_META, SUBSCRIBE_META, AI_META, getMeta } from '~/logic/translators-meta'
import { isValidWord, type DictResult } from '~/logic/dict'

type ImmersiveState = 'idle' | 'translating' | 'done' | 'error'
type ImmersiveMode = 'bilingual' | 'translated-only'

const tab = ref<'word' | 'page'>('word')

// ========== 划词翻译 ==========
const inputText = ref('')
const result = ref('')
const error = ref('')
const loading = ref(false)
const copied = ref(false)
const detectedSrc = ref('')
const usedApi = ref('')
const fromLang = useStorage<string>('qt_from', 'auto')
const toLang = useStorage<string>('qt_to', 'zh')
const currentApi = useStorage<string>('qt_api', 'microsoft')
const apiKeys = useEncryptedKeys('qt_api_keys')
const dictMode = useStorage<string>('qt_dict_mode', 'both')
const customApi = useStorage('qt_custom_api', { url: '', key: '', model: 'gpt-4o-mini', prompt: '' })

const isWord = ref(false)
const dictResult = ref<DictResult | null>(null)
const dictLoading = ref(false)

function swapLang() {
  if (fromLang.value === 'auto') return
  ;[fromLang.value, toLang.value] = [toLang.value, fromLang.value]
}

function clearText() {
  inputText.value = ''; result.value = ''; error.value = ''
  detectedSrc.value = ''; usedApi.value = ''
  isWord.value = false; dictResult.value = null
}

async function doTranslate() {
  if (!inputText.value.trim() || loading.value) return
  loading.value = true; result.value = ''; error.value = ''
  copied.value = false; detectedSrc.value = ''; usedApi.value = ''
  isWord.value = false; dictResult.value = null

  const text = inputText.value.trim()
  const word = isValidWord(text)
  isWord.value = word

  const meta = getMeta(currentApi.value)
  const isCustom = currentApi.value === 'custom'
  if (!isCustom && meta.needKey && !apiKeys.value[currentApi.value]) {
    loading.value = false
    error.value = `${meta.name} 需要配置 API Key（点⚙进入设置）`
    return
  }
  if (isCustom && !customApi.value.url) {
    loading.value = false
    error.value = '请在设置中配置自定义 API URL'
    return
  }

  let from = fromLang.value, to = toLang.value
  if (from === 'auto') { from = detectLang(text); to = getTargetLang(from) }

  invokeTranslate({
    text, from, to,
    api: currentApi.value,
    apiKey: apiKeys.value[currentApi.value],
    customConfig: isCustom ? customApi.value : undefined,
  })
    .then(res => {
      result.value = res.text
      detectedSrc.value = res.srcLang
      usedApi.value = res.api || currentApi.value
    })
    .catch(() => { error.value = '翻译失败' })
    .finally(() => { loading.value = false })

  if (word) {
    dictLoading.value = true
    invokeLookupDict({ text, mode: dictMode.value as DictMode })
      .then(r => { if (r) dictResult.value = r })
      .finally(() => { dictLoading.value = false })
  }
}

function playAudio(url: string) {
  try { new Audio(url).play().catch(() => {}) } catch {}
}

async function copyResult() {
  await navigator.clipboard.writeText(result.value)
  copied.value = true; setTimeout(() => { copied.value = false }, 1200)
}

function openOptions() { chrome.runtime.openOptionsPage() }

// ========== 全文翻译 ==========
const immersiveApi = useStorage<string>('qt_immersive_api', '')
const immersiveMode = useStorage<ImmersiveMode>('qt_immersive_mode', 'bilingual')
const immersiveKeys = useEncryptedKeys('qt_api_keys')
const immersiveCustom = useStorage('qt_custom_api', { url: '', key: '', model: 'gpt-4o-mini', prompt: '' })

const immersiveState = ref<ImmersiveState>('idle')
const immersiveProgress = ref({ total: 0, done: 0, failed: 0 })
const immersiveError = ref('')

const effectiveImmersiveApi = computed(() => immersiveApi.value || currentApi.value)
const immersivePercent = computed(() => {
  if (immersiveProgress.value.total === 0) return 0
  return Math.round(immersiveProgress.value.done / immersiveProgress.value.total * 100)
})

function onImmersiveProgress(msg: any) {
  if (msg.type === 'qt-immersive-progress') {
    immersiveState.value = msg.payload.state
    immersiveProgress.value = msg.payload.progress
  }
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(onImmersiveProgress)
  chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'qt-immersive-status' }).catch(() => {})
    }
  })
})
onUnmounted(() => chrome.runtime.onMessage.removeListener(onImmersiveProgress))

async function startImmersive() {
  const api = effectiveImmersiveApi.value
  const meta = getMeta(api)
  const isCustom = api === 'custom'

  if (!isCustom && meta.needKey && !immersiveKeys.value[api]) {
    immersiveState.value = 'error'
    immersiveError.value = `${meta.name} 需要配置 API Key`
    return
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) return

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: 'qt-immersive-translate',
      payload: {
        api,
        apiKey: immersiveKeys.value[api],
        customConfig: isCustom ? immersiveCustom.value : undefined,
        mode: immersiveMode.value,
      },
    })
    immersiveState.value = 'translating'
    immersiveProgress.value = { total: 0, done: 0, failed: 0 }
    immersiveError.value = ''
  } catch {
    immersiveState.value = 'error'
    immersiveError.value = '无法连接到当前页面（chrome:// 等页面不支持扩展）'
  }
}

async function cancelImmersive() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, { type: 'qt-immersive-cancel' }).catch(() => {})
  }
  immersiveState.value = 'idle'
  immersiveError.value = ''
}
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="logo">译</div>
      <span class="title">QUICK TRANSLATE</span>
      <button class="settings-btn" @click="openOptions" title="设置">⚙</button>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'word' }" @click="tab = 'word'">划词翻译</button>
      <button :class="{ active: tab === 'page' }" @click="tab = 'page'">全文翻译</button>
    </nav>

    <!-- ==================== 划词翻译 ==================== -->
    <div v-if="tab === 'word'" class="body">
      <select v-model="currentApi" class="sel api-sel">
        <optgroup label="免费"><option v-for="t in FREE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <optgroup label="订阅"><option v-for="t in SUBSCRIBE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <optgroup label="AI"><option v-for="t in AI_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <option value="custom">自定义 API</option>
      </select>

      <div class="lang-row">
        <select v-model="fromLang" class="sel"><option value="auto">自动</option><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
        <span class="swap" :class="{ 'swap-disabled': fromLang === 'auto' }" @click="swapLang" :title="fromLang === 'auto' ? '自动检测时不支持交换' : '交换语言'">⇄</span>
        <select v-model="toLang" class="sel"><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
      </div>

      <textarea v-model="inputText" placeholder="输入或粘贴文本..." rows="3" @keydown.enter.ctrl="doTranslate"></textarea>

      <div class="actions">
        <button class="btn btn-clear" :disabled="!inputText" @click="clearText">清空</button>
        <button class="btn btn-go" :disabled="!inputText || loading" @click="doTranslate">
          <span v-if="loading" class="spinner"></span><span v-else>翻译</span>
        </button>
      </div>

      <template v-if="isWord && dictResult">
        <div class="section">
          <div class="section-tag tag-green">本地词典</div>
          <div v-if="dictResult.phonetic || dictResult.audio" class="phonetic">
            <span v-if="dictResult.phonetic?.uk" class="phon">英 [{{ dictResult.phonetic.uk }}]</span>
            <span v-if="dictResult.phonetic?.us" class="phon">美 [{{ dictResult.phonetic.us }}]</span>
            <button v-if="dictResult.audio?.uk" class="audio-btn" @click="playAudio(dictResult.audio.uk!)" title="英音">▶英</button>
            <button v-if="dictResult.audio?.us" class="audio-btn" @click="playAudio(dictResult.audio.us!)" title="美音">▶美</button>
            <a class="bing-link" :href="'https://www.bing.com/dict/search?q=' + encodeURIComponent(dictResult.word)" target="_blank">Bing ↗</a>
          </div>
          <div v-if="dictResult.definitions?.length" class="defs">
            <div v-for="(d, i) in dictResult.definitions" :key="i" class="def-item">
              <span v-if="d.pos" class="pos">{{ d.pos }}</span>
              <span class="def">{{ d.def }}</span>
            </div>
          </div>
          <div v-if="dictResult.presents?.length" class="presents">{{ dictResult.presents.join(', ') }}</div>
          <div v-if="dictResult.sentences?.length" class="sentences">
            <div v-for="(s, i) in dictResult.sentences.slice(0, 2)" :key="i" class="sent">
              <div class="sent-en">{{ s.en }}</div>
              <div class="sent-zh">{{ s.zh }}</div>
            </div>
          </div>
        </div>
      </template>
      <div v-if="dictLoading" class="dict-loading"><span class="spinner"></span> 查询词典...</div>

      <div v-if="result" class="result">
        <div class="result-bar">
          <span class="tag-blue">{{ getMeta(usedApi).name }}<em v-if="detectedSrc"> · {{ detectedSrc }}</em></span>
          <button class="copy-btn" @click="copyResult">{{ copied ? '✓' : '复制' }}</button>
        </div>
        <div class="result-text">{{ result }}</div>
      </div>

      <div v-if="error" class="error">
        {{ error }}
        <button v-if="!error.includes('设置')" class="retry-btn" @click="doTranslate">重试</button>
      </div>
    </div>

    <!-- ==================== 全文翻译 ==================== -->
    <div v-if="tab === 'page'" class="body">
      <select v-model="immersiveApi" class="sel api-sel">
        <option value="">跟随划词设置（{{ getMeta(currentApi).name }}）</option>
        <optgroup label="免费"><option v-for="t in FREE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <optgroup label="订阅"><option v-for="t in SUBSCRIBE_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <optgroup label="AI"><option v-for="t in AI_META" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <option value="custom">自定义 API</option>
      </select>

      <div class="mode-row">
        <button :class="['mode-btn', { active: immersiveMode === 'bilingual' }]" @click="immersiveMode = 'bilingual'">双语对照</button>
        <button :class="['mode-btn', { active: immersiveMode === 'translated-only' }]" @click="immersiveMode = 'translated-only'">仅译文</button>
      </div>

      <div v-if="immersiveState === 'idle'" class="immersive-hint">
        点击按钮翻译当前页面，译文将直接显示在页面上。
      </div>

      <div v-if="immersiveState === 'translating'" class="immersive-progress">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: immersivePercent + '%' }"></div></div>
        <div class="progress-text">{{ immersiveProgress.done }} / {{ immersiveProgress.total }}<span v-if="immersiveProgress.failed > 0" class="fail"> · {{ immersiveProgress.failed }}失败</span></div>
      </div>

      <div v-if="immersiveState === 'error'" class="immersive-err">
        {{ immersiveError || '翻译失败' }}
      </div>

      <div class="actions">
        <button v-if="immersiveState === 'translating'" class="btn btn-clear" @click="cancelImmersive">取消</button>
        <button v-else class="btn btn-go" @click="startImmersive">翻译此页面</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app { width: 360px; background: #f0f9ff; color: #0c4a6e; font-family: system-ui, sans-serif; }

.header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: linear-gradient(90deg, rgba(56,189,248,0.1), transparent); border-bottom: 1px solid rgba(56,189,248,0.12); }
.logo { width: 26px; height: 26px; border-radius: 6px; background: linear-gradient(135deg, #38bdf8, #7dd3fc); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; }
.title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #0ea5e9; flex: 1; }
.settings-btn { background: none; border: none; color: #64748b; font-size: 16px; cursor: pointer; opacity: 0.6; transition: opacity 0.2s; padding: 2px 4px; border-radius: 4px; }
.settings-btn:hover { opacity: 1; background: rgba(56,189,248,0.1); }

.tabs { display: flex; border-bottom: 1px solid rgba(56,189,248,0.12); }
.tabs button { flex: 1; padding: 8px 0; background: none; border: none; border-bottom: 2px solid transparent; color: #64748b; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.tabs button.active { color: #0ea5e9; border-bottom-color: #0ea5e9; }

.body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; }

.api-sel { width: 100%; }
.lang-row { display: flex; align-items: center; gap: 6px; }
.lang-row .sel { flex: 1; }

.sel { padding: 5px 8px; background: #fff; border: 1px solid rgba(56,189,248,0.25); border-radius: 5px; color: #0c4a6e; font-size: 12px; cursor: pointer; outline: none; }
.sel:focus { border-color: #38bdf8; }
.sel option, .sel optgroup { background: #f0f9ff; color: #0c4a6e; }

.swap { cursor: pointer; font-size: 16px; color: #0ea5e9; opacity: 0.7; user-select: none; transition: opacity 0.15s; }
.swap:hover { opacity: 1; }
.swap-disabled { opacity: 0.3; cursor: not-allowed; }

textarea { width: 100%; padding: 8px 10px; background: #fff; border: 1px solid rgba(56,189,248,0.25); border-radius: 6px; color: #0c4a6e; font-size: 13px; line-height: 1.5; resize: vertical; font-family: inherit; outline: none; }
textarea:focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.1); }
textarea::placeholder { color: #64748b; }

.actions { display: flex; gap: 6px; }
.btn { flex: 1; padding: 7px 0; border: none; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-clear { background: rgba(56,189,248,0.08); color: #0ea5e9; }
.btn-go { background: linear-gradient(135deg, #0ea5e9, #38bdf8); color: #fff; font-weight: 600; }
.btn-go:hover:not(:disabled) { box-shadow: 0 0 14px rgba(56,189,248,0.5); }

.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }

.section { background: #fff; border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; padding: 10px 12px; }
.section-tag { font-size: 9px; font-weight: 600; letter-spacing: .5px; padding: 2px 6px; border-radius: 3px; display: inline-block; margin-bottom: 8px; }
.tag-green { color: #10b981; background: rgba(16,185,129,0.1); }
.tag-blue { color: #3b82f6; background: rgba(59,130,246,0.1); padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: .5px; }

.phonetic { display: flex; gap: 12px; margin-bottom: 6px; align-items: center; flex-wrap: wrap; }
.phon { font-size: 12px; color: #0c4a6e; }
.audio-btn { padding: 2px 8px; font-size: 10px; border: 1px solid rgba(56,189,248,0.25); background: transparent; color: #0ea5e9; border-radius: 3px; cursor: pointer; transition: all 0.15s; }
.audio-btn:hover { background: rgba(56,189,248,0.1); }
.bing-link { font-size: 10px; color: #0ea5e9; text-decoration: none; margin-left: 6px; opacity: .7; transition: opacity .15s; }
.bing-link:hover { opacity: 1; text-decoration: underline; }

.defs { margin-bottom: 4px; }
.def-item { font-size: 12px; line-height: 1.5; padding: 1px 0; }
.pos { color: #0ea5e9; font-weight: 600; margin-right: 4px; }
.def { color: #334155; }
.presents { font-size: 11px; color: #64748b; margin-bottom: 4px; }
.sentences { margin-top: 4px; }
.sent { margin-bottom: 4px; }
.sent-en { font-size: 11px; color: #334155; line-height: 1.4; }
.sent-zh { font-size: 11px; color: #94a3b8; line-height: 1.4; font-style: italic; }

.dict-loading { display: flex; align-items: center; gap: 6px; color: #0ea5e9; font-size: 11px; }

.result { background: #fff; border: 1px solid rgba(56,189,248,0.25); border-radius: 8px; overflow: hidden; }
.result-bar { padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(56,189,248,0.12); background: rgba(56,189,248,0.04); }
.copy-btn { padding: 2px 8px; font-size: 10px; border: 1px solid rgba(56,189,248,0.25); background: transparent; color: #0ea5e9; border-radius: 4px; cursor: pointer; }
.copy-btn:hover { background: rgba(56,189,248,0.1); }
.result-text { padding: 10px; color: #0c4a6e; line-height: 1.6; max-height: 180px; overflow-y: auto; word-break: break-all; }

.error { padding: 8px 10px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.15); border-radius: 6px; color: #dc2626; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.retry-btn { padding: 3px 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #dc2626; border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
.retry-btn:hover { background: rgba(239,68,68,0.2); }

/* 全文翻译 */
.mode-row { display: flex; gap: 6px; }
.mode-btn { flex: 1; padding: 6px 0; font-size: 11px; border: 1px solid rgba(56,189,248,0.2); background: #fff; color: #64748b; border-radius: 6px; cursor: pointer; transition: all 0.15s; font-weight: 500; }
.mode-btn:hover { border-color: rgba(56,189,248,0.4); color: #0ea5e9; }
.mode-btn.active { background: rgba(14,165,233,0.1); border-color: #0ea5e9; color: #0ea5e9; font-weight: 600; }

.immersive-hint { font-size: 11px; color: #94a3b8; text-align: center; padding: 4px 0; }

.immersive-progress { display: flex; flex-direction: column; gap: 6px; }
.progress-bar { width: 100%; height: 5px; background: rgba(56,189,248,0.12); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius: 3px; transition: width 0.3s ease; }
.progress-text { font-size: 11px; color: #64748b; text-align: center; }
.fail { color: #ef4444; }

.immersive-err { font-size: 11px; color: #dc2626; text-align: center; padding: 4px 0; }
</style>
