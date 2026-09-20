# Changelog

## 1.5.4

### 功能
- **悬停翻译（业界交互）**：按住 Alt（可改 Ctrl/Shift）+ 鼠标滑过段落即出译文；也支持悬停后按快捷键触发。不依赖文本选择，user-select:none 的区域、无法选中文字的场景均可使用。修饰键状态直接读自鼠标事件本身（getModifierState），从实现上杜绝了旧版悬停功能的按键卡死问题；全程不修改页面元素样式
- 弹窗与设置页均可选择触发键或关闭
## 1.5.6

### 健壮性
- 悬停翻译的 UI 容器被宿主页面整体替换时自动重挂载（此前静默失联）
- 强制收集的排除表改为参数传递，消除模块级状态副作用；exitIdle 时同步停止路由轮询
- 悬停组合键判定加物理键 e.code（非 QWERTY 布局一致），收起操作忽略 Shift 误触

### 修复
- **悬停翻译覆盖按钮/链接/无语义标签**：悬停目标列表补充 button/a/label/code 与 ARIA role（button/tab），并增加无语义标签兜底爬升（div/span 直接包字，向上最多 4 层）；强制收集路径允许 BUTTON 文案（按钮普遍 user-select:none 且常需翻译）
- **悬停翻译触发键改为组合键 Alt+Y**：单击 Alt 会被 Windows Chrome 拿去聚焦浏览器「⋮」菜单，页面收不到按键（用户实测确认）。现默认 Alt+Y，另可选 Ctrl+Shift+Y 或关闭；图标按组合键切换呼出/收起，位置在光标处（此前定位到块元素角落，嵌套大容器时会跑到远处）
- 触发时若焦点在输入框/编辑器中则不触发，避免干扰打字
## 1.5.5

### 变更
- **悬停翻译交互调整**：移除「按住 Alt 滑过段落即注入译文」（内联注入会改变页面布局，干扰阅读），改为**按 Alt 在鼠标处呼出翻译图标，点击图标在弹窗中翻译**——零页面注入、不干扰布局；user-select:none 等无法选中文字的场景同样可用。触发键固定为 Alt，开关在弹窗/设置页（默认关闭）
## 1.5.3

### 修复
- **划词弹窗在非安全上下文页面（http 站点等）告警循环与错误 Key**：内容脚本环境可能没有 crypto.subtle，此前在划词弹窗内做 Key 加解密会持续报错，且解密失败时把密文当 Key 发送给引擎。现 Key 的解析统一移至 background 安全上下文（内容脚本不再传输/处理 Key），划词弹窗移除 Key 相关逻辑
- 沉浸式翻译 createPanel 增加 body 空值防护（个别页面生命周期边缘触发时抛未捕获异常）
## 1.5.2

### 修复
- **备用切换可感知**：沉浸式翻译的备用源结果此前完全静默，现面板与弹窗进度显示「备用 N 段」统计
- **快捷键/右键菜单/自动本站静默失败**：所选引擎未配置 Key/URL 时不再无反应，自动降级到默认免费引擎完成翻译（控制台留有降级日志）；不可注入页面（chrome:// 等）触发失败时图标角标红色「!」提示 3 秒
- 自动翻译本站：弹窗勾选开启后立即触发「翻译全部」，与重载后的自动行为语义一致
### 性能

- **补扫增量优化**：动态补扫从整页遍历改为只扫变更子树（变更根超 40 个自动退化为全页），大页面（数千节点）上单次补扫开销下降一个数量级以上
- 补扫改用 requestIdleCallback 调度，避开页面自身任务高峰
- SPA 路由轮询定时器仅在翻译会话进行中运行，空闲页面零常驻定时器
## 1.5.1

### 移除
- Alt 悬停强制翻译功能（含悬停高亮线框与十字光标）：实际使用中高亮会意外驻留（如 Alt+Tab 切窗后 keyup 丢失），线框和光标样式对页面干扰明显，整体移除；被排除规则跳过的内容仍可通过弹窗/设置中的自定义排除选择器调整

## 1.5.0

### 修复
- **Bing 词典在 production 从未生效**：bingDict 使用 DOMParser，而 MV3 service worker 无此 API（实测 `typeof DOMParser === 'undefined'`），ReferenceError 被静默吞掉导致 Bing 音标/例句/发音数据一直为空。现按需创建 offscreen document（`chrome.offscreen`，DOM_PARSER reason）完成 HTML 解析，管线经消息往返验证打通
- AI 翻译引擎（OpenAI 兼容/Gemini/Claude/DeepL）补 HTTP 状态检查：此前 401/429 直接变成笼统的"解析失败"；现在错误信息带真实状态码与 body 详情，429 也纳入退避重试；Claude max_tokens 1024→4096（长文本不再截断）

### 功能
- 划选即译：新增「划选后自动弹出译文」模式（设置 → 划词行为），免点击直接出结果
- 双语样式：下划线/虚线/引用块/无样式四种译文样式（弹窗与设置页可选，随会话下发）
- 自动翻译本站：弹窗一键开关（per-origin 记忆），名单内站点打开页面即自动翻译；关闭即取消当前会话
- 悬停即译：Alt+悬停 0.5 秒自动翻译，可在点击/悬停两种模式间切换（设置 → 沉浸式翻译）
- 查词自动朗读：翻译完成后自动朗读译文（设置 → 划词行为）

### 可靠性
- 免费引擎限流与 429 退避：同引擎请求强制最小间隔（350ms）防打爆免费端点；命中 429 时按 Retry-After / 指数退避自动重试（最多 2 次），替代直接计失败
- 失败段一键重试：翻译完成后面板出现「重试N失败」按钮，把失败段重新入队再翻
- 页面语言检测升级：优先 chrome.i18n 的 CLD 检测（更准的 zh/ja/en 区分），不可用时回退字符启发式

### 功能
- 快捷键全文翻译：Alt+Shift+T 触发/取消（可在 chrome://extensions/shortcuts 改键）；右键菜单新增「全文翻译整个页面」——两者均由 background 直接从存储组装引擎配置，无需打开弹窗
- SPA 路由自动续翻：翻译会话进行中发生 SPA 路由切换，自动用同一配置重新收集翻译新页面内容（此前只会清除）
- 悬停强制翻译：按住 Alt 悬停高亮块级元素，Alt+点击绕过一切排除规则翻译该元素（排除规则误杀内容的逃生通道，对标沉浸式翻译的悬停翻译）

### 性能
- content script 按需拆包：bootstrap（触发逻辑+全文翻译控制器）从 105KB 降到 29KB（-72%），划词 UI（Vue）分包在首次使用时经 web_accessible_resources 动态加载，所有页面/iframe 的脚本解析开销大幅下降

### 工程
- 排除策略核心 isIdentifierLike 提取到 logic/identifier.ts 并新增 34 个单测（含 Makefile/Dockerfile 等边界）
- useEncryptedKeys 同 key 单例化：popup 中 apiKeys/immersiveKeys 双实例曾存在防抖写竞态
- 清理：腾讯云签名 fetch 移除无效 Host 头；App.vue 移除未开放语言的死映射；历史导出复用防御性取值；设置页同步最新的内置排除规则与使用说明；Key 解密失败增加告警日志

## 1.3.0

### 修复
- SPA 流式渲染页面（如 build.nvidia.com）触发翻译"没反应"：此类页面从打开到内容可见需要数秒到数十秒（水合完成前 DOM 里有文本但全部不可见），旧逻辑触发时一次性收集文本，收不到就静默退出。现触发时若无可翻译内容会保持翻译态等待页面首波内容出现后自动开始翻译（最长 15 秒），等待期在页面面板与 popup 明确提示"等待页面内容加载…"，超时则提示"未找到可翻译内容"而非无反馈
- 排除规则误杀正文：裸 `header`/`footer`/`nav` 选择器会命中卡片、手风琴等组件内部的语义标签（实测 build.nvidia.com 40+ 个 FAQ/步骤内容块被跳过），改为结构化判断——仅当不在 `main`/`article`/`section` 等正文容器内时才视为站点装饰；`[role=…]` 规则保留
- `[class*="ad-"]` 会命中 `download-`/`read-` 等类名，收紧为类名 token 以 `ad-`/`ads-` 开头

### 功能
- 动态补翻：翻译会话期间常驻 MutationObserver 监听新增节点，防抖 1.2s 后增量重扫（已翻译块自动跳过、不会重复翻译）。滚动懒加载、SPA 路由内更新、水合晚到的内容都会自动补翻，与 TWP/沉浸式翻译的成熟做法对齐
- popup 同步展示等待/提示信息（跟随沉浸式进度消息）

### 全文翻译排除策略（对标友商）
- 代码块一律不翻：原逻辑依赖 language class 标注，无标注的代码块（如 GitHub blob）照样被翻译。现 PRE/CODE/SAMP/KBD/VAR/TT 内容整体跳过，行内 `code`（如句中的 `npm run dev`）也保持原样
- 标识符/文件名启发式：纯小写单词（src、docs）、带扩展名（README.md、package.json）、路径（src/lib）、snake_case/kebab-case/camelCase、全大写常量（LICENSE）等独立短块不再翻译——任何站点的目录文件列表通用，不限于 GitHub
- 数据网格语义排除：`[role="grid"]`（GitHub 目录列表正是该语义）内的内容跳过
- GitHub 代码视图容器：`.react-code-lines`/`.blob-code`/`.blob-wrapper`
- 网页内嵌代码编辑器：`.CodeMirror`/`.cm-editor`/`.monaco-editor`（渲染产物为 span 碎片，翻译必乱）
- 图标字体：`.material-icons`/`.material-symbols-outlined`（连字文字被"翻译"会变成乱码）
- W3C/Google 标准机制：`translate="no"` 属性与 `notranslate` class 的区域不再翻译（Google 翻译、TWP、沉浸式翻译均遵循该约定）

### 划词翻译
- iframe 内划词无反应：content script 原本只注入主 frame，iframe 内的 mouseup 不会冒泡到父文档。现注入所有 frame（all_frames），iframe 内划词由 iframe 自己的 content script 显示翻译 icon；同源 iframe 的全文翻译仍由顶层统一收集，不会出两份译文
- 键盘选区（Shift+方向键 / Ctrl+A）不出现 icon：新增 selectionchange 兜底监听（300ms 防抖），不依赖 mouseup
- 页面在捕获阶段拦截 mouseup 导致 icon 不出现：mouseup 改为捕获阶段监听 + selectionchange 兜底双路径
- 旧内核浏览器（无 Selection.getComposedRanges，Chrome 131 前不存在）划词全挂：调用处加了存在性检查并回退 getRangeAt(0)

## 1.2.0

### 修复
- 存储层根因修复：chrome.storage 序列化会把 Vue Proxy 数组降级为对象，导致所有数组类设置（备用源黑名单/翻译历史/跳过语言）从未持久化成功，并引发 `filter is not a function` 崩溃；写入前纯数据拷贝 + 坏数据自动恢复 + 回声抑制（set→onChanged→watch→set 无限循环）
- 划词弹窗「复制」按钮缺失（copyText 未定义）
- popup 加载动画 keyframes 未引入（spinner 静止）
- 混合词典模式的 Bing 补充数据因 background 序列化时序从未到达 UI
- SPA 路由检测失效（isolated world 包装 pushState 无效，改 popstate+hashchange+轮询）
- 日文划词被误判为中文不显示图标（假名检测优先于汉字比例）
- 密码框划词会把明文密码发送到翻译服务并写入历史（已跳过）
- 多 tab 沉浸式翻译进度串台；取消翻译不真正中止在途请求

### 翻译源
- 微软免费翻译回归：迁移至 Edge 免认证端点 /translate/translatetext（旧 /translate/auth 已于 2025-08 下线）；支持批量，from 仅 en（其余语言自动备用切换）
- 新增微软 Azure 官方源（每月 200 万字符免费，Key[:Region]）
- DeepL Free 批量合并请求；AI prompt 统一并保留原文格式
- 免费源连通性测试卡片（逐源直连验证）
- AI 源免费额度标注（经调查核实）+ 注册直达 + Key 连通性测试

### 功能
- AI 对照翻译：划词时并行请求已配置 Key 的 AI 源，独立显示（自动/指定/关闭）
- 备用源（fallback）黑名单 + 「备用」标记；fallback 从最近成功源开始；熔断器（连续失败 60s 跳过）
- 翻译历史（去重、上限 100 条、导出）；收藏按钮语义修正（哪个成功收藏哪个）
- 译文朗读（浏览器 speechSynthesis）；沉浸式独立目标语言 + 页面语言检测跳过
- 暗色模式（popup/设置页/页面内弹窗/沉浸式面板，跟随系统）

### 工程
- TypeScript 工具链补全（vue-tsc 类型检查 0 错误）+ vitest 47 个单测（含 Chrome storage 序列化行为模拟的回归防护）
- GitHub Actions CI（typecheck + test + build）；npm run release 一键打包；版本号单一来源（package.json → manifest/页面）
- manifest 权限收紧（移除未用的 activeTab 与 web_accessible_resources）；移除死依赖
- content script 空闲挂载 + 首次交互兜底；批量翻译 3 并发 worker；walker Element 级缓存
