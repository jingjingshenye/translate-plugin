import { isIdentifierLike } from '~/logic/identifier'

export interface TextBlock {
  id: number
  text: string
  element: Element
  node: Text
  isCode: boolean
}

let blockId = 0

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE',
  'FIGCAPTION', 'CAPTION', 'SUMMARY', 'LEGEND',
  'PRE', 'CODE', 'ARTICLE', 'SECTION', 'MAIN',
  'HEADER', 'FOOTER', 'ASIDE', 'NAV',
])

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
])

// 代码类标签：其内容整体不翻译
const CODE_TAGS = new Set(['PRE', 'CODE', 'SAMP', 'KBD', 'VAR', 'TT'])

const OBSERVE_ATTR = 'data-qt-immersive-observe'

// header/footer/nav 不再用裸标签排除（SPA 组件库常在卡片/手风琴内用语义 <header>，
// 会误杀正文），改由 isSiteChrome 做结构化判断；
// [class*="ad-"] 会命中 download-/read- 等类名，收紧为"类名 token 以 ad-/ads- 开头"；
// role="grid" 是数据网格语义（如 GitHub 目录文件列表），内容多为标识符不应翻译；
// .react-code-lines/.blob-code/.blob-wrapper 是 GitHub 代码视图容器（新旧两版）；
// CodeMirror/cm-editor/monaco-editor 是常见网页内嵌代码编辑器，渲染产物是 span 碎片；
// material-icons/material-symbols-outlined 是连字图标字体，文字被"翻译"会变乱码；
// [translate="no"] / .notranslate 是 W3C/Google 标准，主流翻译产品均尊重
const BUILTIN_EXCLUDES = [
  '[data-qt]', '[data-qt-immersive]',
  '[translate="no"]', '.notranslate',
  '.sidebar', '.side-bar', '#sidebar',
  '.ad', '.ads', '.advert',
  '[class^="ad-"]', '[class*=" ad-"]',
  '[class^="ads-"]', '[class*=" ads-"]',
  '[id*="google_ads"]', '[id*="carbonads"]',
  '.comments', '#comments', '.comment-section',
  '.related-posts', '.recommended',
  '.social-share', '.share-buttons',
  '.newsletter', '.subscribe-form',
  '.cookie-banner', '.cookie-consent',
  '.popup-overlay', '.modal-overlay',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="grid"]',
  '.react-code-lines', '.blob-code', '.blob-wrapper',
  '.CodeMirror', '.cm-editor', '.monaco-editor',
  '.material-icons', '.material-symbols-outlined',
  '[aria-hidden="true"]',
]

// 标识符/文件路径检测已提取到 ~/logic/identifier（纯函数，可单测）

// header/footer/nav 仅在页面骨架位置（不处于正文容器内）视为站点装饰；
// 正文容器内的属内容结构（如卡片、手风琴的语义 header），不排除
function isSiteChrome(el: Element): boolean {
  const h = el.closest('header, footer, nav')
  return !!h && !h.closest('main, article, section, [role="main"]')
}

// 缓存按 Element 粒度：同一元素的多个文本节点共享一次 getComputedStyle/rect 计算
let ancestorCache = new WeakMap<Element, { el: Element; isCode: boolean } | null>()
let visibleCache = new WeakMap<Element, boolean>()
let foundShadowRoots: ShadowRoot[] = []
let excludeSelectors: string[] = []

function isExcluded(el: Element): boolean {
  if (isSiteChrome(el)) return true
  for (const sel of excludeSelectors) {
    try { if (el.closest(sel)) return true } catch {}
  }
  return false
}

function findBlockAncestor(el: Element): { el: Element; isCode: boolean } | null {
  const cached = ancestorCache.get(el)
  if (cached !== undefined) return cached

  let result: { el: Element; isCode: boolean } | null = null
  const tag = el.tagName
  // 代码/终端输入/变量类标签一律不翻（与 TWP、沉浸式翻译的 code 级排除对齐）；
  // 不再依赖语言标注——绝大多数代码块没有 language class
  if (CODE_TAGS.has(tag)) result = { el, isCode: true }
  else if (BLOCK_TAGS.has(tag)) result = { el, isCode: false }
  else if (tag === 'A' || tag === 'SPAN') {
    const display = getComputedStyle(el).display
    if (display === 'block' || display === 'flex' || display === 'grid') result = { el, isCode: false }
  }
  if (!result) result = el.parentElement ? findBlockAncestor(el.parentElement) : null
  ancestorCache.set(el, result)
  return result
}

function closestBlockAncestor(node: Node): { el: Element; isCode: boolean } | null {
  const parent = node.parentElement
  return parent ? findBlockAncestor(parent) : null
}

function isVisible(el: Element): boolean {
  const cached = visibleCache.get(el)
  if (cached !== undefined) return cached

  let visible = true
  if (el.closest('[data-qt-immersive]') || el.closest('[data-qt]')) {
    visible = false
  } else {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      visible = false
    } else {
      const rect = el.getBoundingClientRect()
      visible = rect.width > 0 || rect.height > 0
    }
  }
  visibleCache.set(el, visible)
  return visible
}

// OBSERVE/SOURCE 标记说明该块已被本次会话收集过：补扫（MutationObserver 触发的
// 重收集）时跳过其子树，避免同一内容重复入队；cleanup 时两标记都会被清除
function shouldSkip(el: Element): boolean {
  if (el.closest('[data-qt-immersive]')) return true
  if (el.closest('[data-qt]')) return true
  if (el.closest('[data-qt-immersive-translated]')) return true
  if (el.closest(`[${OBSERVE_ATTR}]`)) return true
  if (el.closest('[data-qt-immersive-source]')) return true
  if (el.hasAttribute('data-qt-immersive-translated')) return true
  return false
}

function hasWords(text: string): boolean {
  return /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text)
}

function walkTextNodes(root: Node, onNode: (node: Text) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement
    if (!parent) continue
    if (shouldSkip(parent)) continue
    if (SKIP_TAGS.has(parent.tagName)) continue
    if (parent.closest('[contenteditable="true"]')) continue
    if (!isVisible(parent)) continue

    const text = node.textContent?.trim()
    if (!text || text.length < 2) continue
    if (!hasWords(text)) continue

    const block = closestBlockAncestor(node)
    if (!block) continue

    // 代码类标签的内容整体跳过（含行内 code/kbd 等）
    if (block.isCode) continue

    onNode(node)
  }

  const el = root instanceof Element ? root : (root as ChildNode).parentElement
  if (!el) return

  const allElements = el.querySelectorAll('*')
  for (let i = 0; i < allElements.length; i++) {
    const child = allElements[i]
    if (child.shadowRoot) {
      foundShadowRoots.push(child.shadowRoot)
      walkTextNodes(child.shadowRoot, onNode)
    }
  }
}

interface GroupItem { text: string; node: Text; isCode: boolean }

function collectGroups(root: Node): Map<Element, GroupItem[]> {
  const groups = new Map<Element, GroupItem[]>()
  walkTextNodes(root, (node) => {
    const trimmed = node.textContent!.trim()
    if (!trimmed) return

    const block = closestBlockAncestor(node)
    if (!block) return

    if (isExcluded(block.el)) return

    let arr = groups.get(block.el)
    if (!arr) {
      arr = []
      groups.set(block.el, arr)
    }
    arr.push({ text: trimmed, node, isCode: block.isCode })
  })
  return groups
}

function pushBlocks(groups: Map<Element, GroupItem[]>, seen: Set<string>, blocks: TextBlock[]) {
  for (const [element, items] of groups) {
    const combined = items.map(i => i.text).join(' ')
    if (combined.length < 2) continue
    if (isIdentifierLike(combined)) continue
    const key = items[0].isCode ? `code:${combined.toLowerCase()}` : combined.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    element.setAttribute(OBSERVE_ATTR, '')
    blocks.push({
      id: blockId++,
      text: combined,
      element,
      node: items[0].node,
      isCode: items[0].isCode,
    })
  }
}

export function collectTextBlocks(userExcludeSelectors: string[] = [], limitRoots?: Element[]): TextBlock[] {
  ancestorCache = new WeakMap()
  visibleCache = new WeakMap()
  foundShadowRoots = []
  excludeSelectors = [...BUILTIN_EXCLUDES, ...userExcludeSelectors]

  const blocks: TextBlock[] = []
  const seen = new Set<string>()

  // 增量模式：只扫给定子树（补扫用），不做 shadow/iframe 全局发现，开销与变更量成正比
  if (limitRoots && limitRoots.length > 0) {
    for (const root of limitRoots) pushBlocks(collectGroups(root), seen, blocks)
    return blocks
  }

  pushBlocks(collectGroups(document.body), seen, blocks)

  // iframe：主文档 + shadow DOM 内的；跨域 iframe 的 contentDocument 会抛异常，逐个 try
  const roots: ParentNode[] = [document.body, ...foundShadowRoots]
  for (const root of roots) {
    for (const iframe of root.querySelectorAll('iframe')) {
      try {
        const doc = iframe.contentDocument
        if (doc?.body) pushBlocks(collectGroups(doc.body), seen, blocks)
      } catch {}
    }
  }

  return blocks
}

export function unmarkAllObserved() {
  document.querySelectorAll(`[${OBSERVE_ATTR}]`).forEach(el => el.removeAttribute(OBSERVE_ATTR))
  // document.querySelectorAll 不会进入 shadow DOM 和 iframe，需单独清理
  for (const root of foundShadowRoots) {
    root.querySelectorAll(`[${OBSERVE_ATTR}]`).forEach(el => el.removeAttribute(OBSERVE_ATTR))
  }
  for (const iframe of document.querySelectorAll('iframe')) {
    try { iframe.contentDocument?.querySelectorAll(`[${OBSERVE_ATTR}]`).forEach(el => el.removeAttribute(OBSERVE_ATTR)) } catch {}
  }
}

export function resetBlockId() {
  blockId = 0
}

// 悬停翻译用：绕过选择行为，把元素内可见文本整体收集为一个块。
// 已翻译过的元素（带 OBSERVE/SOURCE 标记）返回 null，避免重复翻译
export function collectForceBlock(root: Element): TextBlock | null {
  ancestorCache = new WeakMap()
  visibleCache = new WeakMap()
  excludeSelectors = []

  const items: { text: string; node: Text }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement
    if (!parent) continue
    if (shouldSkip(parent)) continue
    if (SKIP_TAGS.has(parent.tagName)) continue
    if (parent.closest('[contenteditable="true"]')) continue
    if (!isVisible(parent)) continue
    const text = node.textContent?.trim()
    if (!text || text.length < 2) continue
    if (!hasWords(text)) continue
    items.push({ text, node })
  }
  const combined = items.map(i => i.text).join(' ')
  if (combined.length < 2) return null
  root.setAttribute(OBSERVE_ATTR, '')
  return { id: blockId++, text: combined, element: root, node: items[0].node, isCode: false }
}
