import 'uno.css'

// 全局基础样式
const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
`
document.head.appendChild(style)
