# Tab Manager Chrome Extension

A powerful Chrome extension for managing your tabs with a command palette interface, previews, and keyboard shortcuts.

## Features

- **Quick Access**: Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to open the tab manager
- **Search & Filter**: Quickly find tabs by typing their title or URL
- **Visual Previews**: See a 2x4 preview of the active tab's content
- **Keyboard Navigation**:
  - `↑` / `↓` - Navigate through tabs
  - `←` - Close the selected tab
  - `→` or `Enter` - Switch to the selected tab
  - `Esc` - Close the tab manager
- **Smart Sorting**:
  - Sort by URL
  - Sort by Title
  - Sort by Most Recent (default)

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" using the toggle in the top right
3. Click "Load unpacked"
4. Select the `tab-manager` folder
5. The extension is now installed!

## Usage

### Opening the Tab Manager

- Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux)
- Or click the extension icon in the toolbar

### Searching for Tabs

Start typing in the search box to filter tabs by title or URL. The list updates in real-time.

### Navigating Tabs

- Use **Arrow Up/Down** to move through the list
- Use **Arrow Right** or **Enter** to switch to the selected tab
- Use **Arrow Left** to close the selected tab
- Click on any tab to switch to it

### Sorting Tabs

Use the buttons at the bottom to sort tabs:
- **Sort by URL**: Groups tabs by their domain
- **Sort by Title**: Alphabetical by page title
- **Most Recent**: Shows newest tabs first (default)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+K` | Open tab manager |
| `↑` / `↓` | Navigate |
| `←` | Close tab |
| `→` / `Enter` | Switch to tab |
| `Esc` | Close manager |

## Development

The extension consists of:
- `manifest.json` - Extension configuration
- `popup.html` - Main UI structure
- `popup.css` - Styling
- `popup.js` - Core functionality
- `background.js` - Handles keyboard shortcuts

## Permissions

- `tabs` - Required to list and manage browser tabs
- `activeTab` - Required to capture tab previews

## Notes

- Tab previews are only captured for the currently active tab
- Other tabs show their favicon or a globe icon
- The extension remembers your last sort preference during the session

## License

MIT
