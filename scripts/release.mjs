// 一键发版：构建 + 打包 extension/ 为 zip（版本号取自 package.json）
import { createWriteStream, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import archiver from 'archiver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version

// 词典与产物必须存在（词典不入库，需先 npm run dict）
if (!existsSync(resolve(root, 'extension/dict/dict.json'))) {
  console.error('Missing extension/dict/dict.json — run `npm run dict` first (requires ecdict.csv)')
  process.exit(1)
}

console.log(`Building Quick Translate v${version}...`)
execSync('npm run build', { cwd: root, stdio: 'inherit' })

const out = resolve(root, `quick-translate-v${version}.zip`)
const output = createWriteStream(out)
const archive = archiver('zip', { zlib: { level: 9 } })

output.on('close', () => {
  console.log(`Created ${out} (${(archive.pointer() / 1024).toFixed(0)} KB)`)
  console.log('Install: 解压 zip → chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择解压出的 extension 文件夹；已加载过的点扩展卡片上的「重新加载」图标')
})
archive.on('error', (err) => { console.error(err); process.exit(1) })

archive.pipe(output)
archive.directory(resolve(root, 'extension'), false)
await archive.finalize()
