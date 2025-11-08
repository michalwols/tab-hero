let allTabs = [];
let filteredTabs = [];
let historyResults = [];
let selectedIndex = 0;
let currentSort = 'recent';
let currentViewMode = 'large'; // 'compact', 'thumbnail', 'large'
let currentDisplayMode = 'popup'; // 'popup', 'overlay'
let previewCache = new Map();
let intersectionObserver = null;
let tabsResizeObserver = null;
let hasWindowResizeListener = false;
let pendingSizingFrame = null;
let debugMode = false;
let historyRange = '7';
const HISTORY_RANGE_OPTIONS = ['7', '30', 'all'];
const isOverlayContext = window.top !== window;
const LARGE_PREVIEW_ASPECT_RATIO = 9 / 16;
const LARGE_PREVIEW_MIN_HEIGHT = 200;

const searchInput = document.getElementById('searchInput');
const tabsList = document.getElementById('tabsList');
const sortByUrlBtn = document.getElementById('sortByUrl');
const sortByTitleBtn = document.getElementById('sortByTitle');
const sortByRecentBtn = document.getElementById('sortByRecent');
const viewCompactBtn = document.getElementById('viewCompact');
const viewThumbnailBtn = document.getElementById('viewThumbnail');
const viewLargeBtn = document.getElementById('viewLarge');
const copyAllBtn = document.getElementById('copyAllBtn');
const moveAllBtn = document.getElementById('moveAllBtn');
const closeAllBtn = document.getElementById('closeAllBtn');
const displayModePopupBtn = document.getElementById('displayModePopup');
const displayModeOverlayBtn = document.getElementById('displayModeOverlay');
const historyRangeButtons = Array.from(document.querySelectorAll('.history-range-btn'));

if (isOverlayContext && document.body) {
  document.body.classList.add('overlay-mode');
}

function closeUI() {
  if (isOverlayContext) {
    window.parent.postMessage({ type: 'TAB_HERO_CLOSE' }, '*');
  } else {
    window.close();
  }
}

window.addEventListener('message', (event) => {
  try {
    const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    if (event.origin !== extensionOrigin) {
      return;
    }
  } catch (error) {
    return;
  }

  if (event.data && event.data.type === 'TAB_HERO_FOCUS_SEARCH') {
    focusSearchInput();
  }
});

// Copy all filtered tab URLs as markdown
async function copyAllUrls() {
  if (filteredTabs.length === 0) {
    console.log('No tabs to copy');
    return;
  }
  
  // Create markdown list
  const markdown = filteredTabs.map(tab => {
    const title = tab.title || 'Untitled';
    const url = tab.url || '';
    return `- [${title}](${url})`;
  }).join('\n');
  
  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(markdown);
    
    // Visual feedback
    const originalText = copyAllBtn.textContent;
    copyAllBtn.textContent = '✓ Copied!';
    copyAllBtn.style.color = '#16a34a';
    
    setTimeout(() => {
      copyAllBtn.textContent = originalText;
      copyAllBtn.style.color = '';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    copyAllBtn.textContent = '✗ Failed';
    setTimeout(() => {
      copyAllBtn.textContent = 'Copy';
    }, 2000);
  }
}

// Close all filtered tabs
async function closeAllFilteredTabs() {
  if (filteredTabs.length === 0) {
    console.log('No tabs to close');
    return;
  }
  
  // Confirm if closing more than 5 tabs
  if (filteredTabs.length > 5) {
    const confirmed = confirm(`Close ${filteredTabs.length} tabs?`);
    if (!confirmed) return;
  }
  
  // Get all tab IDs
  const tabIds = filteredTabs.map(tab => tab.id);
  
  // Close all tabs
  try {
    await chrome.tabs.remove(tabIds);
    
    // Reload and reset
    await loadTabs();
    searchInput.value = '';
    await filterTabs();
  } catch (error) {
    console.error('Failed to close tabs:', error);
  }
}

async function moveAllFilteredTabs() {
  const movableTabs = filteredTabs.filter(tab => !tab.pinned);

  if (movableTabs.length === 0) {
    console.log('No tabs to move');
    return;
  }

  const [firstTab, ...remainingTabs] = movableTabs;

  try {
    const newWindow = await chrome.windows.create({ tabId: firstTab.id });

    if (newWindow && remainingTabs.length > 0) {
      await chrome.tabs.move(remainingTabs.map(tab => tab.id), {
        windowId: newWindow.id,
        index: -1
      });
    }

    if (newWindow) {
      await chrome.windows.update(newWindow.id, { focused: true });
    }

    await loadTabs();
    await filterTabs();
  } catch (error) {
    console.error('Failed to move tabs:', error);
  }
}

// Initialize
async function init() {
  await loadTabs();
  setupIntersectionObserver();
  setupResizeHandling();
  const continueInit = await loadSavedDisplayMode();
  if (!continueInit) {
    return;
  }
  await loadSavedSortMode();
  await loadSavedViewMode();
  await loadSavedHistoryRange();
  setupEventListeners();
  focusSearchInput();
}

// Load saved display mode and handle overlay fallback
async function loadSavedDisplayMode() {
  try {
    const result = await chrome.storage.local.get(['displayMode']);
    const savedMode = result.displayMode;
    currentDisplayMode = savedMode === 'overlay' ? 'overlay' : 'popup';
  } catch (error) {
    console.log('Could not load display mode:', error);
    currentDisplayMode = 'popup';
  }

  updateDisplayModeControls();

  if (!isOverlayContext && currentDisplayMode === 'overlay') {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'openOverlay' });
      if (result && result.success) {
        closeUI();
        return false;
      }
    } catch (error) {
      console.log('Could not open overlay:', error);
    }
  }

  return true;
}

// Load saved view mode from storage
async function loadSavedViewMode() {
  try {
    const result = await chrome.storage.local.get(['viewMode']);
    if (result.viewMode && ['compact', 'thumbnail', 'large'].includes(result.viewMode)) {
      currentViewMode = result.viewMode;
      setViewMode(currentViewMode);
    }
  } catch (error) {
    console.log('Could not load saved view mode:', error);
  }
}

// Load saved history range from storage
async function loadSavedHistoryRange() {
  try {
    const result = await chrome.storage.local.get(['historyRange']);
    const savedRange = result.historyRange;
    if (HISTORY_RANGE_OPTIONS.includes(savedRange)) {
      setHistoryRange(savedRange, { skipSave: true, skipFilter: true });
      return;
    }
  } catch (error) {
    console.log('Could not load history range:', error);
  }

  setHistoryRange('7', { skipSave: true, skipFilter: true });
}

// Load saved sort mode from storage
async function loadSavedSortMode() {
  try {
    const result = await chrome.storage.local.get(['sortMode']);
    const savedSort = result.sortMode;

    if (savedSort && ['url', 'title', 'recent'].includes(savedSort)) {
      setSortMode(savedSort, { skipSave: true });
    } else {
      setSortMode('recent', { skipSave: true });
    }
  } catch (error) {
    console.log('Could not load saved sort mode:', error);
    setSortMode('recent', { skipSave: true });
  }
}

function updateDisplayModeControls() {
  const isPopup = currentDisplayMode === 'popup';

  if (displayModePopupBtn) {
    displayModePopupBtn.classList.toggle('active', isPopup);
    displayModePopupBtn.setAttribute('aria-pressed', isPopup ? 'true' : 'false');
  }

  if (displayModeOverlayBtn) {
    displayModeOverlayBtn.classList.toggle('active', !isPopup);
    displayModeOverlayBtn.setAttribute('aria-pressed', !isPopup ? 'true' : 'false');
  }
}

async function setDisplayMode(mode) {
  const nextMode = mode === 'overlay' ? 'overlay' : 'popup';

  if (currentDisplayMode === nextMode) {
    updateDisplayModeControls();
    return;
  }

  currentDisplayMode = nextMode;
  updateDisplayModeControls();

  try {
    await chrome.storage.local.set({ displayMode: currentDisplayMode });
  } catch (error) {
    console.error('Failed to save display mode:', error);
  }

  if (!isOverlayContext && currentDisplayMode === 'overlay') {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'openOverlay' });
      if (result && result.success) {
        closeUI();
      }
    } catch (error) {
      console.log('Could not open overlay:', error);
    }
  } else if (isOverlayContext && currentDisplayMode === 'popup') {
    closeUI();
  }
}

// Load all tabs
async function loadTabs() {
  allTabs = await chrome.tabs.query({});
  await hydrateTabMetadata(allTabs);
  filteredTabs = [...allTabs];
}

async function hydrateTabMetadata(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return;
  }

  const tabIds = tabs
    .map((tab) => tab?.id)
    .filter((id) => typeof id === 'number');

  if (tabIds.length === 0) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getCachedMetadata',
      tabIds
    });

    const metadata = response?.metadata;
    if (!metadata) {
      return;
    }

    const metadataMap = new Map();
    Object.entries(metadata).forEach(([key, value]) => {
      const numericId = Number(key);
      if (!Number.isNaN(numericId)) {
        metadataMap.set(numericId, value);
      }
    });

    tabs.forEach((tab) => {
      const data = metadataMap.get(tab.id);
      if (data?.title && shouldUseCachedTitle(tab, data.title)) {
        tab.title = data.title;
        tab._tabHeroTitleFromCache = true;
      }
    });
  } catch (error) {
    console.log('Could not hydrate tab metadata:', error);
  }
}

function shouldUseCachedTitle(tab, cachedTitle) {
  if (typeof cachedTitle !== 'string') {
    return false;
  }

  const trimmedCachedTitle = cachedTitle.trim();
  if (!trimmedCachedTitle) {
    return false;
  }

  const currentTitle = (tab.title || '').trim();

  if (tab.discarded) {
    return true;
  }

  if (!currentTitle) {
    return true;
  }

  if (currentTitle === tab.url) {
    return true;
  }

  return false;
}

// Setup Intersection Observer for lazy loading
function setupIntersectionObserver() {
  intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const tabItem = entry.target;
        const tabId = parseInt(tabItem.dataset.tabId);
        const preview = tabItem.querySelector('.tab-preview');
        
        if (preview && !preview.dataset.loaded && currentViewMode !== 'compact') {
          loadPreviewForTab(tabId, preview);
        }
      }
    });
  }, {
    root: tabsList,
    rootMargin: '100px',
    threshold: 0.1
  });
}

function setupResizeHandling() {
  if (!tabsList) {
    return;
  }

  if (!hasWindowResizeListener) {
    window.addEventListener('resize', updateLargePreviewSizing);
    hasWindowResizeListener = true;
  }

  if (typeof ResizeObserver !== 'undefined') {
    if (tabsResizeObserver) {
      tabsResizeObserver.disconnect();
    }

    tabsResizeObserver = new ResizeObserver(() => {
      updateLargePreviewSizing();
    });

    tabsResizeObserver.observe(tabsList);
  }
}

function ensurePreviewContent(previewElement) {
  if (!previewElement) return null;

  let content = previewElement.querySelector('.tab-preview-content');
  if (content) {
    return content;
  }

  content = document.createElement('div');
  content.className = 'tab-preview-content';

  while (previewElement.firstChild) {
    content.appendChild(previewElement.firstChild);
  }

  previewElement.appendChild(content);
  return content;
}

function clearLargePreviewSizing() {
  const previews = tabsList.querySelectorAll('.tab-preview');
  previews.forEach(preview => {
    preview.style.removeProperty('height');
    preview.style.removeProperty('min-height');
    const tabItem = preview.closest('.tab-item');
    if (tabItem) {
      tabItem.style.removeProperty('min-height');
    }
  });
}

function queueLargePreviewSizing() {
  if (currentViewMode !== 'large') {
    return;
  }

  if (pendingSizingFrame !== null) {
    cancelAnimationFrame(pendingSizingFrame);
  }

  pendingSizingFrame = requestAnimationFrame(() => {
    pendingSizingFrame = requestAnimationFrame(() => {
      updateLargePreviewSizing();
      pendingSizingFrame = null;
    });
  });
}

function updateLargePreviewSizing() {
  if (currentViewMode !== 'large') {
    return;
  }

  const previews = tabsList.querySelectorAll('.tab-preview');

  previews.forEach(preview => {
    let width = preview.getBoundingClientRect().width;

    if (!width) {
      const tabItem = preview.closest('.tab-item');
      if (tabItem) {
        width = tabItem.getBoundingClientRect().width;
      }
    }

    if (!width) {
      width = tabsList.getBoundingClientRect().width;
    }

    if (!width) {
      return;
    }

    const height = Math.max(LARGE_PREVIEW_MIN_HEIGHT, Math.round(width * LARGE_PREVIEW_ASPECT_RATIO));
    preview.style.height = `${height}px`;
    preview.style.minHeight = `${height}px`;

    const tabItem = preview.closest('.tab-item');
    if (tabItem) {
      tabItem.style.minHeight = `${height}px`;
    }
  });
}

// Load preview for a specific tab
async function loadPreviewForTab(tabId, previewElement) {
  if (previewElement.dataset.loaded === 'true') return;
  previewElement.dataset.loaded = 'true';

  const previewContent = ensurePreviewContent(previewElement);
  if (!previewContent) return;
  
  const debugInfo = debugMode ? document.createElement('div') : null;
  if (debugInfo) {
    debugInfo.className = 'debug-info';
    debugInfo.textContent = 'Loading...';
  }
  
  // Check memory cache first
  if (previewCache.has(tabId)) {
    const cachedPreview = previewCache.get(tabId);
    if (cachedPreview) {
      if (debugInfo) debugInfo.textContent = '✓ Memory Cache';
      const img = document.createElement('img');
      img.src = cachedPreview;
      previewContent.innerHTML = '';
      previewContent.appendChild(img);
      if (debugInfo) previewElement.appendChild(debugInfo);
      return;
    } else {
      if (debugInfo) debugInfo.textContent = '✗ Cache: null';
      showFavicon(tabId, previewElement);
      if (debugInfo) previewElement.appendChild(debugInfo);
      return;
    }
  }
  
  // Try to get from background service cache
  try {
    if (debugInfo) debugInfo.textContent = 'Checking BG...';
    const response = await chrome.runtime.sendMessage({
      action: 'getScreenshot',
      tabId: tabId
    });
    
    if (response && response.screenshot) {
      if (debugInfo) debugInfo.textContent = '✓ Background Cache';
      previewCache.set(tabId, response.screenshot);
      const img = document.createElement('img');
      img.src = response.screenshot;
      previewContent.innerHTML = '';
      previewContent.appendChild(img);
      if (debugInfo) previewElement.appendChild(debugInfo);
      return;
    } else {
      if (debugInfo) debugInfo.textContent = '✗ No BG cache';
    }
  } catch (error) {
    console.log('Could not get screenshot from background:', error);
    if (debugInfo) debugInfo.textContent = '✗ BG Error';
  }
  
  // Final fallback to favicon
  if (debugInfo) debugInfo.textContent = '→ Favicon fallback';
  showFavicon(tabId, previewElement);
  if (debugInfo) previewElement.appendChild(debugInfo);
  queueLargePreviewSizing();
}

// Show favicon as fallback
function showFavicon(tabId, previewElement) {
  const tab = allTabs.find(t => t.id === tabId);
  const previewContent = ensurePreviewContent(previewElement);
  if (!previewContent) return;

  if (!tab) {
    if (currentViewMode === 'thumbnail') {
      renderThumbnailFavicon(previewElement, null);
    } else {
      previewContent.innerHTML = '<div class="preview-placeholder">📄</div>';
    }
    queueLargePreviewSizing();
    return;
  }
  
  if (currentViewMode === 'thumbnail') {
    renderThumbnailFavicon(previewElement, tab);
  } else {
    previewContent.innerHTML = '';
    
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
      const favicon = document.createElement('img');
      favicon.src = tab.favIconUrl;
      favicon.className = 'favicon-fallback';
      favicon.onerror = () => {
        previewContent.innerHTML = '<div class="preview-placeholder">🌐</div>';
      };
      previewContent.appendChild(favicon);
    } else {
      previewContent.innerHTML = '<div class="preview-placeholder">🌐</div>';
    }
  }
  
  previewCache.set(tabId, null);
  queueLargePreviewSizing();
}

function renderThumbnailFavicon(previewElement, tab) {
  const previewContent = ensurePreviewContent(previewElement);
  if (!previewContent) return;

  previewContent.innerHTML = '';

  if (tab && tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    const img = document.createElement('img');
    img.src = tab.favIconUrl;
    img.alt = '';
    img.className = 'thumbnail-favicon';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      previewContent.innerHTML = '<div class="thumbnail-favicon-placeholder">🌐</div>';
    };
    previewContent.appendChild(img);
  } else {
    previewContent.innerHTML = '<div class="thumbnail-favicon-placeholder">🌐</div>';
  }
  queueLargePreviewSizing();
}

// Set view mode
function setViewMode(mode) {
  currentViewMode = mode;
  
  // Save to storage
  chrome.storage.local.set({ viewMode: mode });
  
  // Update button states
  [viewCompactBtn, viewThumbnailBtn, viewLargeBtn].forEach(btn => 
    btn.classList.remove('active')
  );
  
  // Update tabs list class
  tabsList.className = 'tabs-list';
  
  switch (mode) {
    case 'compact':
      viewCompactBtn.classList.add('active');
      tabsList.classList.add('view-compact');
      clearLargePreviewSizing();
      break;
    case 'thumbnail':
      viewThumbnailBtn.classList.add('active');
      tabsList.classList.add('view-thumbnail');
      clearLargePreviewSizing();
      break;
    case 'large':
      viewLargeBtn.classList.add('active');
      tabsList.classList.add('view-large');
      queueLargePreviewSizing();
      break;
  }
  
  renderTabs();
}

// Render tabs list
async function renderTabs(options = {}) {
  const {
    preserveScroll = false,
    targetScrollTop = null,
    suppressAutoScroll = false
  } = options;
  // Disconnect observer before clearing
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }

  if (filteredTabs.length === 0 && historyResults.length === 0) {
    tabsList.innerHTML = '<div class="no-tabs">No tabs or history found</div>';
    return;
  }

  // Clear content but preserve classes
  const fragment = document.createDocumentFragment();
  
  // Render tabs section
  if (filteredTabs.length > 0) {
    const tabsHeader = document.createElement('div');
    tabsHeader.className = 'section-header';
    tabsHeader.textContent = `Open Tabs (${filteredTabs.length})`;
    fragment.appendChild(tabsHeader);
  }
  
  for (let i = 0; i < filteredTabs.length; i++) {
    const tab = filteredTabs[i];
    const tabItem = createTabElement(tab, i, false);
    fragment.appendChild(tabItem);
    
    // Observe for lazy loading
    if (currentViewMode !== 'compact' && intersectionObserver) {
      intersectionObserver.observe(tabItem);
    }
  }
  
  // Render history section
  if (historyResults.length > 0) {
    const historyHeader = document.createElement('div');
    historyHeader.className = 'section-header';
    historyHeader.textContent = `Recent History (${historyResults.length})`;
    fragment.appendChild(historyHeader);
    
    for (let i = 0; i < historyResults.length; i++) {
      const historyItem = historyResults[i];
      const itemIndex = filteredTabs.length + i;
      const historyElement = createHistoryElement(historyItem, itemIndex);
      fragment.appendChild(historyElement);
    }
  }
  
  // Clear and append all at once
  tabsList.innerHTML = '';
  tabsList.appendChild(fragment);

  if (preserveScroll && targetScrollTop !== null) {
    const maxScroll = Math.max(0, tabsList.scrollHeight - tabsList.clientHeight);
    tabsList.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
  }
  
  if (!suppressAutoScroll) {
    scrollToSelected();
  }

  if (currentViewMode === 'large') {
    queueLargePreviewSizing();
  }
}

// Create a tab element
function createTabElement(tab, index, isHistory) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  if (index === selectedIndex) {
    tabItem.classList.add('selected');
  }
  
  tabItem.dataset.tabId = tab.id;
  tabItem.dataset.index = index;

  // Only show preview in thumbnail and large modes
  if (currentViewMode !== 'compact') {
    const preview = document.createElement('div');
    preview.className = 'tab-preview';
    const previewContent = document.createElement('div');
    previewContent.className = 'tab-preview-content';
    previewContent.innerHTML = '<div class="preview-loading">📄</div>';
    preview.appendChild(previewContent);
    tabItem.appendChild(preview);

    if (currentViewMode === 'thumbnail') {
      renderThumbnailFavicon(preview, tab);
    }
  }
  
  // Tab info
  const info = document.createElement('div');
  info.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Untitled';
  
  const urlRow = document.createElement('div');
  urlRow.className = 'tab-url-row';
  
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = tab.url || '';
  urlRow.appendChild(url);

  const lastSeenText = formatRelativeTime(getTabLastActiveTime(tab));
  if (lastSeenText) {
    const lastSeen = document.createElement('div');
    lastSeen.className = 'tab-last-visited';
    lastSeen.textContent = lastSeenText;
    urlRow.appendChild(lastSeen);
  }
  
  info.appendChild(title);
  info.appendChild(urlRow);

  if (currentViewMode === 'compact') {
    const faviconWrapper = document.createElement('div');
    faviconWrapper.className = 'tab-favicon';

    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
      const faviconImg = document.createElement('img');
      faviconImg.src = tab.favIconUrl;
      faviconImg.alt = '';
      faviconImg.referrerPolicy = 'no-referrer';
      faviconImg.onerror = () => {
        faviconWrapper.classList.add('fallback');
        faviconWrapper.textContent = '🌐';
        faviconImg.remove();
      };
      faviconWrapper.appendChild(faviconImg);
    } else {
      faviconWrapper.classList.add('fallback');
      faviconWrapper.textContent = '🌐';
    }

    tabItem.appendChild(faviconWrapper);
  }

  tabItem.appendChild(info);

  if (!tab.pinned) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-close-button';
    closeBtn.setAttribute('aria-label', 'Close tab');
    closeBtn.title = 'Close tab';
    closeBtn.textContent = '×';

    const stop = (event) => {
      event.stopPropagation();
      event.preventDefault();
    };

    closeBtn.addEventListener('mousedown', stop);
    closeBtn.addEventListener('mouseup', stop);
    closeBtn.addEventListener('click', async (event) => {
      stop(event);
      const clickedIndex = parseInt(tabItem.dataset.index, 10);
      if (!Number.isNaN(clickedIndex)) {
        selectedIndex = clickedIndex;
      }
      await closeTab(tab.id);
    });

    tabItem.appendChild(closeBtn);
  }

  // Click handler
  tabItem.addEventListener('click', () => switchToTab(tab.id));

  return tabItem;
}

// Create a history element
function createHistoryElement(historyItem, index) {
  const item = document.createElement('div');
  item.className = 'tab-item history-item';
  if (index === selectedIndex) {
    item.classList.add('selected');
  }
  
  item.dataset.index = index;
  item.dataset.historyUrl = historyItem.url;

  // Show preview placeholder or favicon
  if (currentViewMode !== 'compact') {
    const preview = document.createElement('div');
    preview.className = 'tab-preview';
    const previewContent = document.createElement('div');
    previewContent.className = 'tab-preview-content';
    previewContent.innerHTML = '<div class="preview-placeholder">🕒</div>';
    preview.appendChild(previewContent);
    item.appendChild(preview);
  }
  
  // History info
  const info = document.createElement('div');
  info.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = historyItem.title || 'Untitled';
  
  const urlRow = document.createElement('div');
  urlRow.className = 'tab-url-row';
  
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = historyItem.url || '';
  urlRow.appendChild(url);

  const lastSeenText = formatRelativeTime(historyItem.lastVisitTime);
  if (lastSeenText) {
    const lastSeen = document.createElement('div');
    lastSeen.className = 'tab-last-visited';
    lastSeen.textContent = lastSeenText;
    urlRow.appendChild(lastSeen);
  }
  
  info.appendChild(title);
  info.appendChild(urlRow);
  item.appendChild(info);
  
  // Click handler - open in new tab
  item.addEventListener('click', () => openHistoryItem(historyItem.url));
  
  return item;
}

// Open history item in new tab
async function openHistoryItem(url) {
  await chrome.tabs.create({ url });
  closeUI();
}

// Filter tabs based on search
async function filterTabs() {
  const query = searchInput.value.toLowerCase().trim();
  
  if (!query) {
    filteredTabs = [...allTabs];
    historyResults = [];
  } else {
    // Split query into individual keywords
    const keywords = query.split(/\s+/).filter(w => w.length > 0);
    
    // Filter tabs - ALL keywords must be present in either title or URL
    filteredTabs = allTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      const combined = title + ' ' + url;
      
      // Check if ALL keywords are present
      return keywords.every(keyword => combined.includes(keyword));
    });
    
    // Always search history to surface matches even when many tabs match
    await searchHistory(query);
  }
  
  selectedIndex = 0;
  applySortOrder();
  renderTabs();
}

// Calculate relevance score for fuzzy matching
// Search browser history
async function searchHistory(query) {
  try {
    const searchOptions = {
      text: query,
      maxResults: historyRange === 'all' ? 100 : 20
    };
    
    const windowMs = getHistoryWindowMs(historyRange);
    if (windowMs !== null) {
      searchOptions.startTime = Date.now() - windowMs;
    } else if (historyRange === 'all') {
      searchOptions.startTime = 0; // Include full history
    }

    const results = await chrome.history.search(searchOptions);
    
    // Filter out URLs that are already in open tabs
    const openUrls = new Set(allTabs.map(t => t.url));
    historyResults = results
      .filter(item => !openUrls.has(item.url))
      .slice(0, 100);
  } catch (error) {
    console.error('History search failed:', error);
    historyResults = [];
  }
}

// Update sort mode and re-render
function setSortMode(mode, options = {}) {
  const { skipSave = false } = options;

  if (!['url', 'title', 'recent'].includes(mode)) {
    mode = 'recent';
  }

  currentSort = mode;

  if (!skipSave) {
    chrome.storage.local.set({ sortMode: mode });
  }
  
  [sortByUrlBtn, sortByTitleBtn, sortByRecentBtn].forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });

  switch (mode) {
    case 'url':
      sortByUrlBtn.classList.add('active');
      sortByUrlBtn.setAttribute('aria-pressed', 'true');
      break;
    case 'title':
      sortByTitleBtn.classList.add('active');
      sortByTitleBtn.setAttribute('aria-pressed', 'true');
      break;
    case 'recent':
    default:
      sortByRecentBtn.classList.add('active');
      sortByRecentBtn.setAttribute('aria-pressed', 'true');
      break;
  }

  applySortOrder();

  selectedIndex = 0;
  renderTabs();
}

// Navigate selection
function moveSelection(direction) {
  const totalItems = filteredTabs.length + historyResults.length;
  console.log('moveSelection called:', { direction, selectedIndex, totalItems });
  
  if (totalItems === 0) return;
  
  selectedIndex += direction;
  
  if (selectedIndex < 0) {
    selectedIndex = 0;
  } else if (selectedIndex >= totalItems) {
    selectedIndex = totalItems - 1;
  }
  
  console.log('New selectedIndex:', selectedIndex);
  updateSelection();
}

function updateSelection() {
  const items = tabsList.querySelectorAll('.tab-item');
  
  console.log('updateSelection called:', { selectedIndex, itemsCount: items.length });
  
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('selected');
      console.log('Added selected to item', index, item);
    } else {
      item.classList.remove('selected');
    }
  });
  
  scrollToSelected();
}

function scrollToSelected() {
  const selected = tabsList.querySelector('.tab-item.selected');
  console.log('scrollToSelected:', { selected, hasSelected: !!selected });
  
  if (selected) {
    console.log('Scrolling to:', selected);
    
    // Use scrollIntoView
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    
    // Alternative: manual scroll calculation as fallback
    const listRect = tabsList.getBoundingClientRect();
    const itemRect = selected.getBoundingClientRect();
    
    console.log('Scroll positions:', {
      listTop: listRect.top,
      listBottom: listRect.bottom,
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom
    });
    
    // Check if item is outside viewport
    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      const scrollOffset = itemRect.top - listRect.top - (listRect.height / 2) + (itemRect.height / 2);
      tabsList.scrollBy({ top: scrollOffset, behavior: 'smooth' });
    }
  } else {
    console.warn('No selected item found for scrolling');
  }
}

// Switch to tab
async function switchToTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  closeUI();
}

// Close tab
async function closeTab(tabId) {
  // Store the current selection index before closing
  const currentIndex = selectedIndex;
  const previousScrollTop = tabsList.scrollTop;
  
  await chrome.tabs.remove(tabId);
  await loadTabs();
  
  // Re-apply filters without resetting selectedIndex
  const query = searchInput.value.toLowerCase().trim();
  
  if (!query) {
    filteredTabs = [...allTabs];
    historyResults = [];
  } else {
    // Split query into individual keywords
    const keywords = query.split(/\s+/).filter(w => w.length > 0);
    
    // Filter tabs - ALL keywords must be present in either title or URL
    filteredTabs = allTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      const combined = title + ' ' + url;
      
      // Check if ALL keywords are present
      return keywords.every(keyword => combined.includes(keyword));
    });
    
    if (filteredTabs.length < 3) {
      await searchHistory(query);
    } else {
      historyResults = [];
    }
  }
  
  // Re-apply the current sort order
  applySortOrder();
  
  // Maintain selection position after closing
  const totalItems = filteredTabs.length + historyResults.length;
  if (currentIndex >= totalItems && totalItems > 0) {
    selectedIndex = totalItems - 1;
  } else {
    selectedIndex = currentIndex;
  }
  
  renderTabs({
    preserveScroll: true,
    targetScrollTop: previousScrollTop,
    suppressAutoScroll: true
  });
}

// Apply the current sort order to filteredTabs
function applySortOrder() {
  switch (currentSort) {
    case 'url':
      filteredTabs.sort((a, b) => (a.url || '').localeCompare(b.url || ''));
      break;
    case 'title':
      filteredTabs.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'recent':
    default:
      filteredTabs.sort((a, b) => {
        const aTime = typeof a.lastAccessed === 'number' ? a.lastAccessed : 0;
        const bTime = typeof b.lastAccessed === 'number' ? b.lastAccessed : 0;

        if (bTime !== aTime) {
          return bTime - aTime;
        }

        return (b.id || 0) - (a.id || 0);
      });
      break;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Search input
  searchInput.addEventListener('input', filterTabs);
  
  // View mode buttons
  viewCompactBtn.addEventListener('click', () => setViewMode('compact'));
  viewThumbnailBtn.addEventListener('click', () => setViewMode('thumbnail'));
  viewLargeBtn.addEventListener('click', () => setViewMode('large'));

  if (displayModePopupBtn) {
    displayModePopupBtn.addEventListener('click', () => setDisplayMode('popup'));
  }

  if (displayModeOverlayBtn) {
    displayModeOverlayBtn.addEventListener('click', () => setDisplayMode('overlay'));
  }
  
  // Keyboard navigation - single handler for all keys
  document.addEventListener('keydown', async (e) => {
    // Debug mode toggle (Ctrl/Cmd + D)
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      debugMode = !debugMode;
      console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
      renderTabs();
      return;
    }
    
    // Handle navigation
    await handleKeyPress(e);
  });
  
  // Sort buttons
  sortByUrlBtn.addEventListener('click', () => setSortMode('url'));
  sortByTitleBtn.addEventListener('click', () => setSortMode('title'));
  sortByRecentBtn.addEventListener('click', () => setSortMode('recent'));

  historyRangeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      setHistoryRange(range);
    });
  });
  
  // Action buttons
  copyAllBtn.addEventListener('click', copyAllUrls);
  moveAllBtn.addEventListener('click', moveAllFilteredTabs);
  closeAllBtn.addEventListener('click', closeAllFilteredTabs);
}

// Handle keyboard navigation
async function handleKeyPress(e) {
  const totalItems = filteredTabs.length + historyResults.length;
  if (totalItems === 0) return;
  
  // Don't handle arrow keys if user is typing in search (except for escape)
  if (document.activeElement === searchInput && e.key !== 'Escape') {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
      return;
    }
  }
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(1);
      break;
      
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-1);
      break;
      
    case 'ArrowLeft':
      e.preventDefault();
      // Only close tabs, not history items
      if (selectedIndex < filteredTabs.length) {
        const tabToClose = filteredTabs[selectedIndex];
        if (tabToClose) {
          await closeTab(tabToClose.id);
        }
      }
      break;
      
    case 'ArrowRight':
    case 'Enter':
      e.preventDefault();
      if (selectedIndex < filteredTabs.length) {
        // Switch to tab
        const tabToSwitch = filteredTabs[selectedIndex];
        if (tabToSwitch) {
          await switchToTab(tabToSwitch.id);
        }
      } else {
        // Open history item
        const historyIndex = selectedIndex - filteredTabs.length;
        if (historyIndex < historyResults.length) {
          await openHistoryItem(historyResults[historyIndex].url);
        }
      }
      break;
      
    case 'Escape':
      e.preventDefault();
      closeUI();
      break;
  }
}

// Start the extension
init();
function focusSearchInput() {
  if (document.activeElement === searchInput) {
    return;
  }

  if (searchInput) {
    searchInput.focus({ preventScroll: true });
    searchInput.select();
  }
}

function setHistoryRange(range, options = {}) {
  const { skipSave = false, skipFilter = false } = options;
  if (!HISTORY_RANGE_OPTIONS.includes(range)) {
    range = '7';
  }

  historyRange = range;

  historyRangeButtons.forEach((btn) => {
    const isActive = btn.dataset.range === range;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  if (!skipSave) {
    chrome.storage.local.set({ historyRange: range });
  }

  if (!skipFilter && searchInput.value.trim()) {
    filterTabs();
  }
}

function getHistoryWindowMs(range) {
  switch (range) {
    case '30':
      return 30 * 24 * 60 * 60 * 1000;
    case '7':
      return 7 * 24 * 60 * 60 * 1000;
    case 'all':
    default:
      return null;
  }
}

function getTabLastActiveTime(tab) {
  if (!tab || typeof tab !== 'object') {
    return null;
  }

  if (typeof tab.lastAccessed === 'number') {
    return tab.lastAccessed;
  }

  if (typeof tab.lastModified === 'number') {
    return tab.lastModified;
  }

  if (typeof tab.lastUpdated === 'number') {
    return tab.lastUpdated;
  }

  return null;
}

function formatRelativeTime(timestamp) {
  if (typeof timestamp !== 'number' || Number.isNaN(timestamp) || timestamp <= 0) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return '';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 30) {
    return 'just now';
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}y ago`;
}
