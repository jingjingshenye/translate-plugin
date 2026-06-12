<script setup lang="ts">
import { ref } from 'vue'
import { translateWithFallback, FREE_TRANSLATORS, ALL_TRANSLATORS, detectLang, getTargetLang } from '~/logic/translate'
import { useStorage } from '~/composables/useStorage'

const inputText = ref('')
const result = ref('')
const error = ref('')
const loading = ref(false)
const copied = ref(false)
const detectedSrc = ref('')
const fromLang = useStorage<string>('qt_from', 'auto')
const toLang = useStorage<string>('qt_to', 'zh')
const currentApi = useStorage<string>('qt_api', 'microsoft')
const apiKeys = useStorage<Record<string, string>>('qt_api_keys', {})

function swapLang() {
  if (fromLang.value === 'auto') return
  ;[fromLang.value, toLang.value] = [toLang.value, fromLang.value]
}

function clearText() {
  inputText.value = ''; result.value = ''; error.value = ''; detectedSrc.value = ''
}

async function doTranslate() {
  if (!inputText.value.trim() || loading.value) return
  loading.value = true; result.value = ''; error.value = ''; copied.value = false; detectedSrc.value = ''
  try {
    const text = inputText.value.trim()
    let from = fromLang.value, to = toLang.value
    if (from === 'auto') { from = detectLang(text); to = getTargetLang(from) }
    const res = await translateWithFallback(text, from, to, undefined, currentApi.value, apiKeys.value[currentApi.value])
    result.value = res.text; detectedSrc.value = res.srcLang
  } catch (e: any) { error.value = '翻译失败' }
  finally { loading.value = false }
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

      <div v-if="result" class="result">
        <div class="result-bar">
          <span>{{ currentApi.toUpperCase() }}<em v-if="detectedSrc"> · {{ detectedSrc }}</em></span>
          <button class="copy-btn" @click="copyResult">{{ copied ? '已复制' : '复制' }}</button>
        </div>
        <div class="result-text">{{ result }}</div>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.app {
  width: 360px; background: var(--qt-bg); color: var(--qt-text);
  font-family: 'SF Pro', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

.header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: linear-gradient(90deg, rgba(56,189,248,0.12), transparent);
  border-bottom: 1px solid var(--qt-border-light);
}
.logo {
  width: 26px; height: 26px; border-radius: 6px;
  background: linear-gradient(135deg, var(--qt-primary), var(--qt-primary-light));
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: #fff;
}
.title {
  font-size: 11px; font-weight: 700; letter-spacing: 2px;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.settings-btn {
  margin-left: auto; background: none; border: none;
  color: var(--qt-text-light); font-size: 16px; cursor: pointer;
  opacity: 0.6; transition: opacity 0.2s; padding: 2px 4px; border-radius: 4px;
}
.settings-btn:hover { opacity: 1; background: rgba(56,189,248,0.1); }

.body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; }

.api-sel { width: 100%; }

.lang-row { display: flex; align-items: center; gap: 6px; }
.lang-row .sel { flex: 1; }

.sel {
  padding: 5px 8px; background: var(--qt-bg-input);
  border: 1px solid var(--qt-border); border-radius: 5px;
  color: var(--qt-text); font-size: 12px; cursor: pointer; outline: none;
}
.sel:focus { border-color: var(--qt-primary); }
.sel option, .sel optgroup { background: var(--qt-bg-card); color: var(--qt-text); }

.swap {
  cursor: pointer; font-size: 16px;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  opacity: 0.7; user-select: none;
}
.swap:hover { opacity: 1; }

textarea {
  width: 100%; padding: 8px 10px; background: var(--qt-bg-input);
  border: 1px solid var(--qt-border); border-radius: 6px;
  color: var(--qt-text); font-size: 13px; line-height: 1.5;
  resize: vertical; font-family: inherit; outline: none;
}
textarea:focus { border-color: var(--qt-primary); box-shadow: 0 0 0 2px rgba(56,189,248,0.1); }
textarea::placeholder { color: var(--qt-text-light); }

.actions { display: flex; gap: 6px; }
.btn {
  flex: 1; padding: 7px 0; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-clear { background: rgba(56,189,248,0.08); color: var(--qt-primary-dark); }
.btn-go { background: linear-gradient(135deg, var(--qt-primary-dark), var(--qt-primary)); color: #fff; font-weight: 600; }
.btn-go:hover:not(:disabled) { box-shadow: 0 0 14px var(--qt-primary-glow); }

.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.result { background: var(--qt-bg-input); border: 1px solid var(--qt-border); border-radius: 8px; overflow: hidden; }
.result-bar {
  padding: 6px 10px; display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid var(--qt-border-light); background: rgba(56,189,248,0.04);
}
.result-bar span {
  font-size: 10px; letter-spacing: 1.5px; font-weight: 600;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.result-bar em { font-style: normal; -webkit-text-fill-color: var(--qt-primary-dark); }
.copy-btn {
  padding: 2px 8px; font-size: 10px; border: 1px solid var(--qt-border);
  background: transparent; color: var(--qt-primary-dark); border-radius: 4px; cursor: pointer;
}
.copy-btn:hover { background: rgba(56,189,248,0.1); }
.result-text { padding: 10px; color: var(--qt-text); line-height: 1.6; max-height: 180px; overflow-y: auto; word-break: break-all; }

.error { padding: 8px 10px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.15); border-radius: 6px; color: #dc2626; font-size: 12px; }
</style>
