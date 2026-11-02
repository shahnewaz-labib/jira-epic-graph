chrome.action.onClicked.addListener(tab => {
  if (!/^https:\/\/[^/]+\.atlassian\.net\//.test(tab.url || '')) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['graph.js'] });
});
