# Quick Translate

划词翻译 + 弹窗翻译 Chrome 浏览器插件。

## 功能

- **划词翻译** — 选中文字后出现翻译图标，点击查看翻译和词典释义
- **弹窗翻译** — 点击插件图标，输入文本翻译
- **18 种翻译源** — 免费: Microsoft / Google / Tencent / Volcengine / Baidu / DeepL Free; AI: DeepSeek / OpenAI / Gemini / Claude 等
- **本地词典** — 内置 ECDICT 15000 词 + 18789 词形映射，瞬间查词，支持词形还原
- **在线词典** — Bing / 有道词典补充音标、例句、双解
- **生词本** — 收藏单词，支持导出 TXT/CSV/JSON、导入、搜索
- **设置页面** — 翻译源选择、API Key 配置、词典模式切换

## 安装

### 下载 Release

1. 从 [Releases](https://github.com/jingjingshenye/translate-plugin/releases) 下载 `quick-translate-v1.0.0.tar.gz`
2. 解压
3. Chrome 打开 `chrome://extensions/`
4. 开启「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的 `extension` 文件夹

### 从源码构建

```bash
git clone https://github.com/jingjingshenye/translate-plugin.git
cd translate-plugin
npm install

# 生成词典（需要 ecdict.csv，从 ECDICT 项目下载放到根目录）
npm run dict

# 构建
npm run build
```

构建产物在 `extension/` 目录。

## 项目结构

```
├── src/
│   ├── contentScripts/     # 内容脚本（划词翻译弹窗）
│   ├── popup/              # 插件弹窗面板
│   ├── options/            # 设置页面
│   ├── background/         # 后台 Service Worker
│   ├── logic/              # 核心逻辑（翻译、词典）
│   ├── composables/        # Vue 组合式函数
│   └── styles/             # 主题变量
├── scripts/                # 构建脚本（manifest、词典生成、图标）
├── extension/              # 构建产物（加载此目录）
└── ecdict.csv              # ECDICT 词典源文件（需自行下载）
```

## 技术栈

- Vue 3 + TypeScript
- Vite 5
- Chrome Extension Manifest V3

## 词典

本地词典基于 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议），通过 `scripts/build-dict.mjs` 从 CSV 提取高频词条并生成词形映射。

词典查询流程：
1. 本地词典（瞬间响应）
2. 异步补充 Bing / 有道在线数据（音标、例句、发音）
3. 支持词形还原：`credits → credit`、`went → go`、`redeemable → redeem`

## 许可

MIT
