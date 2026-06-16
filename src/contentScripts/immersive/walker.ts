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

const PLAIN_LANG_CODES = new Set([
  'text', 'plain', 'plaintext', 'txt', 'none', 'null', 'plain-text',
  'markdown', 'md', 'mdx', 'rst', 'asciidoc', 'asc',
  'csv', 'log', 'diff',
])

const OBSERVE_ATTR = 'data-qt-immersive-observe'

const BUILTIN_EXCLUDES = [
  '[data-qt]', '[data-qt-immersive]',
  'nav', 'header', 'footer',
  '.sidebar', '.side-bar', '#sidebar',
  '.ad', '.ads', '.advert', '[class*="ad-"]', '[class*="ads-"]',
  '[id*="google_ads"]', '[id*="carbonads"]',
  '.comments', '#comments', '.comment-section',
  '.related-posts', '.recommended',
  '.social-share', '.share-buttons',
  '.newsletter', '.subscribe-form',
  '.cookie-banner', '.cookie-consent',
  '.popup-overlay', '.modal-overlay',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[aria-hidden="true"]',
]

function getCodeLanguage(el: Element): string | null {
  const codeEl = el.tagName === 'CODE' ? el : el.querySelector('code')
  const target = codeEl || el

  const dataLang = target.getAttribute('data-lang') || target.getAttribute('data-language')
  if (dataLang) return dataLang.toLowerCase()

  const classes = target.className
  if (typeof classes === 'string') {
    const match = classes.match(/(?:highlight-source-|language-|lang-|hljs-?)(\w[\w+#-]*)/i)
    if (match) return match[1].toLowerCase()
    if (/\bhljs\b/.test(classes)) return 'unknown'
  }

  return null
}

function isCodeBlockLanguage(el: Element): 'programming' | 'plain' | 'none' {
  const lang = getCodeLanguage(el)
  if (!lang) return 'none'
  if (PLAIN_LANG_CODES.has(lang)) return 'plain'
  return 'programming'
}

let blockCache = new WeakMap<Node, { el: Element; isCode: boolean } | null>()
let excludeSelectors: string[] = []

function isExcluded(el: Element): boolean {
  for (const sel of excludeSelectors) {
    try { if (el.closest(sel)) return true } catch {}
  }
  return false
}

function closestBlockAncestor(node: Node): { el: Element; isCode: boolean } | null {
  const cached = blockCache.get(node)
  if (cached !== undefined) return cached

  let el: Node | null = node.parentElement
  while (el && el instanceof Element) {
    const tag = el.tagName
    if (tag === 'PRE' || tag === 'CODE') { blockCache.set(node, { el, isCode: true }); return { el, isCode: true } }
    if (BLOCK_TAGS.has(tag)) { blockCache.set(node, { el, isCode: false }); return { el, isCode: false } }
    if (tag === 'A' || tag === 'SPAN') {
      const display = getComputedStyle(el).display
      if (display === 'block' || display === 'flex' || display === 'grid') { blockCache.set(node, { el, isCode: false }); return { el, isCode: false } }
    }
    el = el.parentNode
  }
  blockCache.set(node, null)
  return null
}

function isVisible(el: Element): boolean {
  if (el.closest('[data-qt-immersive]')) return false
  if (el.closest('[data-qt]')) return false
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function shouldSkip(el: Element): boolean {
  if (el.closest('[data-qt-immersive]')) return true
  if (el.closest('[data-qt]')) return true
  if (el.closest('[data-qt-immersive-translated]')) return true
  if (el.hasAttribute('data-qt-immersive-translated')) return true
  return false
}

function hasWords(text: string): boolean {
  return /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text)
}

function isCodeSyntax(text: string): boolean {
  const stripped = text.replace(/\s+/g, ' ').trim()
  if (!stripped) return true
  if (!/[a-zA-Z]/.test(stripped) && /^[{}\[\]();:,.<>=!&|+\-*/%^~?@#`\\'"_\s]+$/.test(stripped)) return true
  if (/^[\w.]+\s*$/.test(stripped) && stripped.length <= 3 && !/\s/.test(stripped) && /^[a-z]+$/i.test(stripped)) return false
  return false
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

    if (block.isCode) {
      const langType = isCodeBlockLanguage(block.el)
      if (langType === 'programming') continue
      if (isCodeSyntax(text)) continue
    }

    onNode(node)
  }

  const el = root instanceof Element ? root : (root as ChildNode).parentElement
  if (!el) return

  const allElements = el.querySelectorAll('*')
  for (let i = 0; i < allElements.length; i++) {
    const child = allElements[i]
    if (child.shadowRoot) {
      walkTextNodes(child.shadowRoot, onNode)
    }
  }
}

export function collectTextBlocks(userExcludeSelectors: string[] = []): TextBlock[] {
  blockCache = new WeakMap()
  excludeSelectors = [...BUILTIN_EXCLUDES, ...userExcludeSelectors]

  const blocks: TextBlock[] = []
  const seen = new Set<string>()
  const groups = new Map<Element, { text: string; node: Text; isCode: boolean }[]>()

  walkTextNodes(document.body, (node) => {
    const trimmed = node.textContent!.trim()
    if (!trimmed) return

    const block = closestBlockAncestor(node)
    if (!block) return

    if (isExcluded(block.el)) return

    const key = block.isCode ? `code:${trimmed.toLowerCase()}` : trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    let arr = groups.get(block.el)
    if (!arr) {
      arr = []
      groups.set(block.el, arr)
    }
    arr.push({ text: trimmed, node, isCode: block.isCode })
  })

  for (const [element, items] of groups) {
    const combined = items.map(i => i.text).join(' ')
    if (combined.length < 2) continue
    element.setAttribute(OBSERVE_ATTR, '')
    blocks.push({
      id: blockId++,
      text: combined,
      element,
      node: items[0].node,
      isCode: items[0].isCode,
    })
  }

  try {
    const iframes = document.querySelectorAll('iframe')
    for (let fi = 0; fi < iframes.length; fi++) {
      try {
        const doc = iframes[fi].contentDocument
        if (!doc?.body) continue
        const iframeGroups = new Map<Element, { text: string; node: Text; isCode: boolean }[]>()

        walkTextNodes(doc.body, (node) => {
          const trimmed = node.textContent!.trim()
          if (!trimmed) return

          const block = closestBlockAncestor(node)
          if (!block) return

          if (isExcluded(block.el)) return

          const key = block.isCode ? `code:${trimmed.toLowerCase()}` : trimmed.toLowerCase()
          if (seen.has(key)) return
          seen.add(key)

          let arr = iframeGroups.get(block.el)
          if (!arr) {
            arr = []
            iframeGroups.set(block.el, arr)
          }
          arr.push({ text: trimmed, node, isCode: block.isCode })
        })

        for (const [element, items] of iframeGroups) {
          const combined = items.map(i => i.text).join(' ')
          if (combined.length < 2) continue
          element.setAttribute(OBSERVE_ATTR, '')
          blocks.push({
            id: blockId++,
            text: combined,
            element,
            node: items[0].node,
            isCode: items[0].isCode,
          })
        }
      } catch {}
    }
  } catch {}

  return blocks
}

export function unmarkAllObserved() {
  document.querySelectorAll(`[${OBSERVE_ATTR}]`).forEach(el => el.removeAttribute(OBSERVE_ATTR))
}

export function resetBlockId() {
  blockId = 0
}
