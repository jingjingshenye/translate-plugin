import { collectTextBlocks, collectForceBlock, unmarkAllObserved, resetBlockId, type TextBlock } from './walker'
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
let progress = { total: 0, done: 0, failed: 0, fallback: 0 }
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
const pendingRescanRoots = new Set<Element>()
let pendingFullScan = false
const RESCAN_MAX_ROOTS = 40

function noteRescanRoot(el: Element | null): void {
  if (!el) return
  // 变更根过多（页面大改版）时退化为整页扫描，避免收集遗漏
  if (pendingRescanRoots.size >= RESCAN_MAX_ROOTS) {
    pendingFullScan = true
    pendingRescanRoots.clear()
    return
  }
  pendingRescanRoots.add(el)
}
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

// 轮询只在会话进行中有意义（idle 时路由变化无需处理），避免每个 frame 常驻定时器
let routeTimer: ReturnType<typeof setInterval> | null = null
function startRouteWatch(): void {
  if (routeTimer) return
  routeTimer = setInterval(checkRoute, 1000)
}
function stopRouteWatch(): void {
  if (routeTimer) { clearInterval(routeTimer); routeTimer = null }
}

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

function createPanel(): HTMLElement | null {
  removePanel()
  // 个别页面在生命周期边缘会出现 body 为空的瞬间，直接 appendChild 会抛未捕获异常
  if (!document.body) return null
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
      <div class="qt-ctrl-info">${progress.done}段${progress.failed > 0 ? ` <span class="qt-ctrl-fail">${progress.failed}失败</span>` : ''}${progress.fallback > 0 ? ` · 备用${progress.fallback}` : ''}</div>
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
  stopRouteWatch()
  observer?.disconnect()
  observer = null
  removeAllTranslations()
  unmarkAllObserved()
  state = 'idle'
  progress = { total: 0, done: 0, failed: 0, fallback: 0 }
  progressMessage = ''
  waitingForContent = false
  translateAll = false
  failedIds.clear()
  pendingRescanRoots.clear()
  pendingFullScan = false
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
  progress = { total: 0, done: 0, failed: 0, fallback: 0 }
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
          noteRescanRoot(n.nodeType === Node.ELEMENT_NODE ? (n as Element) : (n as Text).parentElement)
          break
        }
      } else if (m.type === 'attributes') {
        // SSR 页面常是"内容早已在 DOM、靠 class/style 翻转可见性"（水合），
        // 只监听 childList 会漏掉这种可见性变化
        if (!(m.target instanceof Element) || m.target.closest(OWN_NODES_SELECTOR)) continue
        noteRescanRoot(m.target)
        meaningful = true
        break
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement
        if (!p || p.closest(OWN_NODES_SELECTOR)) continue
        noteRescanRoot(p)
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

  const runScan = () => {
    if (state === 'idle' || !domObserver) return
    applyRescan()
  }
  // 避开页面自身的任务高峰
  if ('requestIdleCallback' in window) requestIdleCallback(runScan, { timeout: 1500 })
  else runScan()
}

function applyRescan() {
  if (state === 'idle') return
  // 增量优先：只扫本轮变更的子树；根过多/全页级变化时退化为整页扫描
  const roots = pendingFullScan ? undefined : [...pendingRescanRoots]
  pendingRescanRoots.clear()
  pendingFullScan = false
  if (!roots || roots.length === 0) return

  // walker 的 shouldSkip 会跳过已带 OBSERVE/SOURCE 标记的旧块，这里只会拿到新内容
  const blocks = collectTextBlocks(excludeSelectors, roots)
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
        if (result.viaFallback) progress.fallback++
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
  progress = { total: 0, done: 0, failed: 0, fallback: 0 }
  apiNameCache = getMeta(payload.api).name
  apiConfig = { api: payload.api, apiKey: payload.apiKey, customConfig: payload.customConfig }
  targetLang = payload.to || 'zh'
  // 会话标识：取消时 background 据此 abort 在途请求
  sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  resetBlockId()
  if (!createPanel()) { exitIdle(); return }
  resetBlockId()
  // 先于收集启动：触发时页面还没有内容（SPA 流式水合）时靠它等待首波内容；
  // 正常会话中则负责翻译开始后持续补翻新增内容
  startDomObserver()
  startRouteWatch()
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

  progress = { total: allBlocks.length, done: 0, failed: 0, fallback: 0 }
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



// ============================================
// 悬停翻译（业界交互）：按住修饰键（默认 Alt）+ 鼠标滑过段落即翻译，
// 或悬停后按下快捷键。不依赖文本选择（user-select:none 可用），
// 不修改页面元素样式。修饰键状态直接读自每个鼠标事件本身
// （getModifierState），不存在键位追踪卡死问题。
// ============================================
type HoverKey = 'alt' | 'ctrl' | 'shift' | 'off'
let hoverSweep: HoverKey = 'alt'
const lastMousePos = { x: -1, y: -1 }
const HOVER_KEY_STATE: Record<Exclude<HoverKey, 'off'>, string> = { alt: 'Alt', ctrl: 'Control', shift: 'Shift' }
const HOVER_KEY_EVENT: Record<Exclude<HoverKey, 'off'>, string> = { alt: 'Alt', ctrl: 'Control', shift: 'Shift' }

function hoverKeyHeld(e: MouseEvent): boolean {
  if (hoverSweep === 'off') return false
  return e.getModifierState?.(HOVER_KEY_STATE[hoverSweep]) === true
}

function hoverBlockTarget(x: number, y: number): Element | null {
  if (typeof document.elementFromPoint !== 'function') return null
  const hit = document.elementFromPoint(x, y)
  const el = hit?.closest?.('p,h1,h2,h3,h4,h5,h6,li,dd,dt,td,th,blockquote,figcaption,summary,section,article') as Element | null
  if (!el || el.closest(OWN_NODES_SELECTOR)) return null
  if (el.closest('input,textarea,select,[contenteditable="true"]')) return null
  return el
}

async function hoverTranslate(el: Element): Promise<void> {
  const block = collectForceBlock(el)
  if (!block) return // 已翻译过（带标记）或无有效文本：静默
  markSourceBlock(block.id, block.element)
  const api = lastPayload?.api || 'microsoft'
  const to = targetLang
  try {
    const res = await new Promise<{ results: (any | null)[] }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 60000)
      chrome.runtime.sendMessage({
        type: 'qt-batch-translate',
        payload: { texts: [block.text], from: 'auto', to, api, apiKey: lastPayload?.apiKey, customConfig: lastPayload?.customConfig, sessionId },
      }).then(r => { clearTimeout(timeout); resolve(r) }).catch(reject)
    })
    const text = res?.results?.[0]?.text
    if (text) injectTranslation(block.id, text, mode, false)
  } catch { /* 网络失败静默；再次滑过可重试 */ }
}

let lastHoverHandled = 0
function onMouseMoveHover(e: MouseEvent): void {
  // 恒记录光标位置（悬停后按快捷键的场景要用），开销为两次赋值
  lastMousePos.x = e.clientX
  lastMousePos.y = e.clientY
  if (hoverSweep === 'off') return
  if (!hoverKeyHeld(e)) return
  // 高回报率鼠标一秒可触发上千次 mousemove，命中测试限频到 ≤25 次/秒
  const now = performance.now()
  if (now - lastHoverHandled < 40) return
  lastHoverHandled = now
  const sel = getSelection()
  if (sel && !sel.isCollapsed) return // 拖选文字过程中不触发
  const el = hoverBlockTarget(e.clientX, e.clientY)
  if (el) void hoverTranslate(el) // 已翻译过的元素由 collectForceBlock 返回 null 跳过
}

// 悬停后按快捷键（鼠标不动）：对光标下的段落立即翻译
function onKeyDownHover(e: KeyboardEvent): void {
  if (hoverSweep === 'off') return
  if (e.key !== HOVER_KEY_EVENT[hoverSweep]) return
  const sel = getSelection()
  if (sel && !sel.isCollapsed) return
  const el = hoverBlockTarget(lastMousePos.x, lastMousePos.y)
  if (el) void hoverTranslate(el)
}

window.addEventListener('mousemove', onMouseMoveHover, true)
window.addEventListener('keydown', onKeyDownHover, true)

chrome.storage.local.get('qt_hover_sweep').then(v => {
  const val: unknown = v.qt_hover_sweep
  hoverSweep = (['alt', 'ctrl', 'shift', 'off'] as string[]).includes(val as string) ? val as HoverKey : 'alt'
}).catch(() => {})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.qt_hover_sweep) {
    const v: unknown = changes.qt_hover_sweep.newValue
    hoverSweep = (['alt', 'ctrl', 'shift', 'off'] as string[]).includes(v as string) ? v as HoverKey : 'alt'
  }
})
