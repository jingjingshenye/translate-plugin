browser.runtime.onInstalled.addListener(() => {
  console.log('[Quick Translate] installed')
  createContextMenus()
})

browser.runtime.onStartup.addListener(() => {
  createContextMenus()
})

function createContextMenus() {
  browser.contextMenus.removeAll()
  browser.contextMenus.create({
    id: 'translate-selection',
    title: '翻译所选文本',
    contexts: ['selection'],
  })
}

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    // 向 content script 发送翻译指令
    browser.tabs.sendMessage(tab!.id!, {
      type: 'translate-text',
      text: info.selectionText,
    }).catch(() => {
      // content script 可能未加载
    })
  }
})
