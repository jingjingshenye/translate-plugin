import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), 'src')

export default defineConfig({
  resolve: {
    alias: { '~/': rootDir + '/' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
