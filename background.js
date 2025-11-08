// Storage for tab screenshots
const screenshotCache = new Map();
const MAX_CACHE_SIZE = 100;
const CAPTURE_DELAY = 2000; // 2 seconds between captures
const TITLE_CACHE_STORAGE_KEY = 'tabHeroTitleCache';
let lastCaptureTime = 0;
let captureQueue = [];
let isProcessingQueue = false;
let displayMode = 'popup';
const titleCache = new Map();

initializeDisplayMode();
initializeTitleCache();

async function initializeDisplayMode() {
  try {
    const result = await chrome.storage.local.get(['displayMode']);
    const savedMode = result.displayMode;
    displayMode = savedMode === 'overlay' ? 'overlay' : 'popup';
  } catch (error) {
    displayMode = 'popup';
  }

  updateActionPresentation();
}

function updateActionPresentation() {
  if (displayMode === 'overlay') {
    chrome.action.setPopup({ popup: '' });
  } else {
    chrome.action.setPopup({ popup: 'popup.html' });
  }
}

async function initializeTitleCache() {
  try {
    const stored = await chrome.storage.local.get(TITLE_CACHE_STORAGE_KEY);
    const cached = stored[TITLE_CACHE_STORAGE_KEY];
    if (cached && typeof cached === 'object') {
      Object.entries(cached).forEach(([key, value]) => {
        const id = Number(key);
        if (!Number.isNaN(id) && typeof value === 'string' && value.trim().length > 0) {
          titleCache.set(id, value);
        }
      });
    }
  } catch (error) {
    // Ignore cache initialization failures
  }

  try {
    const tabs = await chrome.tabs.query({});
    let mutated = false;
    tabs.forEach((tab) => {
      if (tab?.id !== undefined && typeof tab.title === 'string') {
        const trimmed = tab.title.trim();
        if (trimmed.length > 0 && titleCache.get(tab.id) !== trimmed) {
          titleCache.set(tab.id, trimmed);
          mutated = true;
        }
      }
    });

    if (mutated) {
      persistTitleCache();
    }
  } catch (error) {
    // Ignore initial tab query failures
  }
}

function cacheTabTitle(tabId, title) {
  if (typeof title !== 'string') return;
  const trimmed = title.trim();
  if (!trimmed) return;

  const previous = titleCache.get(tabId);
  if (previous === trimmed) {
    return;
  }

  titleCache.set(tabId, trimmed);
  persistTitleCache();
}

function removeCachedTitle(tabId) {
  if (titleCache.delete(tabId)) {
    persistTitleCache();
  }
}

function persistTitleCache() {
  const payload = {};
  titleCache.forEach((value, key) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      payload[key] = value;
    }
  });

  if (Object.keys(payload).length === 0) {
    chrome.storage.local.remove(TITLE_CACHE_STORAGE_KEY).catch(() => {});
  } else {
    chrome.storage.local.set({ [TITLE_CACHE_STORAGE_KEY]: payload }).catch(() => {});
  }
}

async function toggleOverlay(targetTabId) {
  try {
    let tabId = targetTabId;

    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }

    if (!tabId) {
      return { success: false, error: 'NO_ACTIVE_TAB' };
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['overlay.js']
    });

    return { success: true };
  } catch (error) {
    console.error('Tab Hero overlay injection failed:', error);
    return { success: false, error: error.message };
  }
}

// Listen for the keyboard command
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-tab-manager") {
    if (displayMode === 'overlay') {
      toggleOverlay();
    } else {
      chrome.action.openPopup();
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (displayMode === 'overlay') {
    toggleOverlay(tab?.id);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.displayMode) {
    const newMode = changes.displayMode.newValue;
    displayMode = newMode === 'overlay' ? 'overlay' : 'popup';
    updateActionPresentation();
  }
});

// Capture screenshot when tab becomes active or is updated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  queueCapture(activeInfo.tabId);

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.title) {
      cacheTabTitle(activeInfo.tabId, tab.title);
    }
  } catch (error) {
    // Ignore tab lookup failures
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Capture when page finishes loading
  if (typeof changeInfo.title === 'string') {
    cacheTabTitle(tabId, changeInfo.title);
  } else if (changeInfo.status === 'complete' && tab?.title) {
    cacheTabTitle(tabId, tab.title);
  }

  if (changeInfo.status === 'complete' && tab?.active) {
    queueCapture(tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab?.id !== undefined && typeof tab.title === 'string' && tab.title.trim().length > 0) {
    cacheTabTitle(tab.id, tab.title);
  }
});

// Clean up cache when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  screenshotCache.delete(tabId);
  chrome.storage.local.remove(`screenshot_${tabId}`);
  removeCachedTitle(tabId);
  // Remove from queue if present
  captureQueue = captureQueue.filter(id => id !== tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const cachedTitle = titleCache.get(removedTabId);
  if (cachedTitle) {
    titleCache.set(addedTabId, cachedTitle);
    titleCache.delete(removedTabId);
    persistTitleCache();
  }
});

// Queue a tab for capture with rate limiting
function queueCapture(tabId) {
  if (!captureQueue.includes(tabId) && !screenshotCache.has(tabId)) {
    captureQueue.push(tabId);
    processQueue();
  }
}

// Process the capture queue with rate limiting
async function processQueue() {
  if (isProcessingQueue || captureQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (captureQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    
    // Rate limit: wait if we captured too recently
    if (timeSinceLastCapture < CAPTURE_DELAY) {
      await new Promise(resolve => setTimeout(resolve, CAPTURE_DELAY - timeSinceLastCapture));
    }
    
    const tabId = captureQueue.shift();
    await captureTabScreenshot(tabId);
    lastCaptureTime = Date.now();
  }
  
  isProcessingQueue = false;
}

// Capture screenshot of a tab
async function captureTabScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return;
    
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 70
    });
    
    // Store in memory cache
    screenshotCache.set(tabId, dataUrl);
    
    // Also store in chrome.storage for persistence
    await chrome.storage.local.set({
      [`screenshot_${tabId}`]: dataUrl
    });
    
    // Maintain cache size
    if (screenshotCache.size > MAX_CACHE_SIZE) {
      const firstKey = screenshotCache.keys().next().value;
      screenshotCache.delete(firstKey);
      chrome.storage.local.remove(`screenshot_${firstKey}`);
    }
  } catch (error) {
    // Silently fail - this is expected for many tabs
    // Don't log to avoid console spam
  }
}

// Message handler for popup to request screenshots
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCachedMetadata') {
    const metadata = {};
    if (Array.isArray(request.tabIds)) {
      request.tabIds.forEach((id) => {
        const numericId = Number(id);
        if (Number.isInteger(numericId)) {
          const cachedTitle = titleCache.get(numericId);
          if (cachedTitle) {
            metadata[numericId] = { title: cachedTitle };
          }
        }
      });
    }
    sendResponse({ metadata });
    return;
  }

  if (request.action === 'getScreenshot') {
    const screenshot = screenshotCache.get(request.tabId);
    if (screenshot) {
      sendResponse({ screenshot });
    } else {
      // Try to get from storage
      chrome.storage.local.get([`screenshot_${request.tabId}`]).then((result) => {
        sendResponse({ screenshot: result[`screenshot_${request.tabId}`] || null });
      });
    }
    return true; // Keep channel open for async response
  }

  if (request.action === 'openOverlay') {
    toggleOverlay().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// Initialize by capturing the currently active tab (just one to avoid rate limit)
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  if (tabs.length > 0) {
    queueCapture(tabs[0].id);
  }
});
