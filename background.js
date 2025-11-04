// Storage for tab screenshots
const screenshotCache = new Map();
const MAX_CACHE_SIZE = 100;
const CAPTURE_DELAY = 2000; // 2 seconds between captures
let lastCaptureTime = 0;
let captureQueue = [];
let isProcessingQueue = false;

// Listen for the keyboard command
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-tab-manager") {
    chrome.action.openPopup();
  }
});

// Capture screenshot when tab becomes active or is updated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  queueCapture(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Capture when page finishes loading
  if (changeInfo.status === 'complete' && tab.active) {
    queueCapture(tabId);
  }
});

// Clean up cache when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  screenshotCache.delete(tabId);
  chrome.storage.local.remove(`screenshot_${tabId}`);
  // Remove from queue if present
  captureQueue = captureQueue.filter(id => id !== tabId);
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
});

// Initialize by capturing the currently active tab (just one to avoid rate limit)
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  if (tabs.length > 0) {
    queueCapture(tabs[0].id);
  }
});
