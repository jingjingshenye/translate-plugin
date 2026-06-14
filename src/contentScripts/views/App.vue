<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { useEncryptedKeys } from '~/composables/useEncryptedKeys'
import { useFavorites } from '~/composables/useFavorites'
import { invokeTranslate, invokeLookupDict, type DictMode } from '~/logic/background-api'
import { detectLang } from '~/logic/lang-utils'
import { getMeta } from '~/logic/translators-meta'
import { isValidWord, type DictResult } from '~/logic/dict'

const MAX_SELECTION_LENGTH = 5000
const POPUP_WIDTH = 340
const POPUP_MAX_HEIGHT = 370
const ICON_SIZE = 28
const POPUP_MARGIN = 8
const POPUP_ABOVE_OFFSET = 362
const POPUP_BELOW_THRESHOLD = 200
const MOUSEUP_DELAY = 100

const isOpen = ref(false)
const loading = ref(false)
const error = ref('')
const iconPos = ref({ x: 0, y: 0 })
const popupPos = ref({ x: 0, y: 0 })
const sourceText = ref('')
const translatedText = ref('')
const detectedSrc = ref('')
const currentApi = useStorage<string>('qt_api', 'microsoft')
const apiKeys = useEncryptedKeys('qt_api_keys')
const customApi = useStorage('qt_custom_api', { url: '', key: '', model: 'gpt-4o-mini', prompt: '' })
const dictMode = useStorage<string>('qt_dict_mode', 'both')
const isWord = ref(false)
const dictResult = ref<DictResult | null>(null)
const dictLoading = ref(false)
const usedApi = ref('')
const showLangMenu = ref(false)
const transFrom = ref('auto')
const transTo = ref('zh')

const langMap: Record<string, string> = {
  'auto': '自动', 'zh': '中文', 'en': 'EN', 'ja': '日本語', 'ko': '한국어',
  'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
}

let selectionRect: DOMRect | null = null
let reqId = 0 // 防止翻译请求 race

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
// Selection detection
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
  let active: Element | null = document.activeElement
  while (active?.shadowRoot) active = active.shadowRoot.activeElement
  if (active && ((active as HTMLElement).tagName === 'INPUT' || (active as HTMLElement).tagName === 'TEXTAREA'))
    return active as HTMLInputElement | HTMLTextAreaElement
  return null
}

function onMouseUp(event: MouseEvent) {
  if (isOpen.value) return
  if (event.button !== 0) return

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

  const composedRanges = selection.getComposedRanges()
  if (!composedRanges || composedRanges.length === 0) return null

  const staticRange = composedRanges[0]
  if (staticRange.collapsed) return null

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

function calculatePopupIndex(): { x: number; y: number } {
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
  popupPos.value = calculatePopupIndex()
  doTranslate(sourceText.value)
}

// ============================================
// 收藏（composable 统一管理）
// ============================================
const { words: favWords, toggle: toggleFavFn } = useFavorites()
const isFaved = computed(() => !!favWords.value[sourceText.value])
function toggleFav() {
  if (!sourceText.value) return
  toggleFavFn(sourceText.value, translatedText.value)
}

// ============================================
// 翻译入口（通过 background）
// ============================================
async function doTranslate(text: string, overrideFrom?: string, overrideTo?: string) {
  isOpen.value = true
  loading.value = true
  error.value = ''
  translatedText.value = ''
  detectedSrc.value = ''
  dictResult.value = null
  isWord.value = false

  const myId = ++reqId

  const isEnglishWord = isValidWord(text)
  const isChineseChar = text.length === 1 && /[一-鿿]/.test(text)
  isWord.value = isEnglishWord || isChineseChar

  const src = overrideFrom || (transFrom.value !== 'auto' ? transFrom.value : detectLang(text))
  const target = overrideTo || transTo.value || (src === 'zh' ? 'en' : 'zh')
  if (transFrom.value === 'auto') transFrom.value = src

  // 词典查询（与翻译独立，无 Key 也查）
  let dictPromise: Promise<void> = Promise.resolve()
  if (isEnglishWord) {
    dictLoading.value = true
    dictPromise = invokeLookupDict({ text, mode: dictMode.value as DictMode })
      .then(result => { if (myId === reqId && result) dictResult.value = result })
      .catch(() => {})
      .finally(() => { if (myId === reqId) dictLoading.value = false })
  }

  // Key 缺失检测：词典仍可查，仅翻译被阻止
  const meta = getMeta(currentApi.value)
  const isCustom = currentApi.value === 'custom'
  if (!isCustom && meta.needKey && !apiKeys.value[currentApi.value]) {
    loading.value = false
    error.value = `${meta.name} 需要配置 API Key（在设置中）`
    await dictPromise
    return
  }
  if (isCustom && !customApi.value.url) {
    loading.value = false
    error.value = '请在设置中配置自定义 API URL'
    await dictPromise
    return
  }

  invokeTranslate({
    text, from: src, to: target,
    api: currentApi.value,
    apiKey: apiKeys.value[currentApi.value],
    customConfig: isCustom ? customApi.value : undefined,
  })
    .then(result => {
      if (myId !== reqId) return
      translatedText.value = result.text
      detectedSrc.value = result.srcLang
      usedApi.value = result.api || currentApi.value
    })
    .catch(() => { if (myId === reqId) error.value = '翻译失败' })
    .finally(() => { if (myId === reqId) loading.value = false })

  await dictPromise
}

function playAudio(url: string) {
  try { new Audio(url).play().catch(() => {}) } catch {}
}

function closePopup() {
  isOpen.value = false
  loading.value = false
  showLangMenu.value = false
  sourceText.value = ''
  dictResult.value = null
  reqId++ // 让进行中的请求作废
}

function retranslateWithLang() {
  showLangMenu.value = false
  if (sourceText.value) doTranslate(sourceText.value, transFrom.value, transTo.value)
}

function onDocumentMousedown(event: MouseEvent) {
  const target = event.target as Element
  // 点击在 icon/popup 内：不处理
  if (target?.closest?.('[data-qt-popup]') || target?.closest?.('[data-qt-icon]')) return

  // 点击在 icon/popup 外：关 popup（若开着），并清 sourceText 让 icon 消失
  if (isOpen.value) {
    closePopup()
  } else if (sourceText.value) {
    sourceText.value = ''
  }
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onDocumentMousedown)
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') closePopup() }
document.addEventListener('keydown', onKeydown)

onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div data-qt>
    <div
      v-if="sourceText && !isOpen"
      data-qt-icon class="qt-icon"
      :style="{ left: iconPos.x + 'px', top: iconPos.y + 'px' }"
      @mousedown.prevent @click="onIconClick"
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
          <div v-if="dictResult.phonetic || dictResult.audio" class="qt-phonetic">
            <span v-if="dictResult.phonetic?.uk" class="qt-phon-item">英 [{{ dictResult.phonetic.uk }}]</span>
            <span v-if="dictResult.phonetic?.us" class="qt-phon-item">美 [{{ dictResult.phonetic.us }}]</span>
            <button v-if="dictResult.audio?.uk" class="qt-audio-btn" @click.stop="playAudio(dictResult.audio.uk!)" title="英音发音">▶英</button>
            <button v-if="dictResult.audio?.us" class="qt-audio-btn" @click.stop="playAudio(dictResult.audio.us!)" title="美音发音">▶美</button>
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
          <span class="qt-trans-badge">{{ getMeta(usedApi).name.toUpperCase() }}</span>
        </div>
        <div v-if="loading" class="qt-loading"><span class="qt-spinner"></span> 翻译中...</div>
        <div v-else-if="error" class="qt-error">
          {{ error }}
          <button v-if="!error.includes('设置')" class="qt-retry-btn" @click="doTranslate(sourceText)">重试</button>
        </div>
        <div v-else class="qt-result">
          <span class="qt-result-text">{{ translatedText }}</span>
          <button class="qt-copy-btn" @click="copyText" title="复制">复制</button>
        </div>
      </div>
    </div>
  </div>
</template>
