import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, 'src')
const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version

export default defineConfig({
  root: rootDir,
  base: '/dist/',
  resolve: {
    alias: { '~/': rootDir + '/' },
  },
  define: {
    __VERSION__: JSON.stringify(version),
  },
  plugins: [Vue()],
  build: {
    outDir: resolve(__dirname, 'extension/dist'),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(rootDir, 'popup/index.html'),
        options: resolve(rootDir, 'options/index.html'),
      },
    },
  },
})
