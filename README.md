# Quick Translate - 浏览器翻译插件

一个简洁高效的浏览器翻译插件，支持划词翻译和弹窗翻译。

## 功能特性

- **划词翻译**: 选中文本后出现翻译图标，点击即可翻译
- **弹窗翻译**: 点击浏览器插件图标，打开翻译面板输入文本翻译
- **多语言支持**: 支持中文、英文、日语、韩语、法语、德语、西班牙语、俄语
- **免费API**: 使用Google Translate免费API，无需申请密钥

## 安装使用

### 开发模式

```bash
# 安装依赖
npm install

# 开发调试
npm run dev

# 构建扩展
npm run build
```

### 安装到浏览器

1. 运行 `npm run build` 构建扩展
2. 打开 Chrome 浏览器，进入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择 `dist` 目录

## 项目结构

```
translate-plugin/
├── public/
│   ├── manifest.json      # 扩展配置文件
│   ├── background.js      # 后台服务
│   ├── content.js         # 内容脚本（划词翻译）
│   ├── popup.html         # 弹窗页面
│   └── icons/             # 扩展图标
├── src/
│   └── popup/
│       ├── main.js        # 弹窗入口
│       └── App.vue        # 弹窗组件
├── vite.config.js         # Vite 配置
└── package.json
```

## 翻译API

本插件使用 Google Translate 免费API：
- 接口: `https://translate.googleapis.com/translate_a/single`
- 无需API密钥
- 支持自动语言检测

## 技术栈

- Vue 3
- Vite
- Chrome Extension Manifest V3
