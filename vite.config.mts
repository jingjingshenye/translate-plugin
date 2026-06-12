import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, 'src')

export default defineConfig({
  root: rootDir,
  base: '/dist/',
  resolve: {
    alias: { '~/': rootDir + '/' },
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
