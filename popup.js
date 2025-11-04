let allTabs = [];
let filteredTabs = [];
let historyResults = [];
let selectedIndex = 0;
let currentSort = 'recent';
let currentViewMode = 'large'; // 'compact', 'thumbnail', 'large'
let previewCache = new Map();
let intersectionObserver = null;
let debugMode = false;

const searchInput = document.getElementById('searchInput');
const tabsList = document.getElementById('tabsList');
const sortByUrlBtn = document.getElementById('sortByUrl');
const sortByTitleBtn = document.getElementById('sortByTitle');
const sortByRecentBtn = document.getElementById('sortByRecent');
const viewCompactBtn = document.getElementById('viewCompact');
const viewThumbnailBtn = document.getElementById('viewThumbnail');
const viewLargeBtn = document.getElementById('viewLarge');
const copyAllBtn = document.getElementById('copyAllBtn');
const closeAllBtn = document.getElementById('closeAllBtn');

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
      copyAllBtn.textContent = 'Copy All URLs';
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

// Initialize
async function init() {
  await loadTabs();
  setupIntersectionObserver();
  await loadSavedSortMode();
  await loadSavedViewMode();
  setupEventListeners();
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

// Load all tabs
async function loadTabs() {
  allTabs = await chrome.tabs.query({});
  filteredTabs = [...allTabs];
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

// Load preview for a specific tab
async function loadPreviewForTab(tabId, previewElement) {
  if (previewElement.dataset.loaded === 'true') return;
  previewElement.dataset.loaded = 'true';
  
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
      previewElement.innerHTML = '';
      previewElement.appendChild(img);
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
      previewElement.innerHTML = '';
      previewElement.appendChild(img);
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
}

// Show favicon as fallback
function showFavicon(tabId, previewElement) {
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab) {
    previewElement.innerHTML = '<div class="preview-placeholder">📄</div>';
    return;
  }
  
  previewElement.innerHTML = '';
  
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl;
    favicon.className = 'favicon-fallback';
    favicon.onerror = () => {
      previewElement.innerHTML = '<div class="preview-placeholder">🌐</div>';
    };
    previewElement.appendChild(favicon);
  } else {
    previewElement.innerHTML = '<div class="preview-placeholder">🌐</div>';
  }
  
  previewCache.set(tabId, null);
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
      break;
    case 'thumbnail':
      viewThumbnailBtn.classList.add('active');
      tabsList.classList.add('view-thumbnail');
      break;
    case 'large':
      viewLargeBtn.classList.add('active');
      tabsList.classList.add('view-large');
      break;
  }
  
  renderTabs();
}

// Render tabs list
async function renderTabs() {
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
  
  scrollToSelected();
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
    preview.innerHTML = '<div class="preview-loading">📄</div>';
    tabItem.appendChild(preview);
  }
  
  // Tab info
  const info = document.createElement('div');
  info.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Untitled';
  
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = tab.url || '';
  
  info.appendChild(title);
  info.appendChild(url);
  tabItem.appendChild(info);
  
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
    preview.innerHTML = '<div class="preview-placeholder">🕒</div>';
    item.appendChild(preview);
  }
  
  // History info
  const info = document.createElement('div');
  info.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = historyItem.title || 'Untitled';
  
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = historyItem.url || '';
  
  info.appendChild(title);
  info.appendChild(url);
  item.appendChild(info);
  
  // Click handler - open in new tab
  item.addEventListener('click', () => openHistoryItem(historyItem.url));
  
  return item;
}

// Open history item in new tab
async function openHistoryItem(url) {
  await chrome.tabs.create({ url });
  window.close();
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
    
    // Search history if few results
    if (filteredTabs.length < 3) {
      await searchHistory(query);
    } else {
      historyResults = [];
    }
  }
  
  selectedIndex = 0;
  applySortOrder();
  renderTabs();
}

// Calculate relevance score for fuzzy matching
// Search browser history
async function searchHistory(query) {
  try {
    const results = await chrome.history.search({
      text: query,
      maxResults: 10,
      startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
    });
    
    // Filter out URLs that are already in open tabs
    const openUrls = new Set(allTabs.map(t => t.url));
    historyResults = results
      .filter(item => !openUrls.has(item.url))
      .slice(0, 5);
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

  [sortByUrlBtn, sortByTitleBtn, sortByRecentBtn].forEach(btn =>
    btn.classList.remove('active')
  );

  switch (mode) {
    case 'url':
      sortByUrlBtn.classList.add('active');
      break;
    case 'title':
      sortByTitleBtn.classList.add('active');
      break;
    case 'recent':
    default:
      sortByRecentBtn.classList.add('active');
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
  window.close();
}

// Close tab
async function closeTab(tabId) {
  // Store the current selection index before closing
  const currentIndex = selectedIndex;
  
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
  
  renderTabs();
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
  
  // Action buttons
  copyAllBtn.addEventListener('click', copyAllUrls);
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
      window.close();
      break;
  }
}

// Start the extension
init();
