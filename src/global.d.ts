declare const __DEV__: boolean
declare const __NAME__: string
declare const __VERSION__: string

// Chrome 126+ 的 Selection API，TS 5.5 的 lib.dom 尚未收录
interface Selection {
  getComposedRanges(): StaticRange[]
}
