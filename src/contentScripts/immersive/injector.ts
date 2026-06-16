const TRANSLATED_ATTR = 'data-qt-immersive-translated'
const SOURCE_ATTR = 'data-qt-immersive-source'
const BLOCK_ID_ATTR = 'data-qt-block-id'

const elementMap = new Map<number, Element>()
const markerMap = new Map<number, Element>()

const RESTRICTIVE_PARENTS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DT', 'DD', 'TD', 'TH', 'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'MARK', 'CODE', 'LABEL', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'LEGEND', 'BUTTON'])

export function injectTranslation(blockId: number, translatedText: string, mode: 'bilingual' | 'translated-only', isCode: boolean): void {
  const existing = markerMap.get(blockId)
  if (existing) {
    existing.textContent = translatedText
    return
  }

  const sourceEl = elementMap.get(blockId)
  if (!sourceEl) return

  if (mode === 'translated-only') {
    sourceEl.classList.add('qt-immersive-hidden')
  }

  const parentTag = sourceEl.parentElement?.tagName || ''
  const useInline = isCode || RESTRICTIVE_PARENTS.has(parentTag)

  const transEl = document.createElement(useInline ? 'span' : 'div')
  transEl.setAttribute(TRANSLATED_ATTR, '')
  transEl.setAttribute(BLOCK_ID_ATTR, String(blockId))
  transEl.className = useInline ? 'qt-immersive-trans qt-immersive-trans-code' : 'qt-immersive-trans'
  transEl.textContent = translatedText

  if (useInline) {
    sourceEl.appendChild(document.createTextNode(' '))
    sourceEl.appendChild(transEl)
  } else {
    sourceEl.parentElement?.insertBefore(transEl, sourceEl.nextSibling)
  }

  markerMap.set(blockId, transEl)
}

export function markSourceBlock(blockId: number, element: Element): void {
  element.setAttribute(SOURCE_ATTR, String(blockId))
  elementMap.set(blockId, element)
}

export function removeAllTranslations(): void {
  markerMap.forEach(el => el.remove())
  markerMap.clear()

  elementMap.forEach(el => {
    el.removeAttribute(SOURCE_ATTR)
    el.classList.remove('qt-immersive-hidden')
  })
  elementMap.clear()

  document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach(el => el.remove())
  document.querySelectorAll(`[${SOURCE_ATTR}]`).forEach(el => {
    el.removeAttribute(SOURCE_ATTR)
    el.classList.remove('qt-immersive-hidden')
  })
}

export function toggleOriginal(show: boolean): void {
  elementMap.forEach(el => {
    if (show) {
      el.classList.remove('qt-immersive-hidden')
    } else {
      el.classList.add('qt-immersive-hidden')
    }
  })
}
