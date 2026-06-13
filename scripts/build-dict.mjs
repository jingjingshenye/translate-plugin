import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

console.log('Reading ECDICT CSV...')
const csv = readFileSync(resolve(rootDir, 'ecdict.csv'), 'utf-8')
const lines = csv.split('\n')
console.log(`Total entries: ${lines.length - 1}`)

// 解析 CSV 行（处理带引号的字段）
function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// 收集所有词条，按词频排序
const entries = []
for (let i = 1; i < lines.length; i++) {
  const line = lines[i]
  if (!line.trim()) continue
  
  const fields = parseCSVLine(line)
  const word = fields[0]?.trim()
  const phonetic = fields[1]?.trim() || ''
  const translation = fields[3]?.trim() || ''
  const pos = fields[4]?.trim() || ''
  const collins = parseInt(fields[5]) || 0
  const oxford = parseInt(fields[6]) || 0
  const tag = fields[7]?.trim() || ''
  const bnc = parseInt(fields[8]) || 0
  const frq = parseInt(fields[9]) || 0
  const exchange = fields[10]?.trim() || ''

  if (!word || !translation) continue

  // 计算重要度分数（越大越重要）
  const score = collins * 10000 + (bnc > 0 ? 200000 - bnc : 0) + (frq > 0 ? 200000 - frq : 0)

  entries.push({ word, phonetic, translation, pos, collins, oxford, tag, bnc, frq, exchange, score })
}

// 按重要度排序
entries.sort((a, b) => b.score - a.score)

// 取前 15000 个（约 1.5MB）
const topEntries = entries.slice(0, 15000)
console.log(`Selected top ${topEntries.length} entries`)

// 生成词典 JSON（词形映射直接嵌入，不单独文件）
const dict = {}
for (const e of topEntries) {
  const key = e.word.toLowerCase()
  const entry = {}
  if (e.phonetic) entry.p = e.phonetic
  if (e.pos) entry.pos = e.pos
  entry.t = e.translation
  if (e.exchange) entry.e = e.exchange
  if (e.collins > 0) entry.c = e.collins
  if (e.tag) entry.tag = e.tag
  dict[key] = entry
}

// 从 exchange 字段构建词形→原形映射，直接写入 dict
let lemmaCount = 0
for (const [word, entry] of Object.entries(dict)) {
  if (!entry.e) continue
  for (const part of entry.e.split('/')) {
    const [type, form] = part.split(':')
    if (!form || form.length < 2) continue
    const formKey = form.toLowerCase()
    if (formKey !== word && !dict[formKey]) {
      // 用 `l` 字段指向原形词（不占额外 key）
      dict[formKey] = { l: word }
      lemmaCount++
    }
  }
}

console.log(`Lemma forms embedded: ${lemmaCount}`)

// 输出
const outDir = resolve(rootDir, 'extension', 'dict')
mkdirSync(outDir, { recursive: true })
const dictPath = resolve(outDir, 'dict.json')
const json = JSON.stringify(dict)
writeFileSync(dictPath, json, 'utf-8')
console.log(`dict.json: ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)}MB, ${Object.keys(dict).length} entries (${Object.keys(dict).length - lemmaCount} words + ${lemmaCount} forms)`)
