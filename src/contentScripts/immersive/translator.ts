import type { TextBlock } from './walker'
import type { TranslateResult } from '~/logic/translate'

export type ImmersiveProgress = {
  total: number
  done: number
  failed: number
}

export type ImmersiveTranslateCallback = (blockId: number, translatedText: string, isCode: boolean) => void
export type ImmersiveProgressCallback = (progress: ImmersiveProgress) => void

const BATCH_SIZE = 5
const CONCURRENCY = 3

function sendBatchTranslate(
  texts: string[],
  from: string,
  to: string,
  api: string,
  apiKey?: string,
  customConfig?: { url: string; key?: string; model?: string; prompt?: string },
): Promise<{ results: (TranslateResult | null)[] }> {
  return chrome.runtime.sendMessage({
    type: 'qt-batch-translate',
    payload: { texts, from, to, api, apiKey, customConfig },
  })
}

export async function translateBlocks(
  blocks: TextBlock[],
  options: {
    from: string
    to: string
    api: string
    apiKey?: string
    customConfig?: { url: string; key?: string; model?: string; prompt?: string }
    onTranslated: ImmersiveTranslateCallback
    onProgress: ImmersiveProgressCallback
    signal?: AbortSignal
  },
): Promise<void> {
  const { from, to, api, apiKey, customConfig, onTranslated, onProgress, signal } = options

  const batches: TextBlock[][] = []
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    batches.push(blocks.slice(i, i + BATCH_SIZE))
  }

  const progress: ImmersiveProgress = { total: blocks.length, done: 0, failed: 0 }
  const queue = batches.slice()
  let aborted = false

  signal?.addEventListener('abort', () => { aborted = true })

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      if (aborted) return

      const batch = queue.shift()!
      const texts = batch.map(b => b.text)

      try {
        const res = await sendBatchTranslate(texts, from, to, api, apiKey, customConfig)
        if (aborted) return
        const results = res?.results || []

        for (let i = 0; i < batch.length; i++) {
          if (aborted) return
          const block = batch[i]
          const result = results[i]
          if (result?.text) {
            onTranslated(block.id, result.text, block.isCode)
          } else {
            progress.failed++
          }
          progress.done++
          onProgress({ ...progress })
        }
      } catch {
        for (const block of batch) {
          progress.done++
          progress.failed++
        }
        if (!aborted) onProgress({ ...progress })
      }
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(CONCURRENCY, batches.length); i++) {
    workers.push(processNext())
  }
  await Promise.all(workers)
}
