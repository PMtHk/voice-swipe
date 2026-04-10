// Voice Swipe — Main World Script
// Runs in the page's JavaScript context, giving direct access to
// YouTube's / Instagram's internal APIs (ytd-shorts Polymer element,
// React state, etc.) that content scripts in isolated world cannot reach.

(() => {
  'use strict';

  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    const viewportMid = window.innerHeight / 2;
    return videos.find((v) => {
      const rect = v.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top <= viewportMid &&
        rect.bottom >= viewportMid
      );
    });
  }

  function isYouTubeShorts() {
    return /^https:\/\/www\.youtube\.com\/shorts\//.test(location.href);
  }

  function isInstagramReels() {
    return /^https:\/\/www\.instagram\.com\/reels\//.test(location.href);
  }

  // Walk up DOM tree to find a clickable ancestor
  function findClickableAncestor(el) {
    let current = el;
    for (let i = 0; i < 8 && current; i++) {
      if (
        current.tagName === 'BUTTON' ||
        current.getAttribute('role') === 'button' ||
        current.onclick ||
        current.hasAttribute('data-action')
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return el.parentElement; // fallback
  }

  // Find the next/prev navigation arrows by their position on screen
  function findNavButtonByPosition(direction) {
    // YouTube Shorts nav arrows are on the right side of the video player
    // Down arrow = lower half of viewport, Up arrow = upper half
    const shapes = document.querySelectorAll('yt-touch-feedback-shape, button, yt-icon-button');
    const viewportMid = window.innerHeight / 2;
    const candidates = [];

    shapes.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      if (rect.width > 200 || rect.height > 200) return; // not a button
      // Must be in the right half of viewport (nav arrows live there)
      if (rect.left < window.innerWidth * 0.6) return;
      if (rect.right > window.innerWidth) return;

      const elMid = rect.top + rect.height / 2;
      candidates.push({ el, rect, elMid });
    });

    if (candidates.length === 0) return null;

    // For next (direction > 0): button below the viewport middle
    // For prev (direction < 0): button above the viewport middle
    candidates.sort((a, b) => {
      if (direction > 0) {
        return b.elMid - a.elMid; // furthest down first
      }
      return a.elMid - b.elMid; // furthest up first
    });

    // Filter candidates on the correct side of viewport mid
    const filtered = candidates.filter((c) =>
      direction > 0 ? c.elMid > viewportMid : c.elMid < viewportMid
    );

    return filtered[0] || candidates[0];
  }

  // ---------- YouTube Shorts navigation ----------
  function navigateYouTubeShorts(direction) {
    console.log('[VoiceSwipe/main] YT Shorts navigate:', direction);

    // Approach 0: Find yt-touch-feedback-shape in the nav arrow position
    // (user-provided hint: the click feedback shape lives inside nav buttons)
    const navButton = findNavButtonByPosition(direction);
    if (navButton) {
      const clickable = findClickableAncestor(navButton.el);
      console.log(
        '[VoiceSwipe/main] position-based click:',
        clickable.tagName,
        clickable.className,
        navButton.rect
      );
      try {
        clickable.click();
        return true;
      } catch (e) {}
    }

    // Approach 1: Call internal methods on ytd-shorts Polymer component
    const ytdShorts = document.querySelector('ytd-shorts');
    if (ytdShorts) {
      const methodNames = direction > 0
        ? [
            'handleNextButtonClick_',
            'handleNextShortsClick_',
            '_onNextShortsClicked',
            'nextShort',
            'next_',
          ]
        : [
            'handlePrevButtonClick_',
            'handlePrevShortsClick_',
            '_onPrevShortsClicked',
            'prevShort',
            'prev_',
          ];

      for (const name of methodNames) {
        if (typeof ytdShorts[name] === 'function') {
          try {
            ytdShorts[name]();
            console.log('[VoiceSwipe/main] YT internal method:', name);
            return true;
          } catch (e) {}
        }
      }
    }

    // Approach 2: Find and click real navigation buttons by searching all
    // buttons for arrow icons or aria-labels
    const allButtons = document.querySelectorAll('button, ytd-button-renderer, yt-icon-button');
    const keywords = direction > 0
      ? ['next', '다음', 'down']
      : ['prev', 'previous', '이전', 'back', 'up'];

    for (const btn of allButtons) {
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
      const matches = keywords.some((k) => label.includes(k));
      if (matches) {
        const rect = btn.getBoundingClientRect();
        // Only consider on-screen elements in the right half of viewport
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left > window.innerWidth / 2 &&
          rect.top > 0 &&
          rect.bottom < window.innerHeight
        ) {
          console.log('[VoiceSwipe/main] YT button click:', label, rect);
          try {
            btn.click();
            return true;
          } catch (e) {}
        }
      }
    }

    // Approach 3: Navigate via URL using any shorts link found in DOM
    const currentId = location.pathname.match(/\/shorts\/([^/?#]+)/)?.[1];
    if (currentId) {
      const shortsLinks = document.querySelectorAll('a[href*="/shorts/"]');
      for (const link of shortsLinks) {
        const href = link.getAttribute('href');
        const id = href?.match(/\/shorts\/([^/?#]+)/)?.[1];
        if (id && id !== currentId) {
          console.log('[VoiceSwipe/main] YT link navigate:', id);
          link.click();
          return true;
        }
      }
    }

    // Approach 4: Dispatch CustomEvent that YouTube listens for
    try {
      const event = new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            reelWatchEndpoint: {
              sequenceProvider: 'RELATED_VIDEOS',
            },
          },
        },
      });
      document.dispatchEvent(event);
      console.log('[VoiceSwipe/main] dispatched yt-navigate');
    } catch (e) {}

    console.warn('[VoiceSwipe/main] all YT approaches exhausted');
    return false;
  }

  // ---------- Instagram Reels navigation ----------
  function navigateInstagramReels(direction) {
    console.log('[VoiceSwipe/main] Reels navigate:', direction);

    // Approach 1: Click real navigation buttons
    const buttons = document.querySelectorAll('button, div[role="button"]');
    const keywords = direction > 0 ? ['next', '다음'] : ['back', 'previous', '이전'];

    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (keywords.some((k) => label.includes(k))) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[VoiceSwipe/main] Reels button click:', label);
          try {
            btn.click();
            return true;
          } catch (e) {}
        }
      }
    }

    return false;
  }

  // ---------- Event listener (from content script) ----------
  document.addEventListener('voice-swipe-nav', (e) => {
    const direction = e.detail?.direction;
    if (typeof direction !== 'number') return;

    if (isYouTubeShorts()) {
      navigateYouTubeShorts(direction);
    } else if (isInstagramReels()) {
      navigateInstagramReels(direction);
    }
  });

  console.log('[VoiceSwipe/main] page-world script loaded');
})();
