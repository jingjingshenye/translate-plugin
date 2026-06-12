import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, 'src')

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: { '~/': rootDir + '/' },
  },
  define: {
    __DEV__: 'false',
    __NAME__: '"quick-translate"',
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [Vue()],
  build: {
    outDir: resolve(__dirname, 'extension/dist/contentScripts'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(rootDir, 'contentScripts/index.ts'),
      name: 'quickTranslate',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.global.js',
        extend: true,
      },
    },
  },
})
