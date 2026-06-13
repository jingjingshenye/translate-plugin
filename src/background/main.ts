chrome.runtime.onInstalled.addListener(() => {
  createContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
  createContextMenus()
})

function createContextMenus() {
  chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译所选文本',
    contexts: ['selection'],
  })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'translate-text',
      text: info.selectionText,
    }).catch(() => {})
  }
})
