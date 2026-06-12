import { execSync } from 'child_process'
import fs from 'fs-extra'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const r = (...args: string[]) => resolve(__dirname, '..', ...args)
const isDev = process.env.NODE_ENV !== 'production'

function writeManifest() {
  execSync('npx esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

writeManifest()

if (isDev) {
  const views = ['options', 'popup']
  for (const view of views) {
    fs.ensureDirSync(r(`extension/dist/${view}`))
    let data = fs.readFileSync(r(`src/${view}/index.html`), 'utf-8')
    data = data.replace('"./main.ts"', '"http://localhost:3303/' + view + '/main.ts"')
    fs.writeFileSync(r(`extension/dist/${view}/index.html`), data, 'utf-8')
    console.log(`PRE stub ${view}`)
  }
}
