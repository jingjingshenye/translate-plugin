import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, 'src')
const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version

// offscreen document 脚本：为 service worker 提供 DOMParser（Bing 词典 HTML 解析）
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
  build: {
    outDir: resolve(__dirname, 'extension/dist/offscreen'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(rootDir, 'offscreen/offscreen.ts'),
      name: 'quickTranslateOffscreen',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'offscreen.js',
        extend: true,
      },
    },
  },
})
