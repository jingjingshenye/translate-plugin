<script setup lang="ts">
import { ref, onMounted } from 'vue'
import '~/styles/theme.css'
import { translateWithFallback, FREE_TRANSLATORS, ALL_TRANSLATORS, detectLang, getTargetLang } from '~/logic/translate'

const isOpen = ref(false)
const loading = ref(false)
const error = ref('')
const iconPos = ref({ x: 0, y: 0 })
const popupPos = ref({ x: 0, y: 0 })
const sourceText = ref('')
const translatedText = ref('')
const detectedSrc = ref('')
const currentApi = ref('microsoft')
const apiKeys = ref<Record<string, string>>({})

let selectionRect: DOMRect | null = null
let controller: AbortController | null = null

// 读取设置（参考 useWebExtensionStorage 跨上下文同步模式）
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['qt_api', 'qt_api_keys'])
    if (result.qt_api) currentApi.value = result.qt_api
    if (result.qt_api_keys) apiKeys.value = result.qt_api_keys
  } catch {}
}
loadSettings()

// 监听设置变更（从 popup/options 页面同步过来）
chrome.storage.onChanged.addListener((changes) => {
  if (changes.qt_api) currentApi.value = changes.qt_api.newValue
  if (changes.qt_api_keys) apiKeys.value = changes.qt_api_keys.newValue
})

function onMouseUp(e: MouseEvent) {
  if (isOpen.value) return
  if (e.button !== 0) return
  const t = e.target as Element
  if (t?.closest?.('[data-qt]')) return

  setTimeout(() => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text || text.length < 1 || text.length > 5000) return

    try {
      const range = sel!.getRangeAt(0)
      const rects = range.getClientRects()
      selectionRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
    } catch { return }
    if (!selectionRect || selectionRect.width === 0) return

    sourceText.value = text
    iconPos.value = {
      x: Math.min(selectionRect.right, window.innerWidth - 28),
      y: Math.min(selectionRect.bottom, window.innerHeight - 28),
    }
  }, 100)
}

function onIconClick(e: MouseEvent) {
  e.stopPropagation()
  if (!sourceText.value) return

  const popupW = 340
  let px = 8, py = 8

  if (selectionRect) {
    px = Math.max(8, Math.min(selectionRect.left, window.innerWidth - popupW - 8))

    const spaceBelow = window.innerHeight - selectionRect.bottom
    const spaceAbove = selectionRect.top
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      py = selectionRect.bottom + 2
    } else {
      py = Math.max(8, selectionRect.top - 360 - 2)
    }
  }

  popupPos.value = { x: px, y: py }

  isOpen.value = true
  loading.value = true
  error.value = ''
  translatedText.value = ''
  detectedSrc.value = ''

  if (controller) controller.abort()
  controller = new AbortController()
  const signal = controller.signal

  const src = detectLang(sourceText.value)
  const target = getTargetLang(src)

  translateWithFallback(sourceText.value, src, target, signal, currentApi.value, apiKeys.value[currentApi.value]).then((result) => {
    if (signal.aborted) return
    translatedText.value = result.text
    detectedSrc.value = result.srcLang
  }).catch((err) => {
    if (err.name === 'AbortError') return
    error.value = '翻译失败'
  }).finally(() => {
    if (!signal.aborted) loading.value = false
  })
}

function closePopup() {
  isOpen.value = false
  loading.value = false
  sourceText.value = ''
  if (controller) { controller.abort(); controller = null }
}

function copyText() { navigator.clipboard.writeText(translatedText.value) }

function onMousedown(e: MouseEvent) {
  if (!(e.target as Element)?.closest?.('[data-qt]')) isOpen.value = false
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onMousedown)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup() })
</script>

<template>
  <div data-qt>
    <div
      v-if="sourceText && !isOpen"
      data-qt-icon
      class="qt-icon"
      :style="{ left: iconPos.x + 'px', top: iconPos.y + 'px' }"
      @mousedown.prevent
      @click="onIconClick"
    >译</div>

    <div
      v-if="isOpen"
      data-qt-popup
      class="qt-popup"
      :style="{ left: popupPos.x + 'px', top: popupPos.y + 'px' }"
      @mousedown.stop
      @mouseup.stop
    >
      <div class="qt-header">
        <span class="qt-title">TRANSLATE · {{ currentApi.toUpperCase() }}{{ detectedSrc ? ' · ' + detectedSrc : '' }}</span>
        <span class="qt-header-actions">
          <button v-if="!loading && !error" class="qt-copy-btn" @click="copyText">复制</button>
          <span class="qt-close" @click="closePopup">&times;</span>
        </span>
      </div>

      <div class="qt-body">
        <div class="qt-label">原文</div>
        <div class="qt-source">{{ sourceText }}</div>
        <div class="qt-divider" />
        <div class="qt-label qt-label-accent">译文</div>
        <div v-if="loading" class="qt-loading">
          <span class="qt-spinner" />
          <span>翻译中...</span>
        </div>
        <div v-else-if="error" class="qt-error">{{ error }}</div>
        <div v-else class="qt-result">{{ translatedText }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qt-icon {
  all: initial;
  position: fixed; z-index: 2147483647;
  width: 24px; height: 24px; border-radius: 5px;
  background: linear-gradient(135deg, var(--qt-primary), var(--qt-primary-light));
  color: #fff; display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 12px; font-weight: 700;
  font-family: system-ui, sans-serif;
  box-shadow: 0 0 10px var(--qt-primary-glow), 0 2px 6px rgba(0,0,0,0.15);
  transition: all 0.15s; user-select: none;
}
.qt-icon:hover {
  transform: scale(1.15);
  box-shadow: 0 0 18px var(--qt-primary-glow), 0 4px 10px rgba(0,0,0,0.2);
}

.qt-popup {
  all: initial;
  position: fixed; z-index: 2147483647;
  width: 340px; max-width: 90vw; max-height: 360px;
  background: var(--qt-bg-card);
  border: 1px solid var(--qt-border);
  border-radius: 8px; overflow: hidden;
  font-family: system-ui, sans-serif;
  box-shadow: 0 4px 20px rgba(56,189,248,0.15), 0 6px 24px rgba(0,0,0,0.08);
}

.qt-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 12px; margin: 0;
  background: linear-gradient(90deg, rgba(56,189,248,0.1), transparent);
  border-bottom: 1px solid var(--qt-border-light);
}

.qt-title {
  font-size: 12px; font-weight: 700; letter-spacing: 1px; margin: 0; padding: 0;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}

.qt-header-actions {
  display: flex; align-items: center; gap: 6px; margin: 0; padding: 0;
}

.qt-copy-btn {
  padding: 2px 8px; font-size: 12px; margin: 0;
  border: 1px solid var(--qt-border);
  background: transparent; color: var(--qt-primary-dark);
  border-radius: 3px; cursor: pointer; transition: all 0.15s;
}
.qt-copy-btn:hover { background: rgba(56,189,248,0.1); }

.qt-close {
  color: var(--qt-text-light); cursor: pointer; margin: 0; padding: 0;
  font-size: 14px; line-height: 1; transition: color 0.15s;
}
.qt-close:hover { color: #ef4444; }

.qt-body { padding: 8px 12px 10px; margin: 0; }

.qt-label {
  color: var(--qt-text-light); font-size: 12px; margin: 0 0 3px; padding: 0;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.qt-label-accent { color: var(--qt-primary-dark); }

.qt-source {
  color: var(--qt-text); font-size: 12px; font-weight: 400; margin: 0 0 6px; padding: 0;
  line-height: 1.4; max-height: 60px; overflow-y: auto;
  word-break: break-all;
}

.qt-divider { border-top: 1px solid var(--qt-border-light); margin: 0; padding: 6px 0 0; }

.qt-loading {
  display: flex; align-items: center; gap: 6px; padding: 4px 0; margin: 0;
  color: var(--qt-primary-dark); font-size: 12px;
}

.qt-spinner {
  width: 12px; height: 12px; margin: 0; padding: 0;
  border: 2px solid var(--qt-border-light);
  border-top-color: var(--qt-primary-dark);
  border-radius: 50%;
  animation: qt-spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes qt-spin { to { transform: rotate(360deg); } }

.qt-error { color: #dc2626; font-size: 12px; padding: 4px 0; margin: 0; }

.qt-result {
  color: var(--qt-text); font-size: 12px; font-weight: 400; line-height: 1.5; margin: 0; padding: 0;
  max-height: 200px; overflow-y: auto; word-break: break-all;
}
</style>
