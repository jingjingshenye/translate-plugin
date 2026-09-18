import { collectTextBlocks, unmarkAllObserved, resetBlockId, type TextBlock } from './walker'
import { injectTranslation, markSourceBlock, removeAllTranslations, toggleOriginal, setTranslationStyle } from './injector'
import { getMeta } from '~/logic/translators-meta'
import { detectPageLang } from '~/logic/lang-utils'

type ImmersiveMode = 'bilingual' | 'translated-only'
type BlockState = 'pending' | 'queued' | 'translating' | 'done'
interface ImmersivePayload {
  api: string; apiKey?: string; customConfig?: any
  mode: ImmersiveMode; all?: boolean; to?: string
  excludeSelectors?: string[]; toggle?: boolean
  style?: 'underline' | 'dashed' | 'quote' | 'none'
}

let state: 'idle' | 'translating' | 'done' = 'idle'
let mode: ImmersiveMode = 'bilingual'
let progress = { total: 0, done: 0, failed: 0 }
let abortController: AbortController | null = null
let panelEl: HTMLElement | null = null
let apiNameCache = ''
let showOriginal = true
let excludeSelectors: string[] = []
let targetLang = 'zh'
let lastPayload: ImmersivePayload | null = null
const failedIds = new Set<number>()

let observer: IntersectionObserver | null = null
const blockStates = new Map<number, BlockState>()
const blockIndex = new Map<number, TextBlock>()
let allBlocks: TextBlock[] = []
let translateQueue: TextBlock[] = []
let processing = false
let sessionId = ''
let apiConfig: { api: string; apiKey?: string; customConfig?: any } = { api: 'microsoft' }
let translateAll = false
let progressMessage = ''

// 动态补翻：SPA（如 Next.js 流式水合）在触发翻译时往往还没有可见内容，
// 或翻译后持续懒加载新内容。常驻 MutationObserver 监听新增节点，
// 防抖后重跑收集（walker 会跳过已标记块，只拿到新内容）。
let domObserver: MutationObserver | null = null
let rescanTimer: ReturnType<typeof setTimeout> | null = null
let emptyTimer: ReturnType<typeof setTimeout> | null = null
let waitingForContent = false
let lastRescanAt = 0
const RESCAN_DEBOUNCE_MS = 1200
const RESCAN_MIN_INTERVAL_MS = 3000
const EMPTY_WAIT_MS = 15000

const PANEL_ID = 'qt-immersive-status-panel'
const BATCH_SIZE = 5
const CONCURRENCY = 3

// 本插件自己注入的节点：不作为"页面有新内容"的信号
const OWN_NODES_SELECTOR = '[data-qt],[data-qt-immersive],[data-qt-immersive-translated],[data-qt-immersive-observe],[data-qt-immersive-source]'

// SPA 路由检测：content script 的 isolated world 里包装 history.pushState
// 拦截不到页面自身的导航，改用 popstate/hashchange + 轮询兜底。
// 会话进行中路由变化 = 用户翻到了"新页面"：自动用同一配置重新收集翻译
let lastUrl = location.href
function checkRoute() {
  if (location.href === lastUrl) return
  lastUrl = location.href
  if (state === 'idle' || !lastPayload) return
  const payload = lastPayload
  cleanup()
  handleTranslate(payload)
}
window.addEventListener('popstate', checkRoute)
window.addEventListener('hashchange', checkRoute)
setInterval(checkRoute, 1000)

// all_frames 注入后每个 frame 都有本 controller：同源 iframe 的内容已由顶层
// collectTextBlocks 收集（重复翻译会出两份译文），只有跨源 iframe 需要自己翻
const isSubFrame = window.self !== window.top
const sameOriginTop = (() => {
  try { void window.top!.location.href; return true } catch { return false }
})()
if (!(isSubFrame && sameOriginTop)) {
  initMessageListeners()
  // 自动翻译本站：origin 在名单中时，页面加载即自动开始（payload 由 background 组装）
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    chrome.storage.local.get('qt_auto_sites').then(({ qt_auto_sites: sites }) => {
      if (sites && typeof sites === 'object' && (sites as Record<string, unknown>)[location.origin]) {
        chrome.runtime.sendMessage({ type: 'qt-immersive-auto' }).catch(() => {})
      }
    }).catch(() => {})
  }
}

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
    if (progress.total === 0) {
      // 空页面等待期：内容尚未渲染，等 MutationObserver 通知首波内容
      panelEl.innerHTML = `
        <div class="qt-ctrl-row"><span class="qt-ctrl-title">沉浸式翻译</span></div>
        <div class="qt-ctrl-info">${esc(progressMessage || '等待页面内容加载…')}</div>
        <button class="qt-ctrl-btn qt-ctrl-cancel" data-action="cancel">取消</button>`
    } else {
      panelEl.innerHTML = `
        <div class="qt-ctrl-row"><span class="qt-ctrl-title">沉浸式翻译</span><span class="qt-ctrl-pct">${percent}%</span></div>
        <div class="qt-ctrl-bar"><div class="qt-ctrl-fill" style="width:${percent}%"></div></div>
        <div class="qt-ctrl-info">${progress.done}/${progress.total}${progress.failed > 0 ? ` <span class="qt-ctrl-fail">${progress.failed}失败</span>` : ''}</div>
        <button class="qt-ctrl-btn qt-ctrl-cancel" data-action="cancel">取消</button>`
    }
  } else if (state === 'done') {
    const toggleText = showOriginal ? '隐藏原文' : '显示原文'
    panelEl.innerHTML = `
      <div class="qt-ctrl-row"><span class="qt-ctrl-title">沉浸式翻译</span><span class="qt-ctrl-api">${safeName}</span></div>
      <div class="qt-ctrl-info">${progress.done}段${progress.failed > 0 ? ` <span class="qt-ctrl-fail">${progress.failed}失败</span>` : ''}</div>
      <div class="qt-ctrl-btns">
        <button class="qt-ctrl-btn${mode === 'bilingual' ? ' active' : ''}" data-action="mode" data-mode="bilingual">双语</button>
        <button class="qt-ctrl-btn${mode === 'translated-only' ? ' active' : ''}" data-action="mode" data-mode="translated-only">仅译文</button>
        <button class="qt-ctrl-btn" data-action="toggle">${toggleText}</button>
        ${progress.failed > 0 ? `<button class="qt-ctrl-btn qt-ctrl-fail" data-action="retry">重试${progress.failed}失败</button>` : ''}
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
    else if (action === 'retry') retryFailed()
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
  // 通知 background abort 该会话所有在途请求
  if (sessionId) {
    chrome.runtime.sendMessage({ type: 'qt-cancel', payload: { sessionId } }).catch(() => {})
    sessionId = ''
  }
  abortController?.abort()
  abortController = null
  if (rescanTimer) { clearTimeout(rescanTimer); rescanTimer = null }
  if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null }
  stopDomObserver()
  observer?.disconnect()
  observer = null
  removeAllTranslations()
  unmarkAllObserved()
  state = 'idle'
  progress = { total: 0, done: 0, failed: 0 }
  progressMessage = ''
  waitingForContent = false
  translateAll = false
  failedIds.clear()
  showOriginal = true
  blockStates.clear()
  blockIndex.clear()
  allBlocks = []
  translateQueue = []
  processing = false
  removePanel()
}

function exitIdle(message = '') {
  state = 'idle'
  progress = { total: 0, done: 0, failed: 0 }
  progressMessage = message
  removePanel()
  unmarkAllObserved()
  reportProgress()
}

function reportProgress() {
  chrome.runtime.sendMessage({
    type: 'qt-immersive-progress',
    payload: { state, progress, showOriginal, message: progressMessage || undefined },
  }).catch(() => {})
}

// ============================================
// 动态补翻：监听页面新增节点，防抖重扫收集新块
// ============================================

function startDomObserver() {
  stopDomObserver()
  domObserver = new MutationObserver((mutations) => {
    let meaningful = false
    for (const m of mutations) {
      if (m.type === 'childList') {
        if (m.addedNodes.length === 0) continue
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if ((n as Element).closest(OWN_NODES_SELECTOR)) continue
          } else if (n.nodeType === Node.TEXT_NODE) {
            // 注入译文时会在原文后补一个空格文本节点，同样不算新内容
            const p = (n as Text).parentElement
            if (!p || p.closest(OWN_NODES_SELECTOR)) continue
          } else {
            continue
          }
          meaningful = true
          break
        }
      } else if (m.type === 'attributes') {
        // SSR 页面常是"内容早已在 DOM、靠 class/style 翻转可见性"（水合），
        // 只监听 childList 会漏掉这种可见性变化
        if (!(m.target instanceof Element) || m.target.closest(OWN_NODES_SELECTOR)) continue
        meaningful = true
        break
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement
        if (!p || p.closest(OWN_NODES_SELECTOR)) continue
        meaningful = true
        break
      }
      if (meaningful) break
    }
    if (!meaningful) return
    requestRescan()
  })
  // 挂在 documentElement 而非 body：html 元素自身的 class/style 翻转
  // （部分站点靠它控制渲染/可见性）不在 body 子树内
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
    characterData: true,
  })
}

function stopDomObserver() {
  domObserver?.disconnect()
  domObserver = null
}

// 防抖（等变化平息）+ 节流（重扫是全页遍历，限频）：至少间隔 RESCAN_MIN_INTERVAL_MS
function requestRescan() {
  if (rescanTimer) return
  const wait = Math.max(RESCAN_DEBOUNCE_MS, lastRescanAt + RESCAN_MIN_INTERVAL_MS - Date.now())
  rescanTimer = setTimeout(rescanNewBlocks, wait)
}

function rescanNewBlocks() {
  rescanTimer = null
  lastRescanAt = Date.now()
  if (state === 'idle' || !domObserver) return

  // walker 的 shouldSkip 会跳过已带 OBSERVE/SOURCE 标记的旧块，这里只会拿到新内容
  const blocks = collectTextBlocks(excludeSelectors)
  if (blocks.length === 0) return

  if (waitingForContent) {
    waitingForContent = false
    progressMessage = ''
    if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null }
  }

  for (const block of blocks) {
    markSourceBlock(block.id, block.element)
    blockStates.set(block.id, 'pending')
    blockIndex.set(block.id, block)
    allBlocks.push(block)
    block.element.setAttribute('data-qt-immersive-observe', String(block.id))
  }

  if (state === 'translating') progress.total += blocks.length

  if (observer) {
    // 懒翻模式：新块进视口才翻（IntersectionObserver 立即上报视口内的块）
    for (const block of blocks) observer.observe(block.element)
  } else if (translateAll) {
    translateQueue.push(...blocks)
    processQueue()
  } else {
    // 空页面等待期收到首波内容：此时懒翻 observer 还没建，统一建好后
    // 视口内的块会立即入队
    setupObserver()
  }
  renderPanel()
  reportProgress()
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = parseInt((entry.target as HTMLElement).dataset.qtImmersiveObserve || '-1')
      if (id >= 0 && blockStates.get(id) === 'pending') {
        blockStates.set(id, 'queued')
        const block = blockIndex.get(id)
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

  const worker = async () => {
    while (translateQueue.length > 0) {
      if (abortController?.signal.aborted) return
      const batch = translateQueue.splice(0, BATCH_SIZE)
      await translateBatch(batch)
    }
  }
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, Math.ceil(translateQueue.length / BATCH_SIZE)) },
    () => worker(),
  )
  await Promise.all(workers)

  processing = false
  checkDone()
}

async function translateBatch(batch: TextBlock[]) {
  const texts = batch.map(b => b.text)

  try {
    const res = await new Promise<{ results: (any | null)[] }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 60000)
      chrome.runtime.sendMessage({
        type: 'qt-batch-translate',
        payload: { texts, from: 'auto', to: targetLang, api: apiConfig.api, apiKey: apiConfig.apiKey, customConfig: apiConfig.customConfig, sessionId },
      }).then(r => { clearTimeout(timeout); resolve(r) }).catch(reject)
    })

    const results = res?.results || []
    for (let i = 0; i < batch.length; i++) {
      const block = batch[i]
      const result = results[i]
      if (result?.text) {
        injectTranslation(block.id, result.text, mode, block.isCode)
        failedIds.delete(block.id)
      } else {
        progress.failed++
        failedIds.add(block.id)
      }
      blockStates.set(block.id, 'done')
      progress.done++
    }
  } catch {
    for (const block of batch) {
      blockStates.set(block.id, 'done')
      progress.done++
      progress.failed++
      failedIds.add(block.id)
    }
  }
  renderPanel()
  reportProgress()
}

// 失败段重试：限流退避/网络抖动恢复后，把失败段重新入队再翻一遍
function retryFailed() {
  if (state !== 'done' || failedIds.size === 0) return
  const blocks = [...failedIds].map(id => blockIndex.get(id)).filter((b): b is TextBlock => !!b)
  failedIds.clear()
  progress.failed = 0
  progress.done = Math.max(0, progress.done - blocks.length)
  state = 'translating'
  for (const b of blocks) {
    blockStates.set(b.id, 'pending')
    translateQueue.push(b)
  }
  abortController = abortController || new AbortController()
  processQueue()
  renderPanel()
  reportProgress()
}

function checkDone() {
  if (state !== 'translating') return
  // 空页面等待期没有任何块，不能在此判定完成
  if (blockStates.size === 0) return
  for (const s of blockStates.values()) {
    if (s === 'pending' || s === 'queued' || s === 'translating') return
  }
  state = 'done'
  if (mode === 'translated-only') { showOriginal = false; toggleOriginal(false) }
  renderPanel()
  reportProgress()
}

async function handleTranslate(payload: ImmersivePayload) {
  if (state === 'translating') return

  cleanup()
  lastPayload = payload
  mode = payload.mode
  translateAll = !!payload.all
  setTranslationStyle(payload.style)
  state = 'translating'
  showOriginal = true
  progress = { total: 0, done: 0, failed: 0 }
  apiNameCache = getMeta(payload.api).name
  apiConfig = { api: payload.api, apiKey: payload.apiKey, customConfig: payload.customConfig }
  targetLang = payload.to || 'zh'
  // 会话标识：取消时 background 据此 abort 在途请求
  sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  resetBlockId()
  createPanel()
  // 先于收集启动：触发时页面还没有内容（SPA 流式水合）时靠它等待首波内容；
  // 正常会话中则负责翻译开始后持续补翻新增内容
  startDomObserver()
  reportProgress()

  allBlocks = collectTextBlocks(excludeSelectors)
  if (allBlocks.length === 0) {
    // 页面可能仍在渲染：保持翻译态等待首波内容，超时才报"未找到"
    waitingForContent = true
    progressMessage = '等待页面内容加载…'
    emptyTimer = setTimeout(() => {
      emptyTimer = null
      if (state !== 'translating' || blockIndex.size > 0) return
      exitIdle('未找到可翻译内容：页面可能尚未加载完成，稍后可重试')
    }, EMPTY_WAIT_MS)
    renderPanel()
    reportProgress()
    return
  }

  // 页面主语言即目标语言时无需翻译（如中文页面译中文）；
  // 用 chrome.i18n 的 CLD 检测（准确），失败回退脚本字符启发式
  const sample = allBlocks.slice(0, 30).map(b => b.text).join(' ').slice(0, 3000)
  if (await detectPageLang(sample) === targetLang) {
    exitIdle('页面语言与目标语言相同，无需翻译')
    return
  }

  progress = { total: allBlocks.length, done: 0, failed: 0 }
  blockIndex.clear()
  for (const block of allBlocks) {
    markSourceBlock(block.id, block.element)
    blockStates.set(block.id, 'pending')
    blockIndex.set(block.id, block)
    block.element.setAttribute('data-qt-immersive-observe', String(block.id))
  }

  abortController = new AbortController()

  if (translateAll) {
    translateQueue = allBlocks.slice()
    processQueue()
  } else {
    setupObserver()
  }
}

function initMessageListeners() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'qt-immersive-translate') {
      excludeSelectors = msg.payload.excludeSelectors || []
      // toggle：快捷键触发，会话进行中 = 再次按下 = 取消
      if (msg.payload.toggle && state !== 'idle') {
        cleanup()
        reportProgress()
        return
      }
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
}


