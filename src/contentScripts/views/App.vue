<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { useEncryptedKeys } from '~/composables/useEncryptedKeys'
import { useFavorites } from '~/composables/useFavorites'
import { useHistory } from '~/composables/useHistory'
import { invokeTranslate, invokeLookupDict, invokeAiTranslate, type DictMode } from '~/logic/background-api'
import { detectLang, getTargetLang } from '~/logic/lang-utils'
import { getMeta, FREE_META, isKnownApi } from '~/logic/translators-meta'
import { speak } from '~/logic/tts'
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
const fallbackUsed = ref(false)
const currentApi = useStorage<string>('qt_api', FREE_META[0].id)
// 已下线引擎（如 microsoft 免费源）的存量配置迁移
watch(currentApi, (v) => { if (v && !isKnownApi(v)) currentApi.value = FREE_META[0].id })
const apiKeys = useEncryptedKeys('qt_api_keys')
const skipLangs = useStorage<string[]>('qt_skip_langs', ['zh'])
const customApi = useStorage('qt_custom_api', { url: '', key: '', model: 'gpt-4o-mini', prompt: '' })
const dictMode = useStorage<string>('qt_dict_mode', 'both')
const isWord = ref(false)
const dictResult = ref<DictResult | null>(null)
const dictLoading = ref(false)
const usedApi = ref('')
const aiResult = ref<{ text: string; api?: string } | null>(null)
const showLangMenu = ref(false)
const transFrom = ref('auto')
const transTo = ref('zh')

// 界面展示用的语言名；划词语言选择器当前只开放这几种
const langMap: Record<string, string> = {
  'auto': '自动', 'zh': '中文', 'en': 'EN', 'ja': '日本語', 'ko': '한국어',
}

let selectionRect: DOMRect | null = null
let reqId = 0 // 防止翻译请求 race

// 右键菜单翻译入口：由 contentScripts/index.ts 转发的 window 事件（保证 App 已挂载）
window.addEventListener('qt-translate-text', ((e: CustomEvent<string>) => {
  if (e.detail) {
    sourceText.value = e.detail
    selectionRect = null
    popupPos.value = { x: window.innerWidth - 360, y: 20 }
    doTranslate(e.detail)
  }
}) as EventListener)

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
  const el = findRawInputElement(event)
  // 密码框内容不翻译（避免明文密码进入翻译请求与翻译历史）
  if (el instanceof HTMLInputElement && el.type === 'password') return null
  return el
}

function findRawInputElement(event: MouseEvent): HTMLInputElement | HTMLTextAreaElement | null {
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
    if (skipLangs.value.includes(detectLang(hit.text))) return

    selectionRect = hit.rect
    sourceText.value = hit.text
    iconPos.value = {
      x: Math.min(hit.rect.right, window.innerWidth - ICON_SIZE),
      y: Math.min(hit.rect.bottom, window.innerHeight - ICON_SIZE),
    }
  }, MOUSEUP_DELAY)
}

// selectionchange 兜底：键盘选区（Shift+方向键 / Ctrl+A）没有 mouseup；
// 部分站点在捕获阶段 stopPropagation 会拦截 mouseup，此路径不受影响。
// 拖选过程中连续触发，靠防抖取尾沿；与 mouseup 路径幂等（重复设置同一 icon）
let selChangeTimer: ReturnType<typeof setTimeout> | null = null
function onSelectionChange() {
  if (isOpen.value) return
  if (selChangeTimer) clearTimeout(selChangeTimer)
  selChangeTimer = setTimeout(() => {
    selChangeTimer = null
    if (isOpen.value) return
    // 输入框选区由 mouseup 路径处理（caret 定位需要 event target）
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
    const hit = getComposedSelection()
    if (!hit) return
    if (skipLangs.value.includes(detectLang(hit.text))) return

    selectionRect = hit.rect
    sourceText.value = hit.text
    iconPos.value = {
      x: Math.min(hit.rect.right, window.innerWidth - ICON_SIZE),
      y: Math.min(hit.rect.bottom, window.innerHeight - ICON_SIZE),
    }
  }, 300)
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

  let range: Range
  const anySel = selection as any
  if (typeof anySel.getComposedRanges === 'function') {
    // 跨 shadow DOM 的选区只有 Chrome 131+ 的 getComposedRanges 能拿到；
    // 旧内核上该方法不存在，直接调用会让所有划词失效
    const composedRanges = anySel.getComposedRanges()
    if (!composedRanges || composedRanges.length === 0) return null
    const staticRange = composedRanges[0]
    if (staticRange.collapsed) return null
    range = new Range()
    range.setStart(staticRange.startContainer, staticRange.startOffset)
    range.setEnd(staticRange.endContainer, staticRange.endOffset)
  } else {
    range = selection.getRangeAt(0)
    if (range.collapsed) return null
  }

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
// 哪个成功收藏哪个：翻译成功存译文；翻译失败但词典成功存词典释义
// ============================================
const { words: favWords, toggle: toggleFavFn } = useFavorites()
const isFaved = computed(() => !!favWords.value[sourceText.value])
const canFav = computed(() =>
  !!(translatedText.value || dictResult.value?.definitions?.length),
)
function favTranslation(): string {
  if (translatedText.value) return translatedText.value
  const defs = dictResult.value?.definitions
  return defs?.length ? defs.slice(0, 3).map(d => d.def).join('；') : ''
}
function toggleFav() {
  if (!sourceText.value || !canFav.value) return
  toggleFavFn(sourceText.value, favTranslation())
}

// ============================================
// 翻译入口（通过 background）
// ============================================
const history = useHistory()

async function doTranslate(text: string, overrideFrom?: string, overrideTo?: string) {
  isOpen.value = true
  loading.value = true
  error.value = ''
  translatedText.value = ''
  detectedSrc.value = ''
  fallbackUsed.value = false
  aiResult.value = null
  dictResult.value = null
  isWord.value = false

  const myId = ++reqId

  const isEnglishWord = isValidWord(text)
  const isChineseChar = text.length === 1 && /[一-鿿]/.test(text)
  isWord.value = isEnglishWord || isChineseChar

  const src = overrideFrom || (transFrom.value !== 'auto' ? transFrom.value : detectLang(text))
  const target = overrideTo || transTo.value || (src === 'zh' ? 'en' : 'zh')
  if (transFrom.value === 'auto') transFrom.value = src

  // AI 对照翻译：与主引擎完全独立，未配置 Key/失败时静默不显示
  invokeAiTranslate({ text, from: src, to: target })
    .then(r => { if (myId === reqId && r) aiResult.value = r })
    .catch(() => {})

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
      fallbackUsed.value = !!result.viaFallback
      history.add({ text, translation: result.text, api: usedApi.value, srcLang: result.srcLang })
    })
    .catch((e) => {
      if (myId !== reqId) return
      // 显示真实失败原因（HTTP 状态码 / 超时 / 网络不通），便于用户自查
      error.value = e instanceof Error && e.message ? e.message : '翻译失败'
    })
    .finally(() => { if (myId === reqId) loading.value = false })

  await dictPromise
}

function playAudio(url: string) {
  try { new Audio(url).play().catch(() => {}) } catch {}
}

const copied = ref(false)
async function copyText() {
  if (!translatedText.value) return
  try {
    await navigator.clipboard.writeText(translatedText.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1200)
  } catch {}
}

function speakResult() {
  if (!translatedText.value) return
  const target = transTo.value || getTargetLang((detectedSrc.value || 'EN').toLowerCase())
  speak(translatedText.value, target)
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

// mouseup 用捕获阶段：页面在更深层节点上的 stopPropagation 不影响我们；
// selectionchange 兜底覆盖键盘选区与被拦截的 mouseup
document.addEventListener('mouseup', onMouseUp, true)
document.addEventListener('selectionchange', onSelectionChange)
document.addEventListener('mousedown', onDocumentMousedown)
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') closePopup() }
document.addEventListener('keydown', onKeydown)

onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp, true)
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onKeydown)
  if (selChangeTimer) clearTimeout(selChangeTimer)
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
          <button v-if="sourceText && !loading && canFav" class="qt-fav-btn" @click="toggleFav" :title="isFaved ? '取消收藏' : '收藏'">{{ isFaved ? '♥' : '♡' }}</button>
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
          <span class="qt-trans-badge">{{ getMeta(usedApi).name.toUpperCase() }}{{ fallbackUsed ? ' · 备用' : '' }}</span>
        </div>
        <div v-if="loading" class="qt-loading"><span class="qt-spinner"></span> 翻译中...</div>
        <div v-else-if="error" class="qt-error">
          <span class="qt-error-msg">{{ error }}</span>
          <button v-if="!error.includes('设置')" class="qt-retry-btn" @click="doTranslate(sourceText)">重试</button>
        </div>
        <div v-else class="qt-result">
          <span class="qt-result-text">{{ translatedText }}</span>
          <button class="qt-copy-btn" @click="speakResult" title="朗读">🔊</button>
          <button class="qt-copy-btn" @click="copyText" title="复制">{{ copied ? '✓' : '复制' }}</button>
        </div>

        <template v-if="aiResult">
          <div class="qt-trans-tag">
            <span class="qt-trans-badge qt-ai-badge">AI 对照 · {{ aiResult.api ? getMeta(aiResult.api).name : 'AI' }}</span>
          </div>
          <div class="qt-ai-result">{{ aiResult.text }}</div>
        </template>
      </div>
    </div>
  </div>
</template>
