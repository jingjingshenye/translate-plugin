const fs = require('fs')

let p = fs.readFileSync('src/popup/Popup.vue', 'utf8')
const pAdd = "// 悬停翻译：按住修饰键滑过段落即翻译（内容脚本经 storage 实时感知）\nconst hoverSweep = useStorage<'alt' | 'ctrl' | 'shift' | 'off'>('qt_hover_sweep', 'alt')\n"
const pAnchor2 = "// 自动翻译本站（per-origin 记忆，站点名单存 qt_auto_sites）"
if (!p.includes(pAnchor2)) { console.log('P SCRIPT ANCHOR NOT FOUND'); process.exit(1) }
p = p.replace(pAnchor2, pAdd + pAnchor2)

const pRowOld = `      <label v-if="autoSiteOrigin" class="auto-site" :class="{ busy: autoSiteBusy }">`
const pRowNew = `      <div class="auto-site" style="align-items:center;gap:6px;">
        <span style="flex-shrink:0">悬停翻译：</span>
        <select v-model="hoverSweep" class="sel" style="flex:1;padding:2px 4px;font-size:11px">
          <option value="alt">按住 Alt，滑过段落即翻译</option>
          <option value="ctrl">按住 Ctrl，滑过段落即翻译</option>
          <option value="shift">按住 Shift，滑过段落即翻译</option>
          <option value="off">关闭悬停翻译</option>
        </select>
      </div>

      <label v-if="autoSiteOrigin" class="auto-site" :class="{ busy: autoSiteBusy }">`
if (!p.includes(pRowOld)) { console.log('P ROW NOT FOUND'); process.exit(1) }
p = p.replace(pRowOld, pRowNew)
fs.writeFileSync('src/popup/Popup.vue', p)
console.log('popup ok')

let o = fs.readFileSync('src/options/Options.vue', 'utf8')
const oAnchor = "const hoverTranslate = useStorage<'click' | 'hover'>('qt_hover_translate', 'click')"
const oAdd = oAnchor + "\nconst hoverSweep = useStorage<'alt' | 'ctrl' | 'shift' | 'off'>('qt_hover_sweep', 'alt')"
if (!o.includes(oAnchor)) { console.log('O SCRIPT ANCHOR NOT FOUND'); process.exit(1) }
o = o.replace(oAnchor, oAdd)

const oStyleRow = `          <div class="row">
            <label>双语样式</label>
            <select v-model="immersiveStyle">
              <option value="underline">下划线（默认）</option>
              <option value="dashed">虚线标记</option>
              <option value="quote">引用块</option>
              <option value="none">无样式纯文本</option>
            </select>
          </div>`
const oStyleRowNew = oStyleRow + `

          <div class="row">
            <label>悬停翻译</label>
            <select v-model="hoverSweep">
              <option value="alt">按住 Alt，鼠标滑过段落即翻译（默认）</option>
              <option value="ctrl">按住 Ctrl，鼠标滑过段落即翻译</option>
              <option value="shift">按住 Shift，鼠标滑过段落即翻译</option>
              <option value="off">关闭</option>
            </select>
          </div>`
if (!o.includes(oStyleRow)) { console.log('O STYLE ROW NOT FOUND'); process.exit(1) }
o = o.replace(oStyleRow, oStyleRowNew)
fs.writeFileSync('src/options/Options.vue', o)
console.log('options ok')
