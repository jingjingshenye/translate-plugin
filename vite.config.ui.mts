import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, 'src')
const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version

// 划词 UI 按需分包：bootstrap（index.global.js）保持轻量不含 Vue，
// 首次划词/右键翻译时经 chrome.runtime.getURL 动态 import 本包（web_accessible_resources 已放行）
export default defineConfig({
  root: rootDir,
  resolve: {
    alias: { '~/': rootDir + '/' },
  },
  define: {
    __DEV__: 'false',
    __NAME__: '"quick-translate"',
    __VERSION__: JSON.stringify(version),
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [Vue()],
  build: {
    outDir: resolve(__dirname, 'extension/dist/contentScripts'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(rootDir, 'contentScripts/views/mount.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'ui.js',
      },
    },
  },
})
