import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

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
  build: {
    outDir: resolve(__dirname, 'extension/dist/background'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(rootDir, 'background/main.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.mjs',
      },
    },
  },
})
