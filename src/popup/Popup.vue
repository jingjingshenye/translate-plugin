<script setup lang="ts">
import { ref } from 'vue'
import { translateWithFallback, FREE_TRANSLATORS, ALL_TRANSLATORS, detectLang, getTargetLang } from '~/logic/translate'
import { useStorage } from '~/composables/useStorage'
import { isValidWord, lookupDict, localDict, bingDict, type DictResult } from '~/logic/dict'

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
const apiKeys = useStorage<Record<string, string>>('qt_api_keys', {})
const dictMode = useStorage<string>('qt_dict_mode', 'local')

// 词典
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

  // 翻译
  let from = fromLang.value, to = toLang.value
  if (from === 'auto') { from = detectLang(text); to = getTargetLang(from) }

  const translatePromise = translateWithFallback(text, from, to, undefined, currentApi.value, apiKeys.value[currentApi.value])
    .then(res => { result.value = res.text; detectedSrc.value = res.srcLang; usedApi.value = res.api || currentApi.value })
    .catch(() => { error.value = '翻译失败' })
    .finally(() => { loading.value = false })

  // 词典
  if (word) {
    if (dictMode.value === 'local') {
      localDict(text).then(local => { if (local) dictResult.value = local }).catch(() => {})
    } else if (dictMode.value === 'online') {
      dictLoading.value = true
      bingDict(text).then(r => { if (r) dictResult.value = r }).finally(() => { dictLoading.value = false })
    } else {
      dictLoading.value = true
      lookupDict(text).then(r => { if (r) dictResult.value = r }).finally(() => { dictLoading.value = false })
    }
  }
}

async function copyResult() {
  await navigator.clipboard.writeText(result.value)
  copied.value = true; setTimeout(() => { copied.value = false }, 1200)
}

function openOptions() { chrome.runtime.openOptionsPage() }
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="logo">译</div>
      <span class="title">QUICK TRANSLATE</span>
      <button class="settings-btn" @click="openOptions" title="设置">⚙</button>
    </header>

    <div class="body">
      <select v-model="currentApi" class="sel api-sel">
        <optgroup label="免费"><option v-for="t in FREE_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
        <optgroup label="AI"><option v-for="t in ALL_TRANSLATORS.filter(t => t.needKey)" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
      </select>

      <div class="lang-row">
        <select v-model="fromLang" class="sel"><option value="auto">自动</option><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
        <span class="swap" @click="swapLang">⇄</span>
        <select v-model="toLang" class="sel"><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
      </div>

      <textarea v-model="inputText" placeholder="输入或粘贴文本..." rows="3" @keydown.enter.ctrl="doTranslate"></textarea>

      <div class="actions">
        <button class="btn btn-clear" :disabled="!inputText" @click="clearText">清空</button>
        <button class="btn btn-go" :disabled="!inputText || loading" @click="doTranslate">
          <span v-if="loading" class="spinner"></span><span v-else>翻译</span>
        </button>
      </div>

      <!-- 词典结果 -->
      <template v-if="isWord && dictResult">
        <div class="section">
          <div class="section-tag tag-green">📚 本地词典 · ECDICT</div>
          <div v-if="dictResult.phonetic" class="phonetic">
            <span v-if="dictResult.phonetic.uk" class="phon">英 [{{ dictResult.phonetic.uk }}]</span>
            <span v-if="dictResult.phonetic.us" class="phon">美 [{{ dictResult.phonetic.us }}]</span>
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

      <!-- 翻译结果 -->
      <div v-if="result" class="result">
        <div class="result-bar">
          <span class="tag-blue">🌐 {{ (ALL_TRANSLATORS.find(t => t.id === usedApi)?.name || currentApi).toUpperCase() }}<em v-if="detectedSrc"> · {{ detectedSrc }}</em></span>
        </div>
        <div class="result-text">{{ result }}</div>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.app { width: 360px; background: #f0f9ff; color: #0c4a6e; font-family: system-ui, sans-serif; }

.header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: linear-gradient(90deg, rgba(56,189,248,0.1), transparent); border-bottom: 1px solid rgba(56,189,248,0.12); }
.logo { width: 26px; height: 26px; border-radius: 6px; background: linear-gradient(135deg, #38bdf8, #7dd3fc); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; }
.title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #0ea5e9; }
.settings-btn { margin-left: auto; background: none; border: none; color: #64748b; font-size: 16px; cursor: pointer; opacity: 0.6; transition: opacity 0.2s; padding: 2px 4px; border-radius: 4px; }
.settings-btn:hover { opacity: 1; background: rgba(56,189,248,0.1); }

.body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; }

.api-sel { width: 100%; }
.lang-row { display: flex; align-items: center; gap: 6px; }
.lang-row .sel { flex: 1; }

.sel { padding: 5px 8px; background: #fff; border: 1px solid rgba(56,189,248,0.25); border-radius: 5px; color: #0c4a6e; font-size: 12px; cursor: pointer; outline: none; }
.sel:focus { border-color: #38bdf8; }
.sel option, .sel optgroup { background: #f0f9ff; color: #0c4a6e; }

.swap { cursor: pointer; font-size: 16px; color: #0ea5e9; opacity: 0.7; user-select: none; }
.swap:hover { opacity: 1; }

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
@keyframes spin { to { transform: rotate(360deg); } }

.section { background: #fff; border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; padding: 10px 12px; }
.section-tag { font-size: 9px; font-weight: 600; letter-spacing: .5px; padding: 2px 6px; border-radius: 3px; display: inline-block; margin-bottom: 8px; }
.tag-green { color: #10b981; background: rgba(16,185,129,0.1); }
.tag-blue { color: #3b82f6; background: rgba(59,130,246,0.1); padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: .5px; }

.phonetic { display: flex; gap: 12px; margin-bottom: 6px; align-items: center; }
.phon { font-size: 12px; color: #0c4a6e; }
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

.error { padding: 8px 10px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.15); border-radius: 6px; color: #dc2626; font-size: 12px; }
</style>
