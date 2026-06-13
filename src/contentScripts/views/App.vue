<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { translateWithFallback, detectLang, getTargetLang, ALL_TRANSLATORS } from '~/logic/translate'
import { isValidWord, isSingleChineseChar, lookupDict, localDict, bingDict, type DictResult } from '~/logic/dict'

// ============================================
// 状态
// ============================================
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
const dictMode = ref<string>('local')
const usedApi = ref('')
const showLangMenu = ref(false)
const transFrom = ref('auto')
const transTo = ref('zh')

const langMap: Record<string, string> = {
  'auto': '自动', 'zh': '中文', 'en': 'EN', 'ja': '日本語', 'ko': '한국어',
  'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
}

// 划词翻译设置
const selEnabled = ref(true)
const selTrigger = ref('click')
const selHideBtn = ref(false)

// 输入框翻译设置
const inputEnabled = ref(false)
const inputTrigger = ref('/')

let selectionRect: DOMRect | null = null
let controller: AbortController | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null

// ============================================
// 加载设置
// ============================================
async function loadSettings() {
  try {
    const r = await chrome.storage.local.get([
      'qt_api', 'qt_api_keys', 'qt_dict_mode',
      'qt_sel_enabled', 'qt_sel_trigger', 'qt_sel_hide_btn',
      'qt_input_enabled', 'qt_input_trigger',
    ])
    if (r.qt_api) currentApi.value = r.qt_api
    if (r.qt_api_keys) apiKeys.value = r.qt_api_keys
    if (r.qt_dict_mode) dictMode.value = r.qt_dict_mode
    if (r.qt_sel_enabled !== undefined) selEnabled.value = r.qt_sel_enabled
    if (r.qt_sel_trigger) selTrigger.value = r.qt_sel_trigger
    if (r.qt_sel_hide_btn !== undefined) selHideBtn.value = r.qt_sel_hide_btn
    if (r.qt_input_enabled !== undefined) inputEnabled.value = r.qt_input_enabled
    if (r.qt_input_trigger !== undefined) inputTrigger.value = r.qt_input_trigger
  } catch (e) { console.warn('[QT] loadSettings:', e) }
}
loadSettings()

chrome.storage.onChanged.addListener((changes) => {
  if (changes.qt_api) currentApi.value = changes.qt_api.newValue
  if (changes.qt_api_keys) apiKeys.value = changes.qt_api_keys.newValue
  if (changes.qt_dict_mode) dictMode.value = changes.qt_dict_mode.newValue
  if (changes.qt_sel_enabled !== undefined) selEnabled.value = changes.qt_sel_enabled.newValue
  if (changes.qt_sel_trigger) selTrigger.value = changes.qt_sel_trigger.newValue
  if (changes.qt_sel_hide_btn !== undefined) selHideBtn.value = changes.qt_sel_hide_btn.newValue
  if (changes.qt_input_enabled !== undefined) inputEnabled.value = changes.qt_input_enabled.newValue
  if (changes.qt_input_trigger !== undefined) inputTrigger.value = changes.qt_input_trigger.newValue
})

// 右键菜单翻译
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translate-text' && msg.text) {
    sourceText.value = msg.text
    selectionRect = null
    popupPos.value = { x: window.innerWidth - 360, y: 20 }
    doTranslate(msg.text)
  }
})

// ============================================
// 划词翻译
// ============================================
function onMouseUp(e: MouseEvent) {
  if (!selEnabled.value) return
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

    if (selHideBtn.value) {
      if (selTrigger.value === 'select') { calculatePopupPos(); doTranslate(text) }
      return
    }

    iconPos.value = {
      x: Math.min(selectionRect.right, window.innerWidth - 28),
      y: Math.min(selectionRect.bottom, window.innerHeight - 28),
    }

    if (selTrigger.value === 'select') { calculatePopupPos(); doTranslate(text) }
  }, 100)
}

function calculatePopupPos() {
  if (!selectionRect) return
  const popupW = 340
  popupPos.value = {
    x: Math.max(8, Math.min(selectionRect.left, window.innerWidth - popupW - 8)),
    y: (() => {
      const below = window.innerHeight - selectionRect.bottom
      const above = selectionRect.top
      if (below >= 200 || below >= above) return Math.min(selectionRect.bottom + 2, window.innerHeight - 370)
      return Math.max(8, selectionRect.top - 362)
    })(),
  }
}

function onIconClick(e: MouseEvent) {
  e.stopPropagation()
  if (!sourceText.value) return
  calculatePopupPos()
  doTranslate(sourceText.value)
}

function onIconMouseEnter() {
  if (selTrigger.value === 'hover' && sourceText.value && !isOpen.value) {
    hoverTimer = setTimeout(() => { calculatePopupPos(); doTranslate(sourceText.value) }, 300)
  }
}
function onIconMouseLeave() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null } }

// ============================================
// 翻译 + 词典
// ============================================
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
  const isChineseChar = isSingleChineseChar(text)
  isWord.value = isEnglishWord || isChineseChar

  // 翻译
  const src = overrideFrom || (transFrom.value !== 'auto' ? transFrom.value : detectLang(text))
  const target = overrideTo || transTo.value || getTargetLang(src)
  // 只在自动检测时更新 transFrom 显示
  if (transFrom.value === 'auto') transFrom.value = src
  const translatePromise = translateWithFallback(text, src, target, signal, currentApi.value, apiKeys.value[currentApi.value])
    .then(result => {
      if (!signal.aborted) {
        translatedText.value = result.text
        detectedSrc.value = result.srcLang
        usedApi.value = result.api || currentApi.value
      }
    })
    .catch(err => { if (err.name !== 'AbortError') error.value = '翻译失败' })

  // 词典查询（根据 dictMode 决定策略）
  let dictPromise: Promise<void> = Promise.resolve()
  if (isEnglishWord) {
    dictLoading.value = true
    if (dictMode.value === 'local') {
      // 纯本地词典
      dictPromise = localDict(text)
        .then(local => { if (local) dictResult.value = local })
        .catch(() => {})
        .finally(() => { dictLoading.value = false })
    } else if (dictMode.value === 'online') {
      // 纯网络词典
      dictPromise = bingDict(text, signal)
        .then(result => { if (!signal.aborted && result) dictResult.value = result })
        .catch(() => {})
        .finally(() => { if (!signal.aborted) dictLoading.value = false })
    } else {
      // 混合模式：本地优先 + 异步补充网络
      dictPromise = lookupDict(text, signal)
        .then(result => { if (!signal.aborted && result) dictResult.value = result })
        .catch(() => {})
        .finally(() => { if (!signal.aborted) dictLoading.value = false })
    }
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
  if (sourceText.value) {
    doTranslate(sourceText.value, transFrom.value, transTo.value)
  }
}

// ============================================
// 收藏
// ============================================
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

// ============================================
// 输入框翻译
// ============================================
function setupInputTranslation() {
  if (!inputEnabled.value || !inputTrigger.value) return
  const handler = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!target || !('value' in target)) return
    const val = target.value
    const trigger = inputTrigger.value
    if (val.endsWith(trigger)) {
      const text = val.slice(0, -trigger.length).trim()
      if (!text) return
      const src = detectLang(text)
      const targetLang = getTargetLang(src)
      target.value = text
      target.dispatchEvent(new Event('input', { bubbles: true }))
      translateWithFallback(text, src, targetLang, undefined, currentApi.value, apiKeys.value[currentApi.value])
        .then(result => { target.value = result.text; target.dispatchEvent(new Event('input', { bubbles: true })) })
        .catch(() => {})
    }
  }
  document.addEventListener('input', handler, true)
  return () => document.removeEventListener('input', handler, true)
}
const cleanupInput = setupInputTranslation()

// ============================================
// 全局事件
// ============================================
function onDocMousedown(e: MouseEvent) {
  if (!isOpen.value) return
  const t = e.target as Element
  if (!t?.closest?.('[data-qt-popup]') && !t?.closest?.('[data-qt-icon]')) closePopup()
}
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') closePopup() }
document.addEventListener('mouseup', onMouseUp)
document.addEventListener('mousedown', onDocMousedown)
document.addEventListener('keydown', onKeydown)

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onKeydown)
  cleanupInput?.()
  if (hoverTimer) clearTimeout(hoverTimer)
})
</script>

<template>
  <div data-qt>
    <!-- 图标 -->
    <div
      v-if="selEnabled && sourceText && !isOpen && !selHideBtn"
      data-qt-icon class="qt-icon"
      :style="{ left: iconPos.x + 'px', top: iconPos.y + 'px' }"
      @mousedown.prevent @click="onIconClick"
      @mouseenter="onIconMouseEnter" @mouseleave="onIconMouseLeave"
    >译</div>

    <!-- 弹窗 -->
    <div v-if="isOpen" data-qt-popup class="qt-popup"
      :style="{ left: popupPos.x + 'px', top: popupPos.y + 'px' }"
      @mousedown.stop @mouseup.stop
    >
      <!-- 标题栏 -->
      <div class="qt-header">
        <span class="qt-title">QUICK TRANSLATE</span>
        <span class="qt-header-actions">
          <div class="qt-lang-wrap" v-if="!loading">
            <button class="qt-lang-btn" @click.stop="showLangMenu = !showLangMenu">
              {{ langMap[transFrom] || '自动' }} → {{ langMap[transTo] || '中文' }} ▾
            </button>
            <div v-if="showLangMenu" class="qt-lang-menu" @mousedown.stop>
              <div class="qt-lang-row">
                <select v-model="transFrom" class="qt-lang-sel">
                  <option value="auto">自动</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
                </select>
                <span class="qt-lang-arrow">→</span>
                <select v-model="transTo" class="qt-lang-sel">
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
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
        <!-- 原文 -->
        <div class="qt-label">原文</div>
        <div class="qt-source">{{ sourceText }}</div>

        <!-- 词典结果（单词时显示） -->
        <template v-if="isWord">
          <!-- 词典来源标签 -->
          <div class="qt-dict-tag">
            <span class="qt-dict-badge">📚 本地词典 · ECDICT</span>
          </div>

          <!-- 音标 -->
          <div v-if="dictResult?.phonetic" class="qt-phonetic">
            <span v-if="dictResult.phonetic.uk" class="qt-phonetic-item">英 [{{ dictResult.phonetic.uk }}]</span>
            <span v-if="dictResult.phonetic.us" class="qt-phonetic-item">美 [{{ dictResult.phonetic.us }}]</span>
            <a class="qt-bing-link" :href="'https://www.bing.com/dict/search?q=' + encodeURIComponent(dictResult.word)" target="_blank" @click.stop>Bing ↗</a>
          </div>

          <!-- 词典加载中 -->
          <div v-if="dictLoading" class="qt-dict-loading">
            <span class="qt-spinner"></span> 补充网络词典...
          </div>

          <!-- 基本释义 -->
          <div v-if="dictResult?.definitions?.length" class="qt-defs">
            <div v-for="(d, i) in dictResult.definitions" :key="i" class="qt-def-item">
              <span v-if="d.pos" class="qt-pos">{{ d.pos }}</span>
              <span class="qt-def">{{ d.def }}</span>
            </div>
          </div>

          <!-- 时态变形 -->
          <div v-if="dictResult?.presents?.length" class="qt-presents">
            {{ dictResult.presents.join(', ') }}
          </div>

          <!-- 英汉双解 -->
          <div v-if="dictResult?.ecs?.length" class="qt-ecs">
            <div class="qt-ecs-title">英汉双解</div>
            <div v-for="(ec, i) in dictResult.ecs" :key="i" class="qt-ecs-group">
              <div v-if="ec.pos" class="qt-ecs-pos">{{ ec.pos }}</div>
              <div v-for="(item, j) in ec.lis" :key="j" class="qt-ecs-item">{{ item }}</div>
            </div>
          </div>

          <!-- 例句 -->
          <div v-if="dictResult?.sentences?.length" class="qt-sentences">
            <div class="qt-sent-title">例句</div>
            <div v-for="(s, i) in dictResult.sentences.slice(0, 2)" :key="i" class="qt-sent-item">
              <div class="qt-sent-en">{{ s.en }}</div>
              <div class="qt-sent-zh">{{ s.zh }}</div>
            </div>
          </div>

          <!-- 分割线 -->
          <div class="qt-divider"></div>
        </template>

        <!-- 翻译结果 -->
        <div class="qt-trans-tag">
          <span class="qt-trans-badge">🌐 {{ (ALL_TRANSLATORS.find(t => t.id === usedApi)?.name || currentApi).toUpperCase() }}{{ detectedSrc ? ' · ' + detectedSrc : '' }}</span>
        </div>
        <div v-if="loading" class="qt-loading">
          <span class="qt-spinner"></span> 翻译中...
        </div>
        <div v-else-if="error" class="qt-error">{{ error }}</div>
        <div v-else class="qt-result">{{ translatedText }}</div>
      </div>
    </div>
  </div>
</template>
