<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { translateWithFallback, detectLang, getTargetLang, ALL_TRANSLATORS, FREE_TRANSLATORS, AI_TRANSLATORS } from '~/logic/translate'
import { isValidWord, lookupDict, localDict, bingDict, type DictResult } from '~/logic/dict'

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
    const r = await chrome.storage.local.get(['qt_api', 'qt_api_keys', 'qt_custom_api'])
    if (r.qt_api) currentApi.value = r.qt_api
    if (r.qt_api_keys) apiKeys.value = r.qt_api_keys
    if (r.qt_custom_api) customApi.value = r.qt_custom_api
  } catch (e) { console.warn('[QT] loadSettings:', e) }
}
loadSettings()

chrome.storage.onChanged.addListener((changes) => {
  if (changes.qt_api) currentApi.value = changes.qt_api.newValue
  if (changes.qt_api_keys) apiKeys.value = changes.qt_api_keys.newValue
  if (changes.qt_custom_api) customApi.value = changes.qt_custom_api.newValue
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translate-text' && msg.text) {
    sourceText.value = msg.text
    selectionRect = null
    popupPos.value = { x: window.innerWidth - 360, y: 20 }
    doTranslate(msg.text)
  }
})

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

function onIconClick(e: MouseEvent) {
  e.stopPropagation()
  if (!sourceText.value) return

  const popupW = 340
  let px = 8, py = 8

  if (selectionRect) {
    px = Math.max(8, Math.min(selectionRect.left, window.innerWidth - popupW - 8))
    const below = window.innerHeight - selectionRect.bottom
    const above = selectionRect.top
    if (below >= 200 || below >= above) {
      py = Math.min(selectionRect.bottom + 2, window.innerHeight - 370)
    } else {
      py = Math.max(8, selectionRect.top - 362)
    }
  }

  popupPos.value = { x: px, y: py }
  doTranslate(sourceText.value)
}

function onIconMouseEnter() {
  if (sourceText.value && !isOpen.value) {
    hoverTimer = setTimeout(() => {
      const popupW = 340
      let px = 8, py = 8
      if (selectionRect) {
        px = Math.max(8, Math.min(selectionRect.left, window.innerWidth - popupW - 8))
        const below = window.innerHeight - selectionRect.bottom
        const above = selectionRect.top
        if (below >= 200 || below >= above) {
          py = Math.min(selectionRect.bottom + 2, window.innerHeight - 370)
        } else {
          py = Math.max(8, selectionRect.top - 362)
        }
      }
      popupPos.value = { x: px, y: py }
      doTranslate(sourceText.value)
    }, 300)
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
    const r = await chrome.storage.local.get('qt_words')
    isFaved.value = !!(r.qt_words && r.qt_words[word])
  } catch { isFaved.value = false }
}
async function toggleFav() {
  if (!sourceText.value) return
  try {
    const r = await chrome.storage.local.get('qt_words')
    const w = r.qt_words ? { ...r.qt_words } : {}
    if (w[sourceText.value]) { delete w[sourceText.value]; isFaved.value = false }
    else { w[sourceText.value] = { createdAt: Date.now(), translation: translatedText.value }; isFaved.value = true }
    await chrome.storage.local.set({ qt_words: w })
  } catch {}
}

function copyText() { navigator.clipboard.writeText(translatedText.value) }

function onDocMousedown(e: MouseEvent) {
  if (!isOpen.value) return
  const t = e.target as Element
  if (!t?.closest?.('[data-qt-popup]') && !t?.closest?.('[data-qt-icon]')) closePopup()
}

document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onDocMousedown)
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') closePopup() }
document.addEventListener('keydown', onKeydown)

onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('mousedown', onDocMousedown)
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
