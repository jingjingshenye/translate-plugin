import { webcrypto } from 'crypto'

// AES-GCM 加密 API Keys（密钥从 storage 读取/生成）
const ENC_KEY_NAME = 'qt_enc_key'

async function getEncKey(): Promise<webcrypto.CryptoKey> {
  const stored = await chrome.storage.local.get(ENC_KEY_NAME)
  if (stored[ENC_KEY_NAME]) {
    const raw = Uint8Array.from(atob(stored[ENC_KEY_NAME]), c => c.charCodeAt(0))
    return webcrypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt'])
  }
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = await webcrypto.subtle.exportKey('raw', key)
  await chrome.storage.local.set({ [ENC_KEY_NAME]: btoa(String.fromCharCode(...new Uint8Array(exported))) })
  return key
}

export async function encryptValue(plain: string): Promise<string> {
  if (!plain) return ''
  const key = await getEncKey()
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const enc = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return btoa(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(enc)))
}

export async function decryptValue(cipher: string): Promise<string> {
  if (!cipher) return ''
  try {
    const raw = Uint8Array.from(atob(cipher), c => c.charCodeAt(0))
    const iv = raw.slice(0, 12)
    const data = raw.slice(12)
    const key = await getEncKey()
    const dec = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(dec)
  } catch {
    return cipher // 兼容未加密的旧数据
  }
}

// 批量加密/解密 API Keys 对象
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
