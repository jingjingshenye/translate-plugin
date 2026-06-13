<script setup lang="ts">
import { ref, computed } from 'vue'
import { useStorage } from '~/composables/useStorage'
import { useFavorites } from '~/composables/useFavorites'
import { FREE_TRANSLATORS, SUBSCRIBE_TRANSLATORS, AI_TRANSLATORS, ALL_TRANSLATORS } from '~/logic/translate'

// 设置
const api = useStorage<string>('qt_api', 'microsoft')
const fromLang = useStorage<string>('qt_from', 'auto')
const toLang = useStorage<string>('qt_to', 'zh')
const apiKeys = useStorage<Record<string, string>>('qt_api_keys', {})
const dictMode = useStorage<string>('qt_dict_mode', 'local')

// 自定义 API 配置
const customApi = useStorage('qt_custom_api', {
  url: '',
  key: '',
  model: 'gpt-4o-mini',
  prompt: '',
})

// 收藏
const { list: favList, count: favCount, toggle: toggleFav, clear: clearFavs, exportList, importList } = useFavorites()

// Tab
const tab = ref<'api' | 'dict' | 'fav'>('api')
const editingApi = ref<string>('')

function setApiKey(id: string, key: string) {
  apiKeys.value = { ...apiKeys.value, [id]: key }
}

// 收藏
const importText = ref('')
const showImport = ref(false)
function doExport() { navigator.clipboard.writeText(exportList()).then(() => alert('已复制到剪贴板')) }
function doImport() { if (importText.value.trim()) { importList(importText.value); importText.value = ''; showImport.value = false } }

const searchQuery = ref('')
const sortBy = ref<'date' | 'alpha'>('date')
const editingWord = ref('')
const editTranslation = ref('')

const stats = computed(() => {
  const entries = favList.value || []
  const today = new Date().toDateString()
  return { total: entries.length, today: entries.filter(([, d]) => new Date(d.createdAt).toDateString() === today).length, withTrans: entries.filter(([, d]) => d.translation).length }
})

const filteredWords = computed(() => {
  let entries = favList.value || []
  if (searchQuery.value.trim()) { const q = searchQuery.value.toLowerCase(); entries = entries.filter(([w, d]) => w.toLowerCase().includes(q) || (d.translation || '').toLowerCase().includes(q)) }
  return sortBy.value === 'alpha' ? [...entries].sort((a, b) => a[0].localeCompare(b[0])) : entries
})

function removeWord(word: string) { toggleFav(word) }
function clearAll() { if (confirm('确定清空所有收藏？')) clearFavs() }
function startEdit(word: string) { editingWord.value = word; editTranslation.value = favList.value?.find(([w]) => w === word)?.[1]?.translation || '' }
function saveEdit() { editingWord.value = '' }
function copyWord(word: string) { navigator.clipboard.writeText(word) }

function formatDate(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return new Date(ts).toLocaleDateString()
}

function exportTXT() { download(exportList(), 'vocabulary.txt', 'text/plain') }
function exportCSV() {
  const lines = [['Word', 'Translation', 'Date']]
  filteredWords.value.forEach(([w, d]) => lines.push([w, d.translation || '', new Date(d.createdAt).toLocaleDateString()]))
  download(lines.map(r => r.map(c => `"${c}"`).join(',')).join('\n'), 'vocabulary.csv', 'text/csv')
}
function exportJSON() { download(JSON.stringify(Object.fromEntries(filteredWords.value), null, 2), 'vocabulary.json', 'application/json') }
function download(content: string, name: string, type: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click()
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="logo">译</div>
      <h1>Quick Translate <span>设置</span></h1>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'api' }" @click="tab = 'api'">翻译源</button>
      <button :class="{ active: tab === 'dict' }" @click="tab = 'dict'">词典</button>
      <button :class="{ active: tab === 'fav' }" @click="tab = 'fav'">生词本 <em v-if="stats.total">({{ stats.total }})</em></button>
    </nav>

    <main class="main">
      <!-- ==================== 翻译源 ==================== -->
      <template v-if="tab === 'api'">
        <section class="card">
          <h2>默认翻译引擎</h2>
          <div class="row">
            <label>引擎</label>
            <select v-model="api">
              <optgroup label="免费"><option v-for="t in FREE_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="订阅源（需Key）"><option v-for="t in SUBSCRIBE_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup label="AI（需Key）"><option v-for="t in AI_TRANSLATORS" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <option value="custom">自定义 API</option>
            </select>
          </div>
          <div class="row">
            <label>源语言</label>
            <select v-model="fromLang"><option value="auto">自动</option><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
          </div>
          <div class="row">
            <label>目标语言</label>
            <select v-model="toLang"><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
          </div>
        </section>

        <section class="card">
          <h2>订阅源 API Key</h2>
          <p class="hint" style="margin-bottom:12px">传统翻译接口，按量付费，翻译质量稳定</p>
          <div v-for="t in SUBSCRIBE_TRANSLATORS" :key="t.id" class="api-row">
            <label>{{ t.name }}</label>
            <input :type="editingApi === t.id ? 'text' : 'password'" :value="apiKeys[t.id] || ''"
              @input="setApiKey(t.id, ($event.target as HTMLInputElement).value)"
              @focus="editingApi = t.id" @blur="editingApi = ''"
              :placeholder="t.id === 'tencent_official' ? 'SecretId:SecretKey' : t.id === 'baidu_official' ? 'AppID:密钥' : 'API Key'" />
          </div>
        </section>

        <section class="card">
          <h2>AI 翻译 API Key</h2>
          <p class="hint" style="margin-bottom:12px">大语言模型翻译，支持上下文理解，适合复杂文本</p>
          <div v-for="t in AI_TRANSLATORS" :key="t.id" class="api-row">
            <label>{{ t.name }}</label>
            <input :type="editingApi === t.id ? 'text' : 'password'" :value="apiKeys[t.id] || ''"
              @input="setApiKey(t.id, ($event.target as HTMLInputElement).value)"
              @focus="editingApi = t.id" @blur="editingApi = ''"
              :placeholder="t.name + ' API Key'" />
          </div>
        </section>

        <section class="card">
          <h2>自定义 API</h2>
          <p class="hint" style="margin-bottom:12px">配置自定义翻译接口（OpenAI 兼容格式）</p>
          <div class="row">
            <label>接口地址</label>
            <input v-model="customApi.url" type="text" placeholder="https://your-api.com/v1/chat/completions" />
          </div>
          <div class="row">
            <label>API Key</label>
            <input v-model="customApi.key" type="password" placeholder="可选" />
          </div>
          <div class="row">
            <label>模型</label>
            <input v-model="customApi.model" type="text" placeholder="gpt-4o-mini" />
          </div>
          <div class="row">
            <label>Prompt</label>
            <input v-model="customApi.prompt" type="text" placeholder="自定义系统提示词（可选）" />
          </div>
        </section>
      </template>

      <!-- ==================== 词典设置 ==================== -->
      <template v-if="tab === 'dict'">
        <section class="card">
          <h2>词典模式</h2>
          <div class="dict-options">
            <label class="dict-option" :class="{ active: dictMode === 'local' }" @click="dictMode = 'local'">
              <div class="dict-icon">📚</div>
              <div class="dict-info">
                <div class="dict-name">本地词典</div>
                <div class="dict-desc">内置 15000 高频词 + 18789 词形映射，瞬间响应，无需网络</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'local'">✓</div>
            </label>
            <label class="dict-option" :class="{ active: dictMode === 'online' }" @click="dictMode = 'online'">
              <div class="dict-icon">🌐</div>
              <div class="dict-info">
                <div class="dict-name">网络词典</div>
                <div class="dict-desc">Bing/有道词典，含音标、发音、例句、双解</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'online'">✓</div>
            </label>
            <label class="dict-option" :class="{ active: dictMode === 'both' }" @click="dictMode = 'both'">
              <div class="dict-icon">⚡</div>
              <div class="dict-info">
                <div class="dict-name">混合模式</div>
                <div class="dict-desc">本地优先（瞬间），同时异步补充网络数据</div>
              </div>
              <div class="dict-check" v-if="dictMode === 'both'">✓</div>
            </label>
          </div>
        </section>

        <section class="card">
          <h2>数据来源</h2>
          <div class="source-list">
            <div class="source-item">
              <span class="source-badge local">本地</span>
              <span class="source-name">ECDICT 词典</span>
              <span class="source-detail">15000 词 · 音标 · 释义 · 词性 · 时态变形</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">Bing 词典</span>
              <span class="source-detail">发音 · 例句 · 英汉双解</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">有道词典</span>
              <span class="source-detail">备用 · 释义 · 例句</span>
            </div>
            <div class="source-item">
              <span class="source-badge online">网络</span>
              <span class="source-name">百度 TTS</span>
              <span class="source-detail">英美发音</span>
            </div>
          </div>
        </section>
      </template>

      <!-- ==================== 生词本 ==================== -->
      <template v-if="tab === 'fav'">
        <div class="stats-row">
          <div class="stat-card"><div class="stat-num">{{ stats.total }}</div><div class="stat-label">总词汇</div></div>
          <div class="stat-card"><div class="stat-num">{{ stats.today }}</div><div class="stat-label">今日新增</div></div>
          <div class="stat-card"><div class="stat-num">{{ stats.withTrans }}</div><div class="stat-label">有翻译</div></div>
        </div>

        <section class="card">
          <div class="toolbar">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input v-model="searchQuery" placeholder="搜索单词或翻译..." />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">&times;</button>
            </div>
            <div class="toolbar-actions">
              <select v-model="sortBy" class="sort-sel"><option value="date">按时间</option><option value="alpha">按字母</option></select>
              <button class="tool-btn" @click="showImport = !showImport" title="导入">📥</button>
              <button class="tool-btn" @click="exportTXT" title="TXT">📄</button>
              <button class="tool-btn" @click="exportCSV" title="CSV">📊</button>
              <button class="tool-btn" @click="exportJSON" title="JSON">{ }</button>
              <button v-if="stats.total" class="tool-btn tool-danger" @click="clearAll" title="清空">🗑</button>
            </div>
          </div>

          <div v-if="showImport" class="import-area">
            <textarea v-model="importText" placeholder="粘贴单词列表（每行一个，Tab分隔翻译）" rows="3"></textarea>
            <div class="import-actions">
              <button class="btn btn-sm" @click="doImport" :disabled="!importText.trim()">导入</button>
              <button class="btn btn-sm btn-ghost" @click="showImport = false; importText = ''">取消</button>
            </div>
          </div>

          <div v-if="filteredWords.length" class="word-list">
            <div v-for="[word, data] in filteredWords" :key="word" class="word-item">
              <div class="word-main">
                <div class="word-text">{{ word }}</div>
                <div v-if="editingWord === word" class="word-edit">
                  <input v-model="editTranslation" @keydown.enter="saveEdit" @keydown.escape="editingWord = ''" />
                  <button class="edit-save" @click="saveEdit">✓</button>
                </div>
                <div v-else class="word-trans" @click="startEdit(word)">{{ data.translation || '点击添加翻译...' }}</div>
              </div>
              <div class="word-meta">
                <span class="word-time">{{ formatDate(data.createdAt) }}</span>
                <div class="word-actions">
                  <button class="word-btn" @click="copyWord(word)" title="复制">📋</button>
                  <button class="word-btn" @click="startEdit(word)" title="编辑">✏️</button>
                  <button class="word-btn word-btn-del" @click="removeWord(word)" title="删除">&times;</button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty">
            <div class="empty-icon">📚</div>
            <div class="empty-title">{{ searchQuery ? '未找到匹配的单词' : '生词本为空' }}</div>
            <div class="empty-desc">{{ searchQuery ? '尝试其他关键词' : '划词翻译时点击 ♡ 收藏单词' }}</div>
          </div>
        </section>
      </template>
    </main>

    <footer class="footer">
      <p>Quick Translate v1.0.0 · {{ ALL_TRANSLATORS.length }}种翻译源</p>
    </footer>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: #f0f9ff; color: #0c4a6e; font-family: system-ui, sans-serif; }
.header { display: flex; align-items: center; gap: 12px; padding: 20px 32px; border-bottom: 1px solid rgba(56,189,248,0.15); background: linear-gradient(90deg, rgba(56,189,248,0.08), transparent); }
.logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, #38bdf8, #7dd3fc); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: #fff; }
.header h1 { font-size: 18px; font-weight: 700; }
.header span { color: #64748b; font-weight: 400; }

.tabs { display: flex; gap: 0; max-width: 760px; margin: 0 auto; padding: 0 32px; border-bottom: 1px solid rgba(56,189,248,0.15); }
.tabs button { padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; color: #64748b; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.tabs button.active { color: #0ea5e9; border-bottom-color: #0ea5e9; }
.tabs button em { font-style: normal; color: #94a3b8; font-size: 11px; }

.main { max-width: 760px; margin: 0 auto; padding: 16px 32px; }
.card { background: #fff; border: 1px solid rgba(56,189,248,0.15); border-radius: 10px; padding: 18px 22px; margin-bottom: 16px; }
.card h2 { font-size: 14px; font-weight: 600; color: #0ea5e9; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(56,189,248,0.1); }
.hint { font-size: 11px; color: #94a3b8; }

.row { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.row:last-child { margin-bottom: 0; }
.row label:first-child { width: 72px; flex-shrink: 0; font-size: 13px; color: #64748b; }
.row select, .row input[type="text"] { flex: 1; padding: 7px 10px; background: #f0f9ff; border: 1px solid rgba(56,189,248,0.2); border-radius: 6px; color: #0c4a6e; font-size: 13px; outline: none; }
.row select:focus, .row input:focus { border-color: #38bdf8; }
.row select option, .row select optgroup { background: #f0f9ff; color: #0c4a6e; }

.api-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.api-row label { width: 90px; flex-shrink: 0; font-size: 12px; color: #64748b; }
.api-row input { flex: 1; padding: 6px 8px; background: #f8fbff; border: 1px solid rgba(56,189,248,0.15); border-radius: 5px; color: #0c4a6e; font-size: 12px; outline: none; }
.api-row input:focus { border-color: #38bdf8; }

/* 词典选项 */
.dict-options { display: flex; flex-direction: column; gap: 8px; }
.dict-option {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: #f8fbff; border: 2px solid rgba(56,189,248,0.15); border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
}
.dict-option:hover { border-color: rgba(56,189,248,0.3); }
.dict-option.active { border-color: #0ea5e9; background: rgba(56,189,248,0.05); }
.dict-icon { font-size: 24px; }
.dict-info { flex: 1; }
.dict-name { font-size: 14px; font-weight: 600; color: #0c4a6e; margin-bottom: 2px; }
.dict-desc { font-size: 11px; color: #64748b; }
.dict-check { width: 20px; height: 20px; border-radius: 50%; background: #0ea5e9; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; }

.source-list { display: flex; flex-direction: column; gap: 8px; }
.source-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.source-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.source-badge.local { background: rgba(16,185,129,0.1); color: #10b981; }
.source-badge.online { background: rgba(59,130,246,0.1); color: #3b82f6; }
.source-name { font-weight: 500; color: #0c4a6e; min-width: 70px; }
.source-detail { color: #64748b; }

/* 统计 */
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; background: #fff; border: 1px solid rgba(56,189,248,0.12); border-radius: 10px; padding: 14px; text-align: center; }
.stat-num { font-size: 24px; font-weight: 700; color: #0ea5e9; }
.stat-label { font-size: 11px; color: #94a3b8; margin-top: 2px; }

/* 工具栏 */
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.search-box { flex: 1; min-width: 140px; position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 8px; font-size: 12px; opacity: 0.5; }
.search-box input { width: 100%; padding: 6px 28px 6px 28px; background: #f0f9ff; border: 1px solid rgba(56,189,248,0.2); border-radius: 6px; font-size: 12px; outline: none; color: #0c4a6e; }
.search-box input:focus { border-color: #38bdf8; }
.search-clear { position: absolute; right: 6px; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
.toolbar-actions { display: flex; gap: 4px; align-items: center; }
.sort-sel { padding: 5px 6px; background: #f0f9ff; border: 1px solid rgba(56,189,248,0.15); border-radius: 5px; font-size: 11px; color: #64748b; outline: none; }
.tool-btn { padding: 4px 8px; background: #f0f9ff; border: 1px solid rgba(56,189,248,0.12); border-radius: 5px; cursor: pointer; font-size: 12px; transition: all 0.15s; }
.tool-btn:hover { background: rgba(56,189,248,0.1); }
.tool-danger:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); }

.import-area { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(56,189,248,0.1); }
.import-area textarea { width: 100%; padding: 6px 8px; background: #f8fbff; border: 1px solid rgba(56,189,248,0.15); border-radius: 5px; font-size: 12px; resize: vertical; outline: none; color: #0c4a6e; }
.import-actions { display: flex; gap: 6px; margin-top: 6px; }

.word-list { margin-top: 12px; max-height: 500px; overflow-y: auto; }
.word-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(56,189,248,0.06); }
.word-item:last-child { border-bottom: none; }
.word-main { flex: 1; min-width: 0; }
.word-text { font-size: 14px; font-weight: 600; color: #0c4a6e; margin-bottom: 2px; }
.word-trans { font-size: 12px; color: #64748b; cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: background 0.15s; }
.word-trans:hover { background: rgba(56,189,248,0.08); }
.word-edit { display: flex; gap: 4px; align-items: center; }
.word-edit input { flex: 1; padding: 3px 6px; background: #f0f9ff; border: 1px solid #38bdf8; border-radius: 4px; font-size: 12px; outline: none; color: #0c4a6e; }
.edit-save { padding: 2px 6px; background: #0ea5e9; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; }
.word-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.word-time { font-size: 10px; color: #94a3b8; }
.word-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.word-item:hover .word-actions { opacity: 1; }
.word-btn { padding: 2px 4px; background: none; border: none; cursor: pointer; font-size: 11px; opacity: 0.5; transition: opacity 0.15s; }
.word-btn:hover { opacity: 1; }
.word-btn-del { color: #ef4444; font-size: 14px; }

.empty { text-align: center; padding: 40px 20px; }
.empty-icon { font-size: 36px; margin-bottom: 8px; }
.empty-title { font-size: 14px; font-weight: 500; color: #64748b; margin-bottom: 4px; }
.empty-desc { font-size: 12px; color: #94a3b8; }

.btn { padding: 6px 14px; background: linear-gradient(135deg, #0ea5e9, #38bdf8); color: #fff; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; transition: all 0.15s; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 4px 10px; font-size: 11px; }
.btn-ghost { background: transparent; color: #64748b; }
.btn-ghost:hover { background: rgba(56,189,248,0.08); }

.footer { text-align: center; padding: 16px 0; color: #94a3b8; font-size: 11px; }
</style>
