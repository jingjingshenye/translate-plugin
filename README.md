# Quick Translate

划词翻译 + 弹窗翻译 + 沉浸式翻译 Chrome 浏览器插件。

## 功能

- **划词翻译** — 选中文字出现翻译图标，点击查看翻译和词典释义；译文可朗读（内置 TTS）
- **输入框翻译** — 支持 `<input>`、`<textarea>` 及 Shadow DOM 内选中文字（密码框自动跳过）
- **弹窗翻译** — 点击插件图标，输入文本翻译
- **沉浸式翻译** — 整页翻译，双语对照 / 仅译文，可视区域懒加载，独立目标语言，页面语言即目标语言时自动跳过
- **AI 对照翻译** — 划词时并行请求已配置 Key 的 AI 源，独立显示一份对照译文（自动选源/指定/关闭）
- **20+ 翻译源**
  - 免费：Microsoft（Edge 免认证端点）/ 腾讯 / 火山 / 百度 / DeepL Free / Google
  - 订阅：微软 Azure / 腾讯云 / 百度翻译 API / Google API / DeepL API（多家有每月免费额度）
  - AI：DeepSeek / OpenAI / Gemini / Claude / SiliconFlow / 小米MiMo / 阿里百炼 / Cerebras / 智谱AI / OpenRouter（设置页标注各家免费额度与注册直达）
- **自动备用（Fallback）** — 主引擎失败自动切换其他免费源，结果标注「备用」；可按源禁用；熔断与最近成功优先
- **连通性测试** — 设置页逐源一键测试（含免费源），显示具体成功/失败原因
- **自定义 API** — 任何 OpenAI 兼容接口（URL + Key + Model + Prompt）
- **本地词典** — ECDICT 15000 高频词 + 18789 词形映射，瞬间响应
- **在线词典** — Bing / 有道词典补充音标、例句、双解
- **生词本 + 翻译历史** — 收藏（哪个成功收藏哪个）、历史记录（去重上限 100 条）、导出
- **暗色模式** — 全部界面跟随系统深浅色
- **API Key 加密** — 所有 Key 用 AES-GCM 加密存储在本地

## 安装

### 从 Release 下载

1. 从 [Releases](https://github.com/jingjingshenye/translate-plugin/releases) 下载 `quick-translate-v1.2.0.zip`
2. 解压
3. Chrome 打开 `chrome://extensions/`
4. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension` 文件夹

### 从源码构建

```bash
git clone https://github.com/jingjingshenye/translate-plugin.git
cd translate-plugin
npm install
npm run dict   # 生成词典（需要 ecdict.csv 放在根目录）
npm run icons  # 生成图标
npm run build
```

## 翻译源

| 类型 | 引擎 | 需要 Key | 免费额度 |
|------|------|---------|---------|
| 免费 | Microsoft、腾讯、火山、百度、DeepL Free、Google | 否 | — |
| 订阅 | 微软 Azure、腾讯云、百度翻译 API、Google API、DeepL API | 是 | Azure 200万字符/月；腾讯云 500万字符/月；百度 5万字符/月；DeepL 50万字符/月 |
| AI | DeepSeek、OpenAI、Gemini、Claude、SiliconFlow、小米MiMo、阿里百炼、Cerebras、智谱AI、OpenRouter | 是 | 智谱 glm-4-flash 完全免费；SiliconFlow 注册送额度；百炼/Cerebras/Gemini/MiMo 有免费层（详见设置页） |
| 自定义 | 任何 OpenAI 兼容接口 | 可选 | — |

> Microsoft 免费源走 Edge 浏览器免认证端点，源语言支持英文（其余语言自动备用到其他免费源）。

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

整页翻译功能，在插件弹窗的「全文翻译」tab 中触发。支持可视区域懒加载和排除规则。

### 使用方式

1. 打开任意英文网页，点击插件图标打开弹窗
2. 切换到「全文翻译」tab，选择翻译模式和引擎
3. 点击「翻译可视区域」（懒加载）或「翻译全部」
4. 页面右下角出现控制面板，可切换模式、显示/隐藏原文、清除译文

### 翻译模式

| 模式 | 说明 |
|------|------|
| 双语对照 | 原文下方显示译文，蓝色竖线标记 |
| 仅译文 | 隐藏原文，只显示中文译文 |

### 懒加载

默认使用 IntersectionObserver 懒加载：只翻译可视区域内的文本块，滚动页面时自动翻译新进入视口的内容。也可以点击「翻译全部」一次性翻译整个页面。

### 排除规则

在设置页「沉浸式翻译」tab 中可配置自定义 CSS 选择器（每行一个），指定不翻译的区域。

内置排除规则（始终生效）：

| 分类 | 选择器 |
|------|--------|
| 页面结构 | `nav`, `header`, `footer`, `[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]` |
| 侧边栏 | `.sidebar`, `.side-bar`, `#sidebar` |
| 广告 | `.ad`, `.ads`, `.advert`, `[class*="ad-"]`, `[class*="ads-"]`, `[id*="google_ads"]`, `[id*="carbonads"]` |
| 评论区 | `.comments`, `#comments`, `.comment-section` |
| 推荐/社交 | `.related-posts`, `.recommended`, `.social-share`, `.share-buttons` |
| 订阅/弹窗 | `.newsletter`, `.subscribe-form`, `.cookie-banner`, `.cookie-consent`, `.popup-overlay`, `.modal-overlay` |
| 其他 | `[aria-hidden="true"]`, `[data-qt]`, `[data-qt-immersive]` |

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

- **Shadow DOM**：自动遍历 Shadow Root 内的文本节点并翻译，译文通过 Map 引用管理
- **iframe**：支持同源 iframe 内容翻译（跨域 iframe 因浏览器安全限制无法访问）

### SPA 兼容

自动检测 SPA 路由变化（`pushState` / `replaceState` / `popstate`），页面切换时自动清除旧翻译。适用于 GitHub、Twitter、掘金等单页应用。

### 段落级合并

同一 block 元素（`<p>`、`<h1>`-`<h6>`、`<li>` 等）内的多个文本节点会合并为一条翻译请求，减少 API 调用次数，翻译质量更高（上下文更完整）。

### 技术实现

```
弹窗「全文翻译」tab
  ↓
发送 qt-immersive-translate 到 content script
  ↓
TreeWalker 遍历文本节点（含 Shadow DOM 递归）
  ↓
排除选择器过滤 + 按块级元素聚合 + 去重
  ↓
IntersectionObserver 注册（懒加载模式）
  ↓
可视区域块进入视口 → 批量发送到 background（每批 5 条）
  ↓
background 调用翻译 API（复用已有引擎 + fallback）
  ↓
译文注入 DOM（双语 div / code 内联 span）
```

## 架构

```
用户操作              Content Script              Background SW           外部 API
─────────            ──────────────             ──────────────          ────────
划词翻译    ──msg──►  App.vue                                    ──►  Microsoft /
弹窗翻译    ──msg──►  Popup.vue ──msg──►  translateWithFallback  ──►  Google /
右键菜单    ──msg──►  App.vue            (LRU 缓存 + fallback)   ──►  腾讯 / 百度 /
沉浸式翻译  ──msg──►  controller.ts ──►  batchTranslate (并发)   ──►  DeepL / OpenAI /
            (popup)  walker.ts                                    ──►  Claude / ...
                     translator.ts            lookupDict
                     injector.ts              (local → Bing → youdao)
                                              ◄──result──
```

- **MV3 Service Worker**：所有翻译/词典请求集中处理，绕过目标页面 CSP
- **LRU + TTL 缓存**：500 条 × 30 分钟，custom URL/model 改动自动失效
- **自动 fallback**：首选源失败时依次尝试免费源
- **API Key 加密**：AES-GCM，密钥存在 `chrome.storage.local`
- **请求超时**：30 秒 AbortSignal.timeout 兜底

## 项目结构

```
src/
├── background/main.ts          # Service Worker（消息路由 + 翻译/词典/批量翻译入口）
├── contentScripts/
│   ├── index.ts                # 注入到页面（CSS + 划词翻译容器 + 沉浸式控制器加载）
│   ├── style.css               # 注入样式（qt-* 前缀，不污染主页面）
│   ├── views/App.vue           # 划词翻译 UI
│   └── immersive/
│       ├── controller.ts       # 沉浸式翻译控制器（纯 TS，IntersectionObserver + SPA 路由监听）
│       ├── walker.ts           # DOM 遍历 + 文本提取（Shadow DOM / iframe / 排除选择器）
│       ├── translator.ts       # 批量翻译调度（并发控制）
│       └── injector.ts         # 译文注入 DOM（双语 / 仅译文 / 限制性父元素处理）
├── popup/
│   ├── Popup.vue               # 弹窗（划词翻译 tab + 全文翻译 tab）
│   └── ...
├── options/
│   └── Options.vue             # 设置页（翻译源 / 沉浸式翻译 / 词典 / 生词本）
├── logic/
│   ├── translate.ts            # 所有翻译函数 + IMPL 表 + LRU 缓存
│   ├── translators-meta.ts     # 翻译源元数据（id/name/needKey）
│   ├── lang-utils.ts           # detectLang / getTargetLang（纯函数）
│   ├── dict.ts                 # 本地/在线词典
│   ├── background-api.ts       # sendMessage 封装
│   ├── crypto.ts               # AES-GCM 加密
│   └── md5.ts                  # 百度签名用 MD5
└── composables/
    ├── useStorage.ts           # Vue ref ↔ chrome.storage.local 双向同步
    ├── useEncryptedKeys.ts     # API Keys 加密 ref
    └── useFavorites.ts         # 生词本
```

## 技术栈

- Vue 3 + TypeScript
- Vite 5（lib 模式分别打包 content / background / popup / options）
- Chrome Extension Manifest V3

## 许可

MIT
