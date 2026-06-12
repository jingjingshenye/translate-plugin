import fs from 'fs-extra'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const r = (...args: string[]) => resolve(__dirname, '..', ...args)
const isDev = process.env.NODE_ENV !== 'production'

async function main() {
  const manifest = {
    manifest_version: 3,
    name: 'Quick Translate',
    version: '1.0.0',
    description: '划词翻译 + 弹窗翻译浏览器插件',
    action: {
      default_icon: 'icons/icon128.png',
      default_popup: 'dist/popup/index.html',
    },
    options_ui: {
      page: 'dist/options/index.html',
      open_in_tab: false,
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
    permissions: ['storage', 'activeTab', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['dist/contentScripts/index.global.js'],
        all_frames: true,
        run_at: 'document_end',
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  }
  await fs.writeJSON(r('extension/manifest.json'), manifest, { spaces: 2 })
  console.log('Manifest generated')
}

main()
