import { collectTextBlocks, unmarkAllObserved, resetBlockId, type TextBlock } from './walker'
import { translateBlocks, type ImmersiveProgress } from './translator'
import { injectTranslation, markSourceBlock, removeAllTranslations, toggleOriginal } from './injector'
import { getMeta } from '~/logic/translators-meta'

type ImmersiveMode = 'bilingual' | 'translated-only'
type BlockState = 'pending' | 'queued' | 'translating' | 'done'

let state: 'idle' | 'translating' | 'done' = 'idle'
let mode: ImmersiveMode = 'bilingual'
let progress: ImmersiveProgress = { total: 0, done: 0, failed: 0 }
let abortController: AbortController | null = null
let panelEl: HTMLElement | null = null
let apiNameCache = ''
let showOriginal = true
let excludeSelectors: string[] = []

let observer: IntersectionObserver | null = null
const blockStates = new Map<number, BlockState>()
let allBlocks: TextBlock[] = []
let translateQueue: TextBlock[] = []
let processing = false
let apiConfig: { api: string; apiKey?: string; customConfig?: any } = { api: 'microsoft' }

const PANEL_ID = 'qt-immersive-status-panel'
const BATCH_SIZE = 5

let lastUrl = location.href

function startRouteWatcher() {
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      if (state !== 'idle') cleanup()
    }
  }

  window.addEventListener('popstate', check)

  const origPush = history.pushState
  history.pushState = function (...args) {
    origPush.apply(this, args)
    check()
  }

  const origReplace = history.replaceState
  history.replaceState = function (...args) {
    origReplace.apply(this, args)
    check()
  }
}

startRouteWatcher()

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function createPanel(): HTMLElement {
  removePanel()
  const el = document.createElement('div')
  el.id = PANEL_ID
  el.setAttribute('data-qt-immersive', '')
  el.className = 'qt-immersive-ctrl'
  document.body.appendChild(el)
  panelEl = el
  return el
}

function removePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null }
  document.getElementById(PANEL_ID)?.remove()
}

function renderPanel() {
  if (!panelEl) return
  const percent = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0
  const safeName = esc(apiNameCache)

  if (state === 'translating') {
    panelEl.innerHTML = `
      <div class="qt-ctrl-row"><span class="qt-ctrl-title">沉浸式翻译</span><span class="qt-ctrl-pct">${percent}%</span></div>
      <div class="qt-ctrl-bar"><div class="qt-ctrl-fill" style="width:${percent}%"></div></div>
      <div class="qt-ctrl-info">${progress.done}/${progress.total}${progress.failed > 0 ? ` <span class="qt-ctrl-fail">${progress.failed}失败</span>` : ''}</div>
      <button class="qt-ctrl-btn qt-ctrl-cancel" data-action="cancel">取消</button>`
  } else if (state === 'done') {
    const toggleText = showOriginal ? '隐藏原文' : '显示原文'
    panelEl.innerHTML = `
      <div class="qt-ctrl-row"><span class="qt-ctrl-title">沉浸式翻译</span><span class="qt-ctrl-api">${safeName}</span></div>
      <div class="qt-ctrl-info">${progress.done}段${progress.failed > 0 ? ` <span class="qt-ctrl-fail">${progress.failed}失败</span>` : ''}</div>
      <div class="qt-ctrl-btns">
        <button class="qt-ctrl-btn${mode === 'bilingual' ? ' active' : ''}" data-action="mode" data-mode="bilingual">双语</button>
        <button class="qt-ctrl-btn${mode === 'translated-only' ? ' active' : ''}" data-action="mode" data-mode="translated-only">仅译文</button>
        <button class="qt-ctrl-btn" data-action="toggle">${toggleText}</button>
        <button class="qt-ctrl-btn qt-ctrl-clear" data-action="clear">清除</button>
      </div>`
  } else {
    removePanel()
    return
  }

  panelEl.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
    if (!btn) return
    const action = btn.dataset.action
    if (action === 'cancel' || action === 'clear') cleanup()
    else if (action === 'mode') {
      mode = btn.dataset.mode as ImmersiveMode
      if (mode === 'translated-only') { showOriginal = false; toggleOriginal(false) }
      else { showOriginal = true; toggleOriginal(true) }
      renderPanel()
    } else if (action === 'toggle') {
      showOriginal = !showOriginal
      toggleOriginal(showOriginal)
      renderPanel()
    }
  }
}

function cleanup() {
  abortController?.abort()
  abortController = null
  observer?.disconnect()
  observer = null
  removeAllTranslations()
  unmarkAllObserved()
  state = 'idle'
  progress = { total: 0, done: 0, failed: 0 }
  showOriginal = true
  blockStates.clear()
  allBlocks = []
  translateQueue = []
  processing = false
  removePanel()
}

function reportProgress() {
  chrome.runtime.sendMessage({
    type: 'qt-immersive-progress',
    payload: { state, progress, showOriginal },
  }).catch(() => {})
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = parseInt((entry.target as HTMLElement).dataset.qtImmersiveObserve || '-1')
      if (id >= 0 && blockStates.get(id) === 'pending') {
        blockStates.set(id, 'queued')
        const block = allBlocks.find(b => b.id === id)
        if (block) translateQueue.push(block)
      }
    }
    if (translateQueue.length > 0 && !processing) processQueue()
  }, { rootMargin: '200px' })

  for (const block of allBlocks) {
    observer.observe(block.element)
  }
}

async function processQueue() {
  if (processing) return
  processing = true

  while (translateQueue.length > 0) {
    if (abortController?.signal.aborted) break

    const batch = translateQueue.splice(0, BATCH_SIZE)
    const texts = batch.map(b => b.text)

    try {
      const res = await new Promise<{ results: (any | null)[] }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 60000)
        chrome.runtime.sendMessage({
          type: 'qt-batch-translate',
          payload: { texts, from: 'auto', to: 'zh', api: apiConfig.api, apiKey: apiConfig.apiKey, customConfig: apiConfig.customConfig },
        }).then(r => { clearTimeout(timeout); resolve(r) }).catch(reject)
      })

      const results = res?.results || []
      for (let i = 0; i < batch.length; i++) {
        const block = batch[i]
        const result = results[i]
        if (result?.text) {
          injectTranslation(block.id, result.text, mode, block.isCode)
        } else {
          progress.failed++
        }
        blockStates.set(block.id, 'done')
        progress.done++
      }
      renderPanel()
      reportProgress()
    } catch {
      for (const block of batch) {
        blockStates.set(block.id, 'done')
        progress.done++
        progress.failed++
      }
      renderPanel()
      reportProgress()
    }
  }

  processing = false
  checkDone()
}

function checkDone() {
  if (state !== 'translating') return
  for (const s of blockStates.values()) {
    if (s === 'pending' || s === 'queued' || s === 'translating') return
  }
  state = 'done'
  if (mode === 'translated-only') { showOriginal = false; toggleOriginal(false) }
  renderPanel()
  reportProgress()
}

async function handleTranslate(payload: { api: string; apiKey?: string; customConfig?: any; mode: ImmersiveMode; all?: boolean }) {
  if (state === 'translating') return

  cleanup()
  mode = payload.mode
  state = 'translating'
  showOriginal = true
  progress = { total: 0, done: 0, failed: 0 }
  apiNameCache = getMeta(payload.api).name
  apiConfig = { api: payload.api, apiKey: payload.apiKey, customConfig: payload.customConfig }
  resetBlockId()
  createPanel()
  reportProgress()

  allBlocks = collectTextBlocks(excludeSelectors)
  if (allBlocks.length === 0) {
    state = 'idle'
    removePanel()
    reportProgress()
    return
  }

  progress = { total: allBlocks.length, done: 0, failed: 0 }
  for (const block of allBlocks) {
    markSourceBlock(block.id, block.element)
    blockStates.set(block.id, 'pending')
    block.element.setAttribute('data-qt-immersive-observe', String(block.id))
  }

  abortController = new AbortController()

  if (payload.all) {
    translateQueue = allBlocks.slice()
    processQueue()
  } else {
    setupObserver()
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'qt-immersive-translate') {
    excludeSelectors = msg.payload.excludeSelectors || []
    handleTranslate(msg.payload)
    return
  }
  if (msg.type === 'qt-immersive-cancel') {
    cleanup()
    reportProgress()
    return
  }
  if (msg.type === 'qt-immersive-status') {
    reportProgress()
  }
})
