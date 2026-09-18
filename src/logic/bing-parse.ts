// Bing 词典 HTML 解析（纯 DOM 逻辑）
// 必须在含 DOM API 的环境执行：MV3 service worker 无 DOMParser，
// 由 offscreen document 加载本模块完成解析（见 src/offscreen/offscreen.ts）
import type { DictResult } from './dict'

export function parseBingHtml(html: string): DictResult | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const word = doc.querySelector('#headword > h1')?.textContent?.trim()
  if (!word) return null

  // 基本释义 (trs)
  const definitions: DictResult['definitions'] = []
  doc.querySelectorAll('div.qdef > ul > li').forEach(li => {
    const pos = li.querySelector('.pos')?.textContent?.trim() || ''
    const def = li.querySelector('.def')?.textContent?.trim() || ''
    if (def) definitions.push({ pos, def })
  })

  // 时态变形 (presents)
  const presents: string[] = []
  doc.querySelectorAll('div.hd_div1>.hd_if>.p1-5').forEach(li => {
    const p = li.textContent?.trim()
    if (p) presents.push(p)
  })

  // 英汉双解 (ecs)
  const ecs: DictResult['ecs'] = []
  doc.querySelectorAll('.each_seg>.li_pos').forEach(li => {
    const pos = li.querySelector('.pos_lin>.pos')?.textContent?.trim() || ''
    const lis: string[] = []
    li.querySelectorAll('.de_seg>.se_lis').forEach(l => {
      const t = l.querySelector('.de_co')?.textContent?.trim()
      if (t) lis.push(t)
    })
    if (lis.length) ecs.push({ pos, lis })
  })

  // 例句 (sentences)
  const sentences: DictResult['sentences'] = []
  doc.querySelectorAll('#sentenceSeg .se_li').forEach(li => {
    const en = li.querySelector('.sen_en')?.textContent?.trim() || ''
    const zh = li.querySelector('.sen_cn')?.textContent?.trim() || ''
    if (en && zh) sentences.push({ en, zh })
  })

  // 音标 + 音频 (aus)
  const phonetic: DictResult['phonetic'] = {}
  const audio: DictResult['audio'] = {}

  const $audioUK = doc.querySelector('#bigaud_uk') as HTMLElement
  const $audioUS = doc.querySelector('#bigaud_us') as HTMLElement

  if ($audioUK?.dataset?.mp3link) {
    audio.uk = 'https://www.bing.com' + $audioUK.dataset.mp3link
    const $phoneticUK = $audioUK.parentElement?.previousElementSibling
    const m = $phoneticUK?.textContent?.trim()?.match(/\[(.*?)\]/)
    if (m) phonetic.uk = m[1]
  }
  if ($audioUS?.dataset?.mp3link) {
    audio.us = 'https://www.bing.com' + $audioUS.dataset.mp3link
    const $phoneticUS = $audioUS.parentElement?.previousElementSibling
    const m = $phoneticUS?.textContent?.trim()?.match(/\[(.*?)\]/)
    if (m) phonetic.us = m[1]
  }

  // 备选：从纯文本音标提取
  if (!phonetic.uk) {
    const t = doc.querySelector('.hd_pr')?.textContent?.trim()
    const m = t?.match(/\[(.*?)\]/)
    if (m) phonetic.uk = m[1]
  }
  if (!phonetic.us) {
    const t = doc.querySelector('.hd_prUS')?.textContent?.trim()
    const m = t?.match(/\[(.*?)\]/)
    if (m) phonetic.us = m[1]
  }

  return { word, phonetic, definitions, sentences, presents, ecs, audio }
}
