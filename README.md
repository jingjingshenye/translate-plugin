# Quick Translate

划词翻译 + 弹窗翻译 + 沉浸式翻译 Chrome 浏览器插件。

## 功能

- **划词翻译** — 选中文字出现翻译图标，点击或悬停查看翻译和词典释义
- **输入框翻译** — 支持 `<input>`、`<textarea>` 及 Shadow DOM 内选中文字触发翻译
- **弹窗翻译** — 点击插件图标，输入文本翻译
- **沉浸式翻译** — 整页翻译，支持双语对照 / 仅译文模式
- **20+ 翻译源**
  - 免费：Microsoft / Google / 腾讯 / 火山 / 百度 / DeepL Free
  - 订阅：腾讯云 / 百度翻译 API / Google API / DeepL API
  - AI：DeepSeek / OpenAI / Gemini / Claude / SiliconFlow / 小米MiMo / 阿里百炼 / Cerebras / 智谱AI / OpenRouter
- **自定义 API** — 任何 OpenAI 兼容接口（URL + Key + Model + Prompt）
- **AI 模型可配置** — 每个 AI 翻译源可在设置中覆盖默认 model 名
- **本地词典** — ECDICT 15000 高频词 + 18789 词形映射，瞬间响应
- **在线词典** — Bing / 有道词典补充音标、例句、双解
- **生词本** — 收藏、编辑翻译、TXT/CSV/JSON 导出导入
- **API Key 加密** — 所有 Key 用 AES-GCM 加密存储在本地

## 安装

### 从 Release 下载

1. 从 [Releases](https://github.com/jingjingshenye/translate-plugin/releases) 下载 `quick-translate-v1.0.0.zip`
2. 解压
3. Chrome 打开 `chrome://extensions/`
4. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension` 文件夹

### 从源码构建

```bash
git clone https://github.com/jingjingshenye/translate-plugin.git
cd translate-plugin
npm install
npm run dict   # 生成词典（需要 ecdict.csv 放在根目录）
npm run icons # 生成图标
npm run build
```

## 翻译源

| 类型 | 引擎 | 需要 Key |
|------|------|---------|
| 免费 | Microsoft、Google、腾讯、火山、百度、DeepL Free | 否 |
| 订阅 | 腾讯云、百度翻译 API、Google API、DeepL API | 是 |
| AI | DeepSeek、OpenAI、Gemini、Claude、SiliconFlow、小米MiMo、阿里百炼、Cerebras、智谱AI、OpenRouter | 是 |
| 自定义 | 任何 OpenAI 兼容接口 | 可选 |

每个 AI 翻译源可在 Options 中覆盖默认 model（例如把 Claude 切到 `claude-haiku-4-5-20251001` 之外的版本）。

## 词典

- **本地词典**：基于 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT），15000 高频词 + 18789 词形映射
- **词形还原**：`credits→credit`、`went→go`、`redeemable→redeem`
- **在线补充**：Bing / 有道词典提供音标、例句、双解
- **三种模式**（在设置中切换）：
  - **本地** — 瞬间响应，无网络
  - **网络** — Bing/有道，含音标、发音、例句、双解
  - **混合** — 本地优先（瞬间），异步补充网络数据

## 沉浸式翻译

整页翻译功能，在插件弹窗的「全文翻译」tab 中触发，译文直接显示在页面上。

### 使用方式

1. 打开任意英文网页，点击插件图标打开弹窗
2. 切换到「全文翻译」tab，选择翻译模式
3. 点击「翻译此页面」，页面右下角出现小型控制面板
4. 翻译完成后可切换模式、显示/隐藏原文、清除译文

### 翻译模式

| 模式 | 说明 |
|------|------|
| 双语对照 | 原文下方显示译文，蓝色竖线标记 |
| 仅译文 | 隐藏原文，只显示中文译文 |

### 翻译引擎

可在设置中为沉浸式翻译单独选择引擎，或跟随默认设置。整页翻译建议使用免费引擎（Google / Microsoft），速度快且无成本。

### 代码块处理

代码块按语言标记智能区分：

| 类型 | 处理 |
|------|------|
| 有编程语言标记（`language-python`、`lang-js` 等） | 跳过，不翻译 |
| 纯文本标记（`language-text`、`language-plain`、`language-markdown` 等） | 翻译 |
| 无语言标记的 `<code>` / `<pre>` | 翻译 |
| 纯符号内容（`{}`、`;`、`++` 等） | 跳过 |

兼容主流语法高亮库（Prism / Highlight.js / Shiki / GitHub），通过以下方式检测语言：
- CSS class：`language-*`、`lang-*`、`highlight-source-*`、`hljs`
- HTML 属性：`data-lang`、`data-language`

### Shadow DOM / iframe

- **Shadow DOM**：自动遍历 Shadow Root 内的文本节点并翻译，译文通过 Map 引用管理（不依赖 document.querySelector）
- **iframe**：支持同源 iframe 内容翻译（跨域 iframe 因浏览器安全限制无法访问）

### 技术实现

```
页面加载
  ↓
TreeWalker 遍历文本节点（含 Shadow DOM 递归）
  ↓
按块级元素聚合 + 去重 + 语言检测过滤
  ↓
批量发送到 background（并发 3 路，每批 5 条）
  ↓
background 调用翻译 API（复用已有引擎 + fallback）
  ↓
content script 收到译文 → 注入到 DOM
```

## 架构

```
用户操作              Background Service Worker         外部 API
─────────            ──────────────────────────        ────────
划词翻译    ──msg──►  translateWithFallback    ──►     Microsoft / Google /
弹窗翻译    ──msg──►  （LRU 缓存 + 30s 超时 +           腾讯 / 百度 / DeepL /
右键菜单    ──msg──►  fallback）                        OpenAI / Claude / ...
沉浸式翻译  ──msg──►  batchTranslate（并发）            ...
                     lookupDict
                     （local → Bing → youdao）
                     ◄──result──
```

- **MV3 Service Worker**：所有翻译/词典请求集中处理，绕过目标页面 CSP（在 GitHub / 银行等严格 CSP 站点也能工作）
- **LRU + TTL 缓存**：500 条 × 30 分钟，custom URL/model 改动会自动失效
- **自动 fallback**：首选源失败时依次尝试免费源
- **API Key 加密**：AES-GCM，密钥存在 `chrome.storage.local`
- **请求超时**：30 秒 `AbortSignal.timeout` 兜底

## 项目结构

```
src/
├── background/main.ts          # Service Worker（消息路由 + 翻译/词典/批量翻译入口）
├── contentScripts/
│   ├── index.ts                # 注入到页面（CSS + 划词翻译容器 + 沉浸式控制器）
│   ├── style.css               # 注入样式（qt-* 前缀，不污染主页面）
│   ├── views/App.vue           # 划词翻译 UI
│   └── immersive/
│       ├── controller.ts       # 沉浸式翻译控制器（纯 TS，无 Vue）
│       ├── walker.ts           # DOM 遍历 + 文本提取（Shadow DOM / iframe）
│       ├── translator.ts       # 批量翻译调度（并发控制）
│       └── injector.ts         # 译文注入 DOM（双语 / 仅译文）
├── popup/
│   ├── Popup.vue               # 弹窗（划词翻译 tab + 全文翻译 tab）
│   └── ...
├── options/                    # 设置页（含沉浸式翻译设置）
├── logic/
│   ├── translate.ts            # 所有翻译函数 + IMPL 表
│   ├── translators-meta.ts     # 翻译源元数据（id/name/needKey）
│   ├── lang-utils.ts           # detectLang / getTargetLang（纯函数）
│   ├── dict.ts                 # 本地/在线词典
│   ├── background-api.ts       # sendMessage 封装
│   ├── crypto.ts               # AES-GCM 加密
│   └── md5.ts                  # 百度签名用 MD5
└── composables/
    ├── useStorage.ts           # Vue + chrome.storage 同步
    ├── useEncryptedKeys.ts     # API Keys 加密 ref
    └── useFavorites.ts         # 生词本
```

## 技术栈

- Vue 3 + TypeScript
- Vite 5（lib 模式分别打包 content/background/popup/options）
- Chrome Extension Manifest V3

## 许可

MIT
