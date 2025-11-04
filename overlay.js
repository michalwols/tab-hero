(() => {
  const CLEANUP_KEY = '__tabHeroOverlayCleanup';

  if (typeof window[CLEANUP_KEY] === 'function') {
    window[CLEANUP_KEY]();
    return;
  }

  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  const overlayId = 'tab-hero-overlay';

  const overlay = document.createElement('div');
  overlay.id = overlayId;

  const style = document.createElement('style');
  style.textContent = `
    body.tab-hero-overlay-open {
      overflow: hidden !important;
    }

    #${overlayId} {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(3px);
      transition: opacity 0.2s ease;
      opacity: 0;
      padding: 48px 40px;
      box-sizing: border-box;
    }

    #${overlayId}.visible {
      opacity: 1;
    }

    #${overlayId} .tab-hero-overlay-shell {
      position: relative;
      width: min(900px, calc(100vw - 80px));
      height: min(calc(100vh - 96px), max(640px, calc(100vh * 0.66)));
      max-height: calc(100vh - 96px);
      display: flex;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
      border-radius: 18px;
      overflow: hidden;
      background: #0f172a;
    }

    #${overlayId} .tab-hero-overlay-frame {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }

  `;

  const shell = document.createElement('div');
  shell.className = 'tab-hero-overlay-shell';

  const iframe = document.createElement('iframe');
  iframe.className = 'tab-hero-overlay-frame';
  iframe.src = `${chrome.runtime.getURL('popup.html')}#overlay`;
  iframe.allow = 'clipboard-read; clipboard-write';

  shell.appendChild(iframe);
  overlay.appendChild(style);
  overlay.appendChild(shell);

  const host = document.body || document.documentElement;
  if (!host) {
    return;
  }

  const removeOverlay = () => {
    overlay.remove();
    host.classList.remove('tab-hero-overlay-open');
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('message', handleMessage, true);
    window[CLEANUP_KEY] = null;
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      removeOverlay();
    }
  };

  const handleMessage = (event) => {
    if (event.origin !== extensionOrigin) return;
    if (event.data && event.data.type === 'TAB_HERO_CLOSE') {
      removeOverlay();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      removeOverlay();
    }
  });

  host.appendChild(overlay);
  host.classList.add('tab-hero-overlay-open');

  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('message', handleMessage, true);

  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    try {
      iframe.contentWindow?.postMessage({ type: 'TAB_HERO_FOCUS_SEARCH' }, extensionOrigin);
    } catch (error) {
      // Ignore cross-origin access since message passing handles focus
    }
  });

  window[CLEANUP_KEY] = removeOverlay;
})();
