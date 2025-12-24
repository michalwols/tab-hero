let allTabs = [];
let filteredTabs = [];
let historyResults = [];
let selectedIndex = 0;
let currentSort = 'recent';
let currentDisplayMode = 'overlay'; // forced overlay mode
let debugMode = false;
let historyRange = '7';
let historyResultsLimit = 100;
let darkMode = false;

// Tree view state
let treeViewEnabled = false;
let groupByWindowEnabled = false;
let tabTree = [];
let flattenedTree = [];

// Selection state
let selectedTabIds = new Set();
let lastSelectedIndex = null;

const HISTORY_RANGE_OPTIONS = ['7', '30', 'all'];
const HISTORY_RESULTS_LIMIT_OPTIONS = [25, 50, 100];
const isOverlayContext = window.top !== window;

const searchInput = document.getElementById('searchInput');
const tabsList = document.getElementById('tabsList');
const sortByUrlBtn = document.getElementById('sortByUrl');
const sortByTitleBtn = document.getElementById('sortByTitle');
const sortByRecentBtn = document.getElementById('sortByRecent');
const copyAllBtn = document.getElementById('copyAllBtn');
const moveAllBtn = document.getElementById('moveAllBtn');
const closeAllBtn = document.getElementById('closeAllBtn');
const displayModePopupBtn = document.getElementById('displayModePopup');
const displayModeOverlayBtn = document.getElementById('displayModeOverlay');
const historyRangeButtons = Array.from(document.querySelectorAll('.history-range-btn'));
const historyLimitButtons = Array.from(document.querySelectorAll('.history-limit-btn'));
const viewFlatBtn = document.getElementById('viewFlat');
const viewTreeBtn = document.getElementById('viewTree');
const groupOffBtn = document.getElementById('groupOff');
const groupByWindowBtn = document.getElementById('groupByWindow');
const themeToggleBtn = document.getElementById('themeToggle');

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

window.addEventListener('message', async (event) => {
  try {
    const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    if (event.origin !== extensionOrigin) {
      return;
    }
  } catch (error) {
    return;
  }

  if (event.data && event.data.type === 'TAB_HERO_FOCUS_SEARCH') {
    await refreshTabs();
    focusSearchInput();
  }
});

// Refresh tabs when page becomes visible (handles returning to old tab)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    await refreshTabs();
  }
});

// Handle tab selection with modifier keys
function handleTabSelection(tabId, index, event) {
  if (event.shiftKey && lastSelectedIndex !== null) {
    // Shift+click: select range
    const start = Math.min(lastSelectedIndex, index);
    const end = Math.max(lastSelectedIndex, index);

    // Get all tabs in range
    const tabsInRange = getTabsInIndexRange(start, end);
    tabsInRange.forEach(tab => selectedTabIds.add(tab.id));
  } else if (event.metaKey || event.ctrlKey) {
    // Cmd/Ctrl+click: toggle individual
    if (selectedTabIds.has(tabId)) {
      selectedTabIds.delete(tabId);
    } else {
      selectedTabIds.add(tabId);
    }
    lastSelectedIndex = index;
  } else {
    // Regular click: toggle individual
    if (selectedTabIds.has(tabId)) {
      selectedTabIds.delete(tabId);
    } else {
      selectedTabIds.add(tabId);
    }
    lastSelectedIndex = index;
  }
  updateSelectionUI();
}

// Get tabs in index range for shift+click
function getTabsInIndexRange(start, end) {
  const tabs = [];
  if (treeViewEnabled || groupByWindowEnabled) {
    for (let i = start; i <= end; i++) {
      const item = flattenedTree[i];
      if (item) {
        tabs.push(item.tab || item);
      }
    }
  } else {
    for (let i = start; i <= end; i++) {
      if (filteredTabs[i]) {
        tabs.push(filteredTabs[i]);
      }
    }
  }
  return tabs;
}

// Update UI to reflect selection state
function updateSelectionUI() {
  // Update tab items
  const tabItems = tabsList.querySelectorAll('.tab-item[data-tab-id]');
  tabItems.forEach(item => {
    const tabId = parseInt(item.dataset.tabId, 10);
    const checkbox = item.querySelector('.tab-checkbox');
    if (selectedTabIds.has(tabId)) {
      item.classList.add('checked');
      if (checkbox) checkbox.checked = true;
    } else {
      item.classList.remove('checked');
      if (checkbox) checkbox.checked = false;
    }
  });

  // Update button labels to show selection count
  updateActionButtonLabels();
}

// Update action button labels (placeholder for future use)
function updateActionButtonLabels() {
  // Buttons keep static labels - no counts shown
}

// Get tabs to operate on (selected or all filtered)
function getTargetTabs() {
  if (selectedTabIds.size > 0) {
    return filteredTabs.filter(tab => selectedTabIds.has(tab.id));
  }
  return filteredTabs;
}

// Clear selection
function clearSelection() {
  selectedTabIds.clear();
  lastSelectedIndex = null;
  updateActionButtonLabels();
}

// Refresh tab data and re-render
async function refreshTabs() {
  const previousScrollTop = tabsList.scrollTop;
  await loadTabs();

  // Clean up stale selections (tabs that no longer exist)
  const currentTabIds = new Set(allTabs.map(t => t.id));
  for (const id of selectedTabIds) {
    if (!currentTabIds.has(id)) {
      selectedTabIds.delete(id);
    }
  }
  updateActionButtonLabels();

  applySortOrder();

  // Re-apply search filter if active
  const query = searchInput.value.toLowerCase().trim();
  if (query) {
    const keywords = query.split(/\s+/).filter(w => w.length > 0);
    filteredTabs = allTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      const combined = title + ' ' + url;
      return keywords.every(keyword => combined.includes(keyword));
    });
  } else {
    filteredTabs = [...allTabs];
  }

  applySortOrder();

  // Maintain selection if possible
  const tabCount = getTabCount();
  const totalItems = tabCount + historyResults.length;
  if (selectedIndex >= totalItems && totalItems > 0) {
    selectedIndex = totalItems - 1;
  }

  renderTabs({
    preserveScroll: true,
    targetScrollTop: previousScrollTop,
    suppressAutoScroll: true
  });
}

// Copy tab URLs as markdown
async function copyAllUrls() {
  const targetTabs = getTargetTabs();
  if (targetTabs.length === 0) {
    console.log('No tabs to copy');
    return;
  }

  // Create markdown list
  const markdown = targetTabs.map(tab => {
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

    // Clear selection after successful copy
    clearSelection();

    setTimeout(() => {
      updateActionButtonLabels();
      copyAllBtn.style.color = '';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    copyAllBtn.textContent = '✗ Failed';
    setTimeout(() => {
      updateActionButtonLabels();
    }, 2000);
  }
}

// Close tabs (selected or all filtered)
async function closeAllFilteredTabs() {
  const targetTabs = getTargetTabs();
  if (targetTabs.length === 0) {
    console.log('No tabs to close');
    return;
  }

  // Confirm if closing more than 5 tabs
  if (targetTabs.length > 5) {
    const confirmed = confirm(`Close ${targetTabs.length} tabs?`);
    if (!confirmed) return;
  }

  // Get all tab IDs (exclude pinned)
  const tabIds = targetTabs.filter(tab => !tab.pinned).map(tab => tab.id);

  // Close tabs
  try {
    await chrome.tabs.remove(tabIds);
    clearSelection();
    await refreshTabs();
  } catch (error) {
    console.error('Failed to close tabs:', error);
  }
}

// Move tabs to new window (selected or all filtered)
async function moveAllFilteredTabs() {
  const targetTabs = getTargetTabs();
  const movableTabs = targetTabs.filter(tab => !tab.pinned);

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

    clearSelection();
    await refreshTabs();
  } catch (error) {
    console.error('Failed to move tabs:', error);
  }
}

// Initialize
async function init() {
  await loadSavedTheme();
  await loadTabs();
  const continueInit = await loadSavedDisplayMode();
  if (!continueInit) {
    return;
  }
  await loadSavedSortMode();
  await loadSavedTreeViewMode();
  await loadSavedGroupByWindowMode();
  await loadSavedHistoryRange();
  await loadSavedHistoryResultsLimit();
  setupEventListeners();
  applySortOrder();
  renderTabs();
  focusSearchInput();
}

// Load saved theme from storage, fallback to system preference
async function loadSavedTheme() {
  try {
    const result = await chrome.storage.local.get(['darkMode']);
    if (typeof result.darkMode === 'boolean') {
      setTheme(result.darkMode, { skipSave: true });
    } else {
      // No saved preference, use system setting
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark, { skipSave: true });
    }
  } catch (error) {
    console.log('Could not load saved theme:', error);
    // Fallback to system preference on error
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark, { skipSave: true });
  }
}

// Set theme
function setTheme(isDark, options = {}) {
  const { skipSave = false } = options;
  darkMode = isDark;

  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }

  updateThemeToggleIcon();

  if (!skipSave) {
    chrome.storage.local.set({ darkMode: isDark });
  }
}

// Update theme toggle button icon
function updateThemeToggleIcon() {
  if (!themeToggleBtn) return;

  const lightIcon = themeToggleBtn.querySelector('.theme-icon-light');
  const darkIcon = themeToggleBtn.querySelector('.theme-icon-dark');

  if (lightIcon && darkIcon) {
    lightIcon.style.display = darkMode ? 'none' : 'inline';
    darkIcon.style.display = darkMode ? 'inline' : 'none';
  }
}

// Toggle theme
function toggleTheme() {
  setTheme(!darkMode);
}

// Load saved display mode and handle overlay fallback
async function loadSavedDisplayMode() {
  currentDisplayMode = 'overlay';

  try {
    const result = await chrome.storage.local.get(['displayMode']);
    const savedMode = result.displayMode;
    if (savedMode !== 'overlay') {
      await chrome.storage.local.set({ displayMode: 'overlay' });
    }
  } catch (error) {
    console.log('Could not enforce overlay mode:', error);
    chrome.storage.local.set({ displayMode: 'overlay' }).catch(() => {});
  }

  updateDisplayModeControls();

  if (!isOverlayContext) {
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

// Load saved tree view mode from storage
async function loadSavedTreeViewMode() {
  try {
    const result = await chrome.storage.local.get(['treeViewEnabled']);
    if (typeof result.treeViewEnabled === 'boolean') {
      treeViewEnabled = result.treeViewEnabled;
      updateTreeViewButtons();
    }
  } catch (error) {
    console.log('Could not load saved tree view mode:', error);
  }
}

// Load saved group by window mode from storage
async function loadSavedGroupByWindowMode() {
  try {
    const result = await chrome.storage.local.get(['groupByWindowEnabled']);
    if (typeof result.groupByWindowEnabled === 'boolean') {
      groupByWindowEnabled = result.groupByWindowEnabled;
      updateGroupByWindowButtons();
    }
  } catch (error) {
    console.log('Could not load saved group by window mode:', error);
  }
}

function updateTreeViewButtons() {
  viewFlatBtn.classList.toggle('active', !treeViewEnabled);
  viewTreeBtn.classList.toggle('active', treeViewEnabled);
}

function updateGroupByWindowButtons() {
  groupOffBtn.classList.toggle('active', !groupByWindowEnabled);
  groupByWindowBtn.classList.toggle('active', groupByWindowEnabled);
}

async function setTreeView(enabled) {
  treeViewEnabled = enabled;
  updateTreeViewButtons();
  await chrome.storage.local.set({ treeViewEnabled: enabled });
  selectedIndex = 0;
  renderTabs();
}

async function setGroupByWindow(enabled) {
  groupByWindowEnabled = enabled;
  updateGroupByWindowButtons();
  await chrome.storage.local.set({ groupByWindowEnabled: enabled });
  selectedIndex = 0;
  renderTabs();
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

// Load saved history results limit
async function loadSavedHistoryResultsLimit() {
  try {
    const result = await chrome.storage.local.get(['historyResultsLimit']);
    const savedLimit = Number(result.historyResultsLimit);
    if (HISTORY_RESULTS_LIMIT_OPTIONS.includes(savedLimit)) {
      setHistoryResultsLimit(savedLimit, { skipSave: true, skipFilter: true });
      return;
    }
  } catch (error) {
    console.log('Could not load history results limit:', error);
  }

  setHistoryResultsLimit(100, { skipSave: true, skipFilter: true });
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

// Build tree structure from flat tabs array using openerTabId
function buildTabTree(tabs) {
  const nodeMap = new Map();

  // Create a node for each tab
  tabs.forEach(tab => {
    nodeMap.set(tab.id, {
      tab: tab,
      children: [],
      depth: 0,
      flatIndex: -1
    });
  });

  // Build parent-child relationships
  const rootNodes = [];

  tabs.forEach(tab => {
    const node = nodeMap.get(tab.id);

    if (tab.openerTabId && nodeMap.has(tab.openerTabId)) {
      // Parent exists - add as child
      const parentNode = nodeMap.get(tab.openerTabId);
      parentNode.children.push(node);
    } else {
      // No opener or opener not in set - this is a root
      rootNodes.push(node);
    }
  });

  // Set depths recursively
  function setDepths(node, depth) {
    node.depth = depth;
    node.children.forEach(child => setDepths(child, depth + 1));
  }

  rootNodes.forEach(root => setDepths(root, 0));

  // Sort children at each level
  function sortChildren(node) {
    if (node.children.length > 0) {
      applySortToNodes(node.children);
      node.children.forEach(sortChildren);
    }
  }

  applySortToNodes(rootNodes);
  rootNodes.forEach(sortChildren);

  return rootNodes;
}

// Sort an array of tree nodes based on current sort mode
function applySortToNodes(nodes) {
  switch (currentSort) {
    case 'url':
      nodes.sort((a, b) => (a.tab.url || '').localeCompare(b.tab.url || ''));
      break;
    case 'title':
      nodes.sort((a, b) => (a.tab.title || '').localeCompare(b.tab.title || ''));
      break;
    case 'recent':
    default:
      nodes.sort((a, b) => {
        const aTime = typeof a.tab.lastAccessed === 'number' ? a.tab.lastAccessed : 0;
        const bTime = typeof b.tab.lastAccessed === 'number' ? b.tab.lastAccessed : 0;
        if (bTime !== aTime) {
          return bTime - aTime;
        }
        return (b.tab.id || 0) - (a.tab.id || 0);
      });
      break;
  }
}

// Flatten tree into array in DFS order for keyboard navigation
function flattenTree(roots) {
  const result = [];

  function traverse(node) {
    node.flatIndex = result.length;
    result.push(node);
    node.children.forEach(traverse);
  }

  roots.forEach(traverse);
  return result;
}

// Render tabs list
async function renderTabs(options = {}) {
  const {
    preserveScroll = false,
    targetScrollTop = null,
    suppressAutoScroll = false
  } = options;

  if (filteredTabs.length === 0 && historyResults.length === 0) {
    tabsList.innerHTML = '<div class="no-tabs">No tabs or history found</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  // Choose rendering mode
  if (groupByWindowEnabled) {
    renderGroupedByWindow(fragment);
  } else if (treeViewEnabled) {
    renderTreeView(fragment);
  } else {
    renderFlatList(fragment);
  }

  // Render history section (always flat)
  if (historyResults.length > 0) {
    const historyHeader = document.createElement('div');
    historyHeader.className = 'section-header';
    historyHeader.textContent = `Recent History (${historyResults.length})`;
    fragment.appendChild(historyHeader);

    const tabCount = getTabCount();
    for (let i = 0; i < historyResults.length; i++) {
      const historyItem = historyResults[i];
      const itemIndex = tabCount + i;
      const historyElement = createHistoryElement(historyItem, itemIndex);
      fragment.appendChild(historyElement);
    }
  }

  tabsList.innerHTML = '';
  tabsList.appendChild(fragment);

  if (preserveScroll && targetScrollTop !== null) {
    const maxScroll = Math.max(0, tabsList.scrollHeight - tabsList.clientHeight);
    tabsList.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
  }

  if (!suppressAutoScroll) {
    scrollToSelected();
  }
}

// Get the count of tabs for index calculation
function getTabCount() {
  if (treeViewEnabled || groupByWindowEnabled) {
    // When tree view or group by window is enabled, flattenedTree is populated
    // (group by window also populates it for correct indexing)
    return flattenedTree.length > 0 ? flattenedTree.length : filteredTabs.length;
  }
  return filteredTabs.length;
}

// Render tabs as flat list
function renderFlatList(fragment) {
  // Reset tree data
  flattenedTree = [];

  if (filteredTabs.length > 0) {
    const tabsHeader = document.createElement('div');
    tabsHeader.className = 'section-header';
    tabsHeader.textContent = `Open Tabs (${filteredTabs.length})`;
    fragment.appendChild(tabsHeader);
  }

  for (let i = 0; i < filteredTabs.length; i++) {
    const tab = filteredTabs[i];
    const tabItem = createTabElement(tab, i, 0);
    fragment.appendChild(tabItem);
  }
}

// Render tabs in tree view with indentation
function renderTreeView(fragment) {
  tabTree = buildTabTree(filteredTabs);
  flattenedTree = flattenTree(tabTree);

  if (flattenedTree.length > 0) {
    const tabsHeader = document.createElement('div');
    tabsHeader.className = 'section-header';
    tabsHeader.textContent = `Open Tabs (${flattenedTree.length})`;
    fragment.appendChild(tabsHeader);
  }

  flattenedTree.forEach((node, index) => {
    const tabItem = createTabElement(node.tab, index, node.depth);
    fragment.appendChild(tabItem);
  });
}

// Render tabs grouped by window
function renderGroupedByWindow(fragment) {
  // Group tabs by windowId
  const windowGroups = new Map();

  filteredTabs.forEach(tab => {
    if (!windowGroups.has(tab.windowId)) {
      windowGroups.set(tab.windowId, []);
    }
    windowGroups.get(tab.windowId).push(tab);
  });

  let globalIndex = 0;
  flattenedTree = [];

  windowGroups.forEach((tabs, windowId) => {
    // Window header
    const windowHeader = document.createElement('div');
    windowHeader.className = 'section-header window-header';

    const windowLabel = document.createElement('span');
    windowLabel.textContent = `Window (${tabs.length} tabs)`;
    windowHeader.appendChild(windowLabel);

    // Close button to close all tabs in this window
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'window-close-button';
    closeBtn.setAttribute('aria-label', 'Close all tabs in this window');
    closeBtn.title = 'Close all tabs in this window';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabIds = tabs.filter(t => !t.pinned).map(t => t.id);
      if (tabIds.length === 0) return;
      if (tabIds.length > 3) {
        const confirmed = confirm(`Close ${tabIds.length} tabs in this window?`);
        if (!confirmed) return;
      }
      await chrome.tabs.remove(tabIds);
      await refreshTabs();
    });
    windowHeader.appendChild(closeBtn);

    fragment.appendChild(windowHeader);

    if (treeViewEnabled) {
      // Tree within each window
      const windowTree = buildTabTree(tabs);
      const flattened = flattenTree(windowTree);

      flattened.forEach(node => {
        flattenedTree.push(node);
        node.flatIndex = globalIndex;
        const tabItem = createTabElement(node.tab, globalIndex++, node.depth);
        fragment.appendChild(tabItem);
      });
    } else {
      // Flat list within each window - still track in flattenedTree for indexing
      tabs.forEach(tab => {
        flattenedTree.push(tab);
        const tabItem = createTabElement(tab, globalIndex++, 0);
        fragment.appendChild(tabItem);
      });
    }
  });
}

// Create a tab element with optional tree depth for indentation
function createTabElement(tab, index, depth = 0) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  if (index === selectedIndex) {
    tabItem.classList.add('selected');
  }
  if (selectedTabIds.has(tab.id)) {
    tabItem.classList.add('checked');
  }

  tabItem.dataset.tabId = tab.id;
  tabItem.dataset.index = index;
  tabItem.dataset.depth = depth;

  // Apply indentation for tree view
  if (depth > 0) {
    tabItem.style.paddingLeft = `${8 + (depth * 20)}px`;
    tabItem.classList.add('tree-child');
  }

  // Checkbox/Favicon container
  const selectWrapper = document.createElement('div');
  selectWrapper.className = 'tab-select-wrapper';

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'tab-checkbox';
  checkbox.checked = selectedTabIds.has(tab.id);
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTabSelection(tab.id, index, e);
  });
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
  });
  selectWrapper.appendChild(checkbox);

  // Favicon
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

  selectWrapper.appendChild(faviconWrapper);
  tabItem.appendChild(selectWrapper);

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

  // History icon
  const faviconWrapper = document.createElement('div');
  faviconWrapper.className = 'tab-favicon fallback';
  faviconWrapper.textContent = '🕒';
  item.appendChild(faviconWrapper);

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
      text: query
    };
    
    const windowMs = getHistoryWindowMs(historyRange);
    const baseFetchSize = Math.max(historyResultsLimit * 2, 40);
    
    if (windowMs !== null) {
      searchOptions.startTime = Date.now() - windowMs;
      searchOptions.maxResults = Math.min(500, baseFetchSize);
    } else {
      searchOptions.startTime = 0; // Include full history
      searchOptions.maxResults = Math.min(500, Math.max(baseFetchSize, 200));
    }

    const results = await chrome.history.search(searchOptions);
    
    // Filter out URLs that are already in open tabs
    const openUrls = new Set(allTabs.map(t => t.url));
    historyResults = results
      .filter(item => !openUrls.has(item.url))
      .slice(0, historyResultsLimit);
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
  const tabCount = getTabCount();
  const totalItems = tabCount + historyResults.length;

  if (totalItems === 0) return;

  selectedIndex += direction;

  if (selectedIndex < 0) {
    selectedIndex = 0;
  } else if (selectedIndex >= totalItems) {
    selectedIndex = totalItems - 1;
  }

  updateSelection();
}

function updateSelection() {
  const items = tabsList.querySelectorAll('.tab-item');

  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });

  scrollToSelected();
}

function scrollToSelected() {
  const selected = tabsList.querySelector('.tab-item.selected');

  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const listRect = tabsList.getBoundingClientRect();
    const itemRect = selected.getBoundingClientRect();

    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      const scrollOffset = itemRect.top - listRect.top - (listRect.height / 2) + (itemRect.height / 2);
      tabsList.scrollBy({ top: scrollOffset, behavior: 'smooth' });
    }
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

  // Theme toggle
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Tree view toggles
  viewFlatBtn.addEventListener('click', () => setTreeView(false));
  viewTreeBtn.addEventListener('click', () => setTreeView(true));

  // Group by window toggles
  groupOffBtn.addEventListener('click', () => setGroupByWindow(false));
  groupByWindowBtn.addEventListener('click', () => setGroupByWindow(true));

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

  historyLimitButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const limit = Number(btn.dataset.limit);
      setHistoryResultsLimit(limit);
    });
  });

  // Action buttons
  copyAllBtn.addEventListener('click', copyAllUrls);
  moveAllBtn.addEventListener('click', moveAllFilteredTabs);
  closeAllBtn.addEventListener('click', closeAllFilteredTabs);
}

// Get tab at current selection index (handles tree mode and group by window)
function getTabAtIndex(index) {
  if ((treeViewEnabled || groupByWindowEnabled) && flattenedTree.length > 0) {
    const node = flattenedTree[index];
    return node?.tab || node;
  }
  return filteredTabs[index];
}

// Handle keyboard navigation
async function handleKeyPress(e) {
  const tabCount = getTabCount();
  const totalItems = tabCount + historyResults.length;
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
      if (selectedIndex < tabCount) {
        const tabToClose = getTabAtIndex(selectedIndex);
        if (tabToClose) {
          await closeTab(tabToClose.id);
        }
      }
      break;

    case 'ArrowRight':
    case 'Enter':
      e.preventDefault();
      if (selectedIndex < tabCount) {
        // Switch to tab
        const tabToSwitch = getTabAtIndex(selectedIndex);
        if (tabToSwitch) {
          await switchToTab(tabToSwitch.id);
        }
      } else {
        // Open history item
        const historyIndex = selectedIndex - tabCount;
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
  if (!searchInput) return;

  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    searchInput.focus({ preventScroll: true });
    searchInput.select();

    // Fallback: try again after a short delay if focus didn't stick
    setTimeout(() => {
      if (document.activeElement !== searchInput) {
        searchInput.focus({ preventScroll: true });
        searchInput.select();
      }
    }, 50);
  });
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

function setHistoryResultsLimit(limit, options = {}) {
  const { skipSave = false, skipFilter = false } = options;
  if (!HISTORY_RESULTS_LIMIT_OPTIONS.includes(limit)) {
    limit = 100;
  }

  historyResultsLimit = limit;

  historyLimitButtons.forEach((btn) => {
    const isActive = Number(btn.dataset.limit) === limit;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  if (!skipSave) {
    chrome.storage.local.set({ historyResultsLimit: limit });
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
