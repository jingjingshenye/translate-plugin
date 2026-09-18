import fs from 'fs-extra'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const r = (...args: string[]) => resolve(__dirname, '..', ...args)
const isDev = process.env.NODE_ENV !== 'production'
const version = JSON.parse(fs.readFileSync(r('package.json'), 'utf-8')).version

async function main() {
  const manifest = {
    manifest_version: 3,
    name: 'Quick Translate',
    version,
    description: '划词翻译 + 弹窗翻译 + 沉浸式翻译浏览器插件',
    action: {
      default_icon: 'icons/icon128.png',
      default_popup: 'dist/popup/index.html',
    },
    options_ui: {
      page: 'dist/options/index.html',
      open_in_tab: true,
    },
    background: {
      service_worker: 'dist/background/index.mjs',
      type: 'module',
    },
    icons: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    permissions: ['storage', 'contextMenus', 'offscreen'],
    host_permissions: ['<all_urls>'],
    commands: {
      'qt-translate-page': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: '全文翻译 / 取消翻译（快捷键切换）',
      },
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['dist/contentScripts/index.global.js'],
        run_at: 'document_end',
        // 注入所有 frame：iframe 内划词时 mouseup 不会冒泡到父文档，
        // 只有 iframe 自己的 content script 能显示翻译 icon
        all_frames: true,
        match_about_blank: true,
      },
    ],
    // 划词 UI 按需动态加载（bootstrap 分包），需对页面可见
    web_accessible_resources: [
      { resources: ['dist/contentScripts/ui.js'], matches: ['<all_urls>'] },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  }
  await fs.writeJSON(r('extension/manifest.json'), manifest, { spaces: 2 })
  console.log('Manifest generated')
}

main()
