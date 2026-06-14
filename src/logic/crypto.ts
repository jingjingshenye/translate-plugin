// AES-GCM 加密 API Keys（密钥从 storage 读取/生成）
// 使用浏览器原生 Web Crypto API（不依赖 Node 'crypto' 模块）

const ENC_KEY_NAME = 'qt_enc_key'
const subtle = globalThis.crypto?.subtle

async function getEncKey(): Promise<CryptoKey> {
  if (!subtle) throw new Error('Web Crypto API not available')
  const stored = await chrome.storage.local.get(ENC_KEY_NAME)
  if (stored[ENC_KEY_NAME]) {
    const raw = Uint8Array.from(atob(stored[ENC_KEY_NAME]), c => c.charCodeAt(0))
    return subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt'])
  }
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = await subtle.exportKey('raw', key)
  await chrome.storage.local.set({ [ENC_KEY_NAME]: btoa(String.fromCharCode(...new Uint8Array(exported))) })
  return key
}

export async function encryptValue(plain: string): Promise<string> {
  if (!plain) return ''
  const key = await getEncKey()
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const enc = await subtle!.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return btoa(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(enc)))
}

export async function decryptValue(cipher: string): Promise<string> {
  if (!cipher) return ''
  try {
    const raw = Uint8Array.from(atob(cipher), c => c.charCodeAt(0))
    const iv = raw.slice(0, 12)
    const data = raw.slice(12)
    const key = await getEncKey()
    const dec = await subtle!.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(dec)
  } catch {
    return cipher // 兼容未加密的旧数据
  }
}

export async function encryptKeys(keys: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(keys)) {
    result[k] = v ? await encryptValue(v) : ''
  }
  return result
}

export async function decryptKeys(keys: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(keys)) {
    result[k] = v ? await decryptValue(v) : ''
  }
  return result
}
