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
  <div class="app">
    <div class="header">
      <div class="logo">译</div>
      <span class="title">QUICK TRANSLATE</span>
    </div>

    <div class="body">
      <div class="section">
        <div class="section-title">翻译源</div>
        <div class="field">
          <label class="label">翻译引擎</label>
          <select v-model="api" class="input">
            <optgroup label="免费"><option v-for="t in FREE_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
            <optgroup label="AI（需Key）"><option v-for="t in AI_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
          </select>
        </div>
        <div v-if="needKey" class="field">
          <label class="label">API 密钥</label>
          <input v-model="apiKeys[api]" type="password" class="input" placeholder="输入 API Key" />
          <p class="hint">仅存储在本地</p>
        </div>
      </div>

      <div class="section">
        <div class="section-title">语言</div>
        <div class="field">
          <label class="label">源语言</label>
          <select v-model="fromLang" class="input">
            <option value="auto">自动检测</option>
            <option value="zh">中文</option><option value="en">English</option>
            <option value="ja">日本語</option><option value="ko">한국어</option>
            <option value="fr">Français</option><option value="de">Deutsch</option>
          </select>
        </div>
        <div class="field">
          <label class="label">目标语言</label>
          <select v-model="toLang" class="input">
            <option value="zh">中文</option><option value="en">English</option>
            <option value="ja">日本語</option><option value="ko">한국어</option>
            <option value="fr">Français</option><option value="de">Deutsch</option>
          </select>
        </div>
      </div>

      <div class="section about">
        <div class="section-title">关于</div>
        <p class="about-text">Quick Translate v1.0.0</p>
        <p class="hint">划词翻译 + 弹窗翻译 · 18种翻译源</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  width: 360px; background: var(--qt-bg-card); color: var(--qt-text);
  font-family: system-ui, sans-serif; font-size: 13px;
  border: 1px solid var(--qt-border); border-radius: 8px;
  overflow: hidden; box-shadow: 0 4px 20px rgba(56,189,248,0.15), 0 6px 24px rgba(0,0,0,0.08);
}

.header {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  background: linear-gradient(90deg, rgba(56,189,248,0.1), transparent);
  border-bottom: 1px solid var(--qt-border-light);
}
.logo {
  width: 24px; height: 24px; border-radius: 5px;
  background: linear-gradient(135deg, var(--qt-primary), var(--qt-primary-light));
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff;
}
.title {
  font-size: 10px; font-weight: 700; letter-spacing: 1px;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}

.body { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 8px; }

.section {
  background: var(--qt-bg-input); border: 1px solid var(--qt-border-light);
  border-radius: 6px; padding: 8px 10px;
}
.section-title {
  font-size: 10px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;
  background: linear-gradient(90deg, var(--qt-primary-dark), var(--qt-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  text-transform: uppercase;
}

.field { margin-bottom: 8px; }
.field:last-child { margin-bottom: 0; }

.label { display: block; font-size: 11px; color: var(--qt-text-light); margin-bottom: 4px; }

.input {
  width: 100%; padding: 6px 8px; background: var(--qt-bg-card);
  border: 1px solid var(--qt-border); border-radius: 5px;
  color: var(--qt-text); font-size: 12px; outline: none;
}
.input:focus { border-color: var(--qt-primary); }
.input option, .input optgroup { background: var(--qt-bg-card); color: var(--qt-text); }

.hint { font-size: 10px; color: var(--qt-text-light); margin-top: 3px; }

.about-text { font-size: 12px; color: var(--qt-text); margin-bottom: 2px; }
</style>
