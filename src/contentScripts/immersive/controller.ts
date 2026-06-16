import { collectTextBlocks, resetBlockId } from './walker'
import { translateBlocks, type ImmersiveProgress } from './translator'
import { injectTranslation, markSourceBlock, removeAllTranslations, toggleOriginal } from './injector'
import { getMeta } from '~/logic/translators-meta'

type ImmersiveMode = 'bilingual' | 'translated-only'

let state: 'idle' | 'translating' | 'done' = 'idle'
let mode: ImmersiveMode = 'bilingual'
let progress: ImmersiveProgress = { total: 0, done: 0, failed: 0 }
let abortController: AbortController | null = null
let panelEl: HTMLElement | null = null
let apiNameCache = ''
let showOriginal = true

const PANEL_ID = 'qt-immersive-status-panel'

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
  removeAllTranslations()
  state = 'idle'
  progress = { total: 0, done: 0, failed: 0 }
  showOriginal = true
  removePanel()
}

function reportProgress() {
  chrome.runtime.sendMessage({
    type: 'qt-immersive-progress',
    payload: { state, progress, showOriginal },
  }).catch(() => {})
}

async function handleTranslate(payload: { api: string; apiKey?: string; customConfig?: any; mode: ImmersiveMode }) {
  if (state === 'translating') return

  cleanup()
  mode = payload.mode
  state = 'translating'
  showOriginal = true
  progress = { total: 0, done: 0, failed: 0 }
  apiNameCache = getMeta(payload.api).name
  resetBlockId()
  createPanel()
  reportProgress()

  const collected = collectTextBlocks()
  if (collected.length === 0) {
    state = 'idle'
    removePanel()
    reportProgress()
    return
  }

  progress = { total: collected.length, done: 0, failed: 0 }
  for (const block of collected) markSourceBlock(block.id, block.element)

  abortController = new AbortController()

  try {
    await translateBlocks(collected, {
      from: 'auto', to: 'zh',
      api: payload.api,
      apiKey: payload.apiKey,
      customConfig: payload.customConfig,
      onTranslated(blockId, text, isCode) {
        injectTranslation(blockId, text, mode, isCode)
      },
      onProgress(p) { progress = p; renderPanel(); reportProgress() },
      signal: abortController.signal,
    })

    if (!abortController?.signal.aborted) {
      state = 'done'
      if (mode === 'translated-only') { showOriginal = false; toggleOriginal(false) }
      renderPanel()
    }
  } catch {
    cleanup()
  } finally {
    abortController = null
    reportProgress()
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'qt-immersive-translate') {
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
