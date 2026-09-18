// 标识符/文件路径样式检测：全文翻译的排除策略核心（纯函数，无 DOM 依赖）
// 目录名、文件名、变量名、常量名这类短文本翻成中文反而破坏语义
// （如 GitHub 目录文件列表的 src、package.json），整块跳过不译

// 常见仓库文件名：无扩展名且大小写形态抓不住的（Makefile/Dockerfile 无小写→大写转折）
const KNOWN_FILE_NAMES = /^(makefile|dockerfile|jenkinsfile|license|notice|authors|contributors|changelog|contributing|codeowners|security|funding|readme)$/i

/** 是否为标识符/路径样式的短文本（整块不翻译） */
export function isIdentifierLike(text: string): boolean {
  if (text.length > 64) return false
  if (/\s/.test(text)) return false                                  // 含空白视为正常短语
  if (KNOWN_FILE_NAMES.test(text)) return true
  if (/[/\\]/.test(text)) return true                                // 路径 src/lib/utils
  if (/\.\w{1,12}$/.test(text)) return true                          // 带扩展名 README.md / package.json
  if (/_/.test(text)) return true                                    // snake_case / SNAKE_CONST
  if (/-/.test(text) && /^[a-zA-Z0-9-]+$/.test(text)) return true    // kebab-case（含 CLI 选项 --force）
  if (/[a-z][A-Z]/.test(text) && /^[A-Za-z0-9]+$/.test(text)) return true // camel/PascalCase
  if (/^[a-z0-9.]+$/.test(text)) return true                         // 纯小写单词 src / docs / .github
  if (/^[A-Z0-9_]+$/.test(text)) return true                         // 全大写 LICENSE / CODEOWNERS
  return false
}
