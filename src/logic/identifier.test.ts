import { describe, expect, it } from 'vitest'
import { isIdentifierLike } from './identifier'

describe('isIdentifierLike 标识符/路径排除', () => {
  // 应排除：文件名/目录名/路径
  it.each([
    'src', 'docs', 'components', '.github',           // 纯小写目录名
    'README.md', 'package.json', 'main.py', 'index.html', // 带扩展名
    'src/lib/utils', 'usr/local/bin',                  // 路径
    'node_modules', '.eslintrc',
    'LICENSE', 'CODEOWNERS', 'Makefile',               // 全大写/Pascal 无扩展名
    'user_name', 'MAX_SIZE', 'my_var',                 // snake_case
    'my-component', '--force', 'vue-tsc',              // kebab / CLI
    'Dockerfile', 'myComponent', 'GetStarted',         // camel/PascalCase
    'v1.2.0',                                          // 版本号（小写+点结尾规则）
  ])('排除标识符: %s', (t) => {
    expect(isIdentifierLike(t)).toBe(true)
  })

  // 应保留：正常短语/句子（含空白即视为短语）
  it.each([
    'Sign in',
    'Pull requests',
    'Getting started with the API',
    '本段应翻译成中文',
    'Settings',
    'Search or jump to...',
    'Mixture-of-Experts models are great', // 含空格：kebab 词出现在句中不算标识符
    'Star on GitHub please',
  ])('保留正常文本: %s', (t) => {
    expect(isIdentifierLike(t)).toBe(false)
  })

  it('超长无空白串不排除（压错位的整段文本）', () => {
    expect(isIdentifierLike('a'.repeat(80))).toBe(false)
  })
})
