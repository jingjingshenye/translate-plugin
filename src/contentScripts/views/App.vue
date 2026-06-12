<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

function onMouseUp(e: MouseEvent) {
  if (isOpen.value) return
  if (e.button !== 0) return

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

function onMousedown(e: MouseEvent) {
  if (!isInsideQt(e)) isOpen.value = false
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
      py = Math.min(selectionRect.bottom + 2, window.innerHeight - 370)
    } else {
      py = Math.max(8, selectionRect.top - 362)
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

// 点击外部关闭
function onDocMousedown(e: MouseEvent) {
  if (!isOpen.value) return
  const t = e.target as Element
  if (!t?.closest?.('[data-qt-popup]') && !t?.closest?.('[data-qt-icon]')) {
    closePopup()
  }
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onDocMousedown)
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

