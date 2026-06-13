# Quick Translate

划词翻译 + 弹窗翻译 Chrome 浏览器插件。

## 功能

- **划词翻译** — 选中文字后出现翻译图标，点击查看翻译和词典释义
- **弹窗翻译** — 点击插件图标，输入文本翻译
- **18+ 翻译源** — 免费: Microsoft / Google / Tencent / Volcengine / Baidu / DeepL Free; AI: DeepSeek / OpenAI / Gemini / Claude 等
- **自定义 API** — 支持任何 OpenAI 兼容格式的翻译接口
- **本地词典** — 内置 ECDICT 15000 词 + 18789 词形映射，瞬间查词
- **在线词典** — Bing / 有道词典补充音标、例句
- **生词本** — 收藏单词，支持导出 TXT/CSV/JSON、导入
- **设置页面** — 翻译源、API Key、词典模式、自定义 API 配置

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
npm run build
```

## 翻译源

| 类型 | 引擎 |
|------|------|
| 免费 | Microsoft、Google、Tencent、Volcengine、Baidu、DeepL Free |
| AI | DeepSeek、OpenAI、Gemini、Claude、SiliconFlow、小米MiMo、阿里百炼、Cerebras、智谱AI、OpenRouter |
| 自定义 | 任何 OpenAI 兼容接口（配置 URL + Key + Model） |

## 词典

- **本地词典**：基于 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT），15000 高频词 + 18789 词形映射
- **词形还原**：`credits→credit`、`went→go`、`redeemable→redeem`
- **在线补充**：Bing / 有道词典提供音标、例句、双解

## 技术栈

- Vue 3 + TypeScript
- Vite 5
- Chrome Extension Manifest V3

## 许可

MIT
