<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { translateWithFallback, detectLang, getTargetLang, ALL_TRANSLATORS, FREE_TRANSLATORS, AI_TRANSLATORS } from '~/logic/translate'
import { isValidWord, lookupDict, localDict, bingDict, type DictResult } from '~/logic/dict'

const MAX_SELECTION_LENGTH = 5000
const POPUP_WIDTH = 340
const POPUP_MAX_HEIGHT = 370
const ICON_SIZE = 28
const POPUP_MARGIN = 8
const POPUP_ABOVE_OFFSET = 362
const POPUP_BELOW_THRESHOLD = 200
const HOVER_DELAY = 300
const MOUSEUP_DELAY = 100

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
const isWord = ref(false)
const dictResult = ref<DictResult | null>(null)
const dictLoading = ref(false)
const usedApi = ref('')
const showLangMenu = ref(false)
const transFrom = ref('auto')
const transTo = ref('zh')
const customApi = ref({ url: '', key: '', model: 'gpt-4o-mini', prompt: '' })

const langMap: Record<string, string> = {
  'auto': '自动', 'zh': '中文', 'en': 'EN', 'ja': '日本語', 'ko': '한국어',
  'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
}

let selectionRect: DOMRect | null = null
let controller: AbortController | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['qt_api', 'qt_api_keys', 'qt_custom_api'])
    if (result.qt_api) currentApi.value = result.qt_api
    if (result.qt_api_keys) apiKeys.value = result.qt_api_keys
    if (result.qt_custom_api) customApi.value = result.qt_custom_api
  } catch (e) { console.warn('[QT] loadSettings:', e) }
}
loadSettings()

chrome.storage.onChanged.addListener((changes) => {
  if (changes.qt_api) currentApi.value = changes.qt_api.newValue
  if (changes.qt_api_keys) apiKeys.value = changes.qt_api_keys.newValue
  if (changes.qt_custom_api) customApi.value = changes.qt_custom_api.newValue
})

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'translate-text' && message.text) {
    sourceText.value = message.text
    selectionRect = null
    popupPos.value = { x: window.innerWidth - 360, y: 20 }
    doTranslate(message.text)
  }
})

// ============================================
// Text measurement (canvas-based, for input/textarea caret positioning)
// ============================================
const measureCanvas = document.createElement('canvas')

function measureTextWidth(element: HTMLInputElement | HTMLTextAreaElement, text: string): number {
  const computedStyle = getComputedStyle(element)
  const context = measureCanvas.getContext('2d')!
  context.font = `${computedStyle.fontStyle} ${computedStyle.fontVariant} ${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`
  return context.measureText(text).width
}

function getCaretPosition(element: HTMLInputElement | HTMLTextAreaElement, offset: number): { x: number; y: number; height: number } {
  const textBefore = element.value.substring(0, offset)
  const computedStyle = getComputedStyle(element)
  const borderTop = parseFloat(computedStyle.borderTopWidth) || 0
  const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0
  const scrollTop = element.scrollTop || 0
  const scrollLeft = element.scrollLeft || 0

  if (element.tagName === 'TEXTAREA') {
    const lines = textBefore.split('\n')
    const lineIndex = lines.length - 1
    const lineHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.2 || 18
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0
    const textWidth = measureTextWidth(element, lines[lineIndex])
    return { x: borderLeft + paddingLeft + textWidth - scrollLeft, y: borderTop + paddingTop + lineIndex * lineHeight + lineHeight - scrollTop, height: lineHeight }
  }

  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0
  const fontSize = parseFloat(computedStyle.fontSize) || 14
  const textWidth = measureTextWidth(element, textBefore)
  return { x: borderLeft + paddingLeft + textWidth - scrollLeft, y: borderTop + fontSize, height: fontSize }
}

// ============================================
// Selection detection: input/textarea, Shadow DOM (via getComposedRanges), regular page
// ============================================

function findInputElement(event: MouseEvent): HTMLInputElement | HTMLTextAreaElement | null {
  const target = event.target as HTMLElement
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return target as HTMLInputElement | HTMLTextAreaElement
  try {
    for (const el of event.composedPath()) {
      const tag = (el as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return el as HTMLInputElement | HTMLTextAreaElement
    }
  } catch {}
  // activeElement 穿透 shadow root（Chrome 扩展 composedPath 可能不可靠）
  let active: Element | null = document.activeElement
  while (active?.shadowRoot) active = active.shadowRoot.activeElement
  if (active && ((active as HTMLElement).tagName === 'INPUT' || (active as HTMLElement).tagName === 'TEXTAREA'))
    return active as HTMLInputElement | HTMLTextAreaElement
  return null
}

// ============================================
// Event handlers
// ============================================

function onMouseUp(event: MouseEvent) {
  if (isOpen.value) return
  if (event.button !== 0) return

  // 在事件阶段立即查找 input（composedPath() 在 setTimeout 中可能失效）
  const inputElement = findInputElement(event)

  setTimeout(() => {
    const hit = getInputSelection(inputElement) || getComposedSelection()
    if (!hit) return

    selectionRect = hit.rect
    sourceText.value = hit.text
    iconPos.value = {
      x: Math.min(hit.rect.right, window.innerWidth - ICON_SIZE),
      y: Math.min(hit.rect.bottom, window.innerHeight - ICON_SIZE),
    }
  }, MOUSEUP_DELAY)
}

function getInputSelection(element: HTMLInputElement | HTMLTextAreaElement | null): { text: string; rect: DOMRect } | null {
  if (!element) return null

  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? 0
  const text = element.value.substring(start, end).trim()
  if (!text || text.length < 1 || text.length > MAX_SELECTION_LENGTH) return null

  const boundingRect = element.getBoundingClientRect()
  const caretPos = getCaretPosition(element, end)
  const caretX = boundingRect.left + Math.min(caretPos.x, boundingRect.width)
  const caretY = boundingRect.top + Math.min(caretPos.y, boundingRect.height)
  const rect = new DOMRect(caretX, caretY - caretPos.height, 0, caretPos.height)
  return { text, rect }
}

function getComposedSelection(): { text: string; rect: DOMRect } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  // getComposedRanges() 穿透 Shadow DOM 边界，返回 StaticRange[]
  const composedRanges = selection.getComposedRanges()
  if (!composedRanges || composedRanges.length === 0) return null

  const staticRange = composedRanges[0]
  if (staticRange.collapsed) return null

  // StaticRange 没有 getClientRects()，需要转换为完整 Range
  const range = new Range()
  range.setStart(staticRange.startContainer, staticRange.startOffset)
  range.setEnd(staticRange.endContainer, staticRange.endOffset)

  const text = range.toString().trim()
  if (!text || text.length < 1 || text.length > MAX_SELECTION_LENGTH) return null

  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  if (!rect || rect.width === 0) return null

  return { text, rect }
}

function calculatePopupPosition(): { x: number; y: number } {
  if (!selectionRect) return { x: POPUP_MARGIN, y: POPUP_MARGIN }

  const x = Math.max(POPUP_MARGIN, Math.min(selectionRect.left, window.innerWidth - POPUP_WIDTH - POPUP_MARGIN))
  const spaceBelow = window.innerHeight - selectionRect.bottom
  const spaceAbove = selectionRect.top
  const y = (spaceBelow >= POPUP_BELOW_THRESHOLD || spaceBelow >= spaceAbove)
    ? Math.min(selectionRect.bottom + 2, window.innerHeight - POPUP_MAX_HEIGHT)
    : Math.max(POPUP_MARGIN, selectionRect.top - POPUP_ABOVE_OFFSET)
  return { x, y }
}

function onIconClick(event: MouseEvent) {
  event.stopPropagation()
  if (!sourceText.value) return

  popupPos.value = calculatePopupPosition()
  doTranslate(sourceText.value)
}

function onIconMouseEnter() {
  if (sourceText.value && !isOpen.value) {
    hoverTimer = setTimeout(() => {
      popupPos.value = calculatePopupPosition()
      doTranslate(sourceText.value)
    }, HOVER_DELAY)
  }
}

function onIconMouseLeave() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
}

async function doTranslate(text: string, overrideFrom?: string, overrideTo?: string) {
  isOpen.value = true
  loading.value = true
  error.value = ''
  translatedText.value = ''
  detectedSrc.value = ''
  dictResult.value = null
  isWord.value = false
  checkFaved(text)

  if (controller) controller.abort()
  controller = new AbortController()
  const signal = controller.signal

  const isEnglishWord = isValidWord(text)
  const isChineseChar = text.length === 1 && /[\u4e00-\u9fa5]/.test(text)
  isWord.value = isEnglishWord || isChineseChar

  const src = overrideFrom || (transFrom.value !== 'auto' ? transFrom.value : detectLang(text))
  const target = overrideTo || transTo.value || (src === 'zh' ? 'en' : 'zh')
  if (transFrom.value === 'auto') transFrom.value = src

  const translatePromise = translateWithFallback(text, src, target, signal, currentApi.value, apiKeys.value[currentApi.value], customApi.value)
    .then(result => {
      if (!signal.aborted) {
        translatedText.value = result.text
        detectedSrc.value = result.srcLang
        usedApi.value = result.api || currentApi.value
      }
    })
    .catch(err => { if (err.name !== 'AbortError') error.value = '翻译失败' })

  let dictPromise: Promise<void> = Promise.resolve()
  if (isEnglishWord) {
    dictLoading.value = true
    dictPromise = lookupDict(text, signal)
      .then(result => { if (!signal.aborted && result) dictResult.value = result })
      .catch(() => {})
      .finally(() => { if (!signal.aborted) dictLoading.value = false })
  }

  await Promise.all([translatePromise, dictPromise])
  if (!signal.aborted) loading.value = false
}

function closePopup() {
  isOpen.value = false
  loading.value = false
  showLangMenu.value = false
  sourceText.value = ''
  dictResult.value = null
  if (controller) { controller.abort(); controller = null }
}

function retranslateWithLang() {
  showLangMenu.value = false
  if (sourceText.value) doTranslate(sourceText.value, transFrom.value, transTo.value)
}

const isFaved = ref(false)
async function checkFaved(word: string) {
  try {
    const result = await chrome.storage.local.get('qt_words')
    isFaved.value = !!(result.qt_words && result.qt_words[word])
  } catch { isFaved.value = false }
}
async function toggleFav() {
  if (!sourceText.value) return
  try {
    const result = await chrome.storage.local.get('qt_words')
    const words = result.qt_words ? { ...result.qt_words } : {}
    if (words[sourceText.value]) { delete words[sourceText.value]; isFaved.value = false }
    else { words[sourceText.value] = { createdAt: Date.now(), translation: translatedText.value }; isFaved.value = true }
    await chrome.storage.local.set({ qt_words: words })
  } catch {}
}

function copyText() { navigator.clipboard.writeText(translatedText.value) }

function onDocumentMousedown(event: MouseEvent) {
  if (!isOpen.value) return
  const target = event.target as Element
  if (!target?.closest?.('[data-qt-popup]') && !target?.closest?.('[data-qt-icon]')) closePopup()
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onDocumentMousedown)
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') closePopup() }
document.addEventListener('keydown', onKeydown)

onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onKeydown)
  if (hoverTimer) clearTimeout(hoverTimer)
})
</script>

<template>
  <div data-qt>
    <div
      v-if="sourceText && !isOpen"
      data-qt-icon class="qt-icon"
      :style="{ left: iconPos.x + 'px', top: iconPos.y + 'px' }"
      @mousedown.prevent @click="onIconClick"
      @mouseenter="onIconMouseEnter" @mouseleave="onIconMouseLeave"
    >译</div>

    <div v-if="isOpen" data-qt-popup class="qt-popup"
      :style="{ left: popupPos.x + 'px', top: popupPos.y + 'px' }"
      @mousedown.stop @mouseup.stop
    >
      <div class="qt-header">
        <span class="qt-title">QUICK TRANSLATE{{ detectedSrc ? ' · ' + detectedSrc : '' }}</span>
        <span class="qt-header-actions">
          <div class="qt-lang-wrap" v-if="!loading">
            <button class="qt-lang-btn" @click.stop="showLangMenu = !showLangMenu">
              {{ langMap[transFrom] || '自动' }} → {{ langMap[transTo] || '中文' }} ▾
            </button>
            <div v-if="showLangMenu" class="qt-lang-menu" @mousedown.stop>
              <div class="qt-lang-row">
                <select v-model="transFrom" class="qt-lang-sel">
                  <option value="auto">自动</option><option value="zh">中文</option><option value="en">English</option>
                  <option value="ja">日本語</option><option value="ko">한국어</option>
                </select>
                <span class="qt-lang-arrow">→</span>
                <select v-model="transTo" class="qt-lang-sel">
                  <option value="zh">中文</option><option value="en">English</option>
                  <option value="ja">日本語</option><option value="ko">한국어</option>
                </select>
              </div>
              <button class="qt-lang-go" @click="retranslateWithLang">翻译</button>
            </div>
          </div>
          <button v-if="!loading && !error" class="qt-fav-btn" @click="toggleFav" :title="isFaved ? '取消收藏' : '收藏'">{{ isFaved ? '♥' : '♡' }}</button>
          <span class="qt-close" @click="closePopup">&times;</span>
        </span>
      </div>

      <div class="qt-body">
        <div class="qt-label">原文</div>
        <div class="qt-source">{{ sourceText }}</div>

        <template v-if="isWord && dictResult">
          <div class="qt-dict-tag"><span class="qt-dict-badge">本地词典</span></div>
          <div v-if="dictResult.phonetic" class="qt-phonetic">
            <span v-if="dictResult.phonetic.uk" class="qt-phon-item">英 [{{ dictResult.phonetic.uk }}]</span>
            <span v-if="dictResult.phonetic.us" class="qt-phon-item">美 [{{ dictResult.phonetic.us }}]</span>
            <a class="qt-bing-link" :href="'https://www.bing.com/dict/search?q=' + encodeURIComponent(dictResult.word)" target="_blank" @click.stop>Bing ↗</a>
          </div>
          <div v-if="dictLoading" class="qt-loading"><span class="qt-spinner"></span> 补充词典...</div>
          <div v-if="dictResult.definitions?.length" class="qt-defs">
            <div v-for="(d, i) in dictResult.definitions" :key="i" class="qt-def-item">
              <span v-if="d.pos" class="qt-pos">{{ d.pos }}</span>
              <span class="qt-def">{{ d.def }}</span>
            </div>
          </div>
          <div v-if="dictResult.presents?.length" class="qt-presents">{{ dictResult.presents.join(', ') }}</div>
          <div v-if="dictResult.sentences?.length" class="qt-sentences">
            <div v-for="(s, i) in dictResult.sentences.slice(0, 2)" :key="i" class="qt-sent">
              <div class="qt-sent-en">{{ s.en }}</div>
              <div class="qt-sent-zh">{{ s.zh }}</div>
            </div>
          </div>
          <div class="qt-divider"></div>
        </template>

        <div class="qt-trans-tag">
          <span class="qt-trans-badge">{{ (ALL_TRANSLATORS.find(t => t.id === usedApi)?.name || currentApi).toUpperCase() }}</span>
        </div>
        <div v-if="loading" class="qt-loading"><span class="qt-spinner"></span> 翻译中...</div>
        <div v-else-if="error" class="qt-error">{{ error }}</div>
        <div v-else class="qt-result">{{ translatedText }}</div>
      </div>
    </div>
  </div>
</template>
