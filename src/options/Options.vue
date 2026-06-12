<script setup lang="ts">
import { computed } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { FREE_TRANSLATORS, AI_TRANSLATORS } from '~/logic/translate'

const api = useStorage<string>('qt_api', 'microsoft')
const fromLang = useStorage<string>('qt_from', 'auto')
const toLang = useStorage<string>('qt_to', 'zh')
const apiKeys = useStorage<Record<string, string>>('qt_api_keys', {})

const needKey = computed(() => AI_TRANSLATORS.find(t => t.id === api.value)?.needKey || false)
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="logo">译</div>
      <h1>Quick Translate <span>设置</span></h1>
    </header>

    <main class="main">
      <section class="card">
        <h2>翻译源</h2>
        <div class="row">
          <label>翻译引擎</label>
          <select v-model="api">
            <optgroup label="免费"><option v-for="t in FREE_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
            <optgroup label="AI（需Key）"><option v-for="t in AI_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
          </select>
        </div>
        <div v-if="needKey" class="row">
          <label>API 密钥</label>
          <input v-model="apiKeys[api]" type="password" placeholder="输入 API Key" />
        </div>
      </section>

      <section class="card">
        <h2>语言</h2>
        <div class="row">
          <label>源语言</label>
          <select v-model="fromLang">
            <option value="auto">自动检测</option>
            <option value="zh">中文</option><option value="en">English</option>
            <option value="ja">日本語</option><option value="ko">한국어</option>
            <option value="fr">Français</option><option value="de">Deutsch</option>
          </select>
        </div>
        <div class="row">
          <label>目标语言</label>
          <select v-model="toLang">
            <option value="zh">中文</option><option value="en">English</option>
            <option value="ja">日本語</option><option value="ko">한국어</option>
            <option value="fr">Français</option><option value="de">Deutsch</option>
          </select>
        </div>
      </section>

      <footer class="footer">
        <p>Quick Translate v1.0.0 · 划词翻译 + 弹窗翻译 · 18种翻译源</p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh; background: #f0f9ff; color: #0c4a6e;
  font-family: system-ui, sans-serif;
}

.header {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 32px; border-bottom: 1px solid rgba(56,189,248,0.15);
  background: linear-gradient(90deg, rgba(56,189,248,0.08), transparent);
}
.logo {
  width: 36px; height: 36px; border-radius: 8px;
  background: linear-gradient(135deg, #38bdf8, #7dd3fc);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: #fff;
}
.header h1 { font-size: 18px; font-weight: 700; }
.header span { color: #64748b; font-weight: 400; }

.main { max-width: 640px; margin: 0 auto; padding: 24px 32px; }

.card {
  background: #fff; border: 1px solid rgba(56,189,248,0.15);
  border-radius: 10px; padding: 20px 24px; margin-bottom: 16px;
}
.card h2 {
  font-size: 14px; font-weight: 600; color: #0ea5e9;
  margin: 0 0 16px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(56,189,248,0.1);
}

.row {
  display: flex; align-items: center; gap: 16px; margin-bottom: 12px;
}
.row:last-child { margin-bottom: 0; }
.row label {
  width: 80px; flex-shrink: 0; font-size: 13px; color: #64748b;
}
.row select, .row input {
  flex: 1; padding: 8px 10px; background: #f0f9ff;
  border: 1px solid rgba(56,189,248,0.2); border-radius: 6px;
  color: #0c4a6e; font-size: 13px; outline: none;
}
.row select:focus, .row input:focus { border-color: #38bdf8; }
.row select option, .row select optgroup { background: #f0f9ff; color: #0c4a6e; }

.footer {
  text-align: center; padding: 20px 0; color: #64748b; font-size: 12px;
}
</style>
