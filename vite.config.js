import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

// 复制静态资源的插件
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    writeBundle() {
      const distDir = resolve(__dirname, 'dist');
      
      // 复制manifest.json
      copyFileSync(
        resolve(__dirname, 'public', 'manifest.json'),
        resolve(distDir, 'manifest.json')
      );
      
      // 复制background.js
      copyFileSync(
        resolve(__dirname, 'public', 'background.js'),
        resolve(distDir, 'background.js')
      );
      
      // 复制content.js
      copyFileSync(
        resolve(__dirname, 'public', 'content.js'),
        resolve(distDir, 'content.js')
      );
      
      // 复制icons目录
      const iconsDir = resolve(distDir, 'icons');
      if (!existsSync(iconsDir)) {
        mkdirSync(iconsDir, { recursive: true });
      }
      
      [16, 32, 48, 128].forEach(size => {
        copyFileSync(
          resolve(__dirname, 'public', 'icons', `icon${size}.png`),
          resolve(iconsDir, `icon${size}.png`)
        );
      });
      
      // 生成popup.html
      const popupHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Translate</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 360px;
      min-height: 180px;
      background: #0a0e17;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./popup/main.js"></script>
</body>
</html>`;
      
      writeFileSync(resolve(distDir, 'popup.html'), popupHtml);
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyExtensionFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src', 'popup', 'main.js'),
      },
      output: {
        entryFileNames: 'popup/[name].js',
        chunkFileNames: 'popup/[name].js',
        assetFileNames: 'popup/[name].[ext]',
      },
    },
  },
});
