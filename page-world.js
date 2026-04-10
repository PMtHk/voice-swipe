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

  // Check if an element looks like a navigation arrow (not like/comment/share etc.)
  function isLikelyNavArrow(el) {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const tooltip = (el.getAttribute('data-tooltip-target-id') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    // Reject interaction buttons (comments, like, share, more, etc.)
    const rejectKeywords = [
      '채팅', '댓글', '좋아', '싫어', '공유', '구독', '저장', '더보기',
      'chat', 'comment', 'like', 'dislike', 'share', 'subscribe',
      'save', 'more', 'remix', 'report', 'mute', 'profile',
    ];
    for (const kw of rejectKeywords) {
      if (label.includes(kw) || tooltip.includes(kw)) return false;
    }

    return true;
  }

  // Check if aria-label / id / context suggests this is specifically a nav arrow
  function isExplicitNavArrow(el, direction) {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    const nextKeywords = ['next video', '다음 동영상', '다음 Shorts', '다음 shorts'];
    const prevKeywords = ['previous video', '이전 동영상', '이전 Shorts', '이전 shorts'];
    const keywords = direction > 0 ? nextKeywords : prevKeywords;

    for (const kw of keywords) {
      if (label.includes(kw.toLowerCase())) return true;
    }

    if (direction > 0 && id.includes('navigation-button-down')) return true;
    if (direction < 0 && id.includes('navigation-button-up')) return true;

    return false;
  }

  // Find the next/prev navigation arrows
  function findNavButtonByPosition(direction) {
    // Strategy A: Explicit selectors first
    const explicitSelectors = direction > 0
      ? [
          '#navigation-button-down button',
          '#navigation-button-down',
          'button[aria-label="다음 동영상"]',
          'button[aria-label="Next video"]',
          'ytd-button-renderer[id="navigation-button-down"] button',
        ]
      : [
          '#navigation-button-up button',
          '#navigation-button-up',
          'button[aria-label="이전 동영상"]',
          'button[aria-label="Previous video"]',
          'ytd-button-renderer[id="navigation-button-up"] button',
        ];

    for (const sel of explicitSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[VoiceSwipe/main] explicit selector match:', sel);
          return { el, rect, elMid: rect.top + rect.height / 2, via: 'explicit' };
        }
      }
    }

    // Strategy B: Search all buttons, aggressively filter out interaction buttons
    const buttons = document.querySelectorAll('button, yt-icon-button, ytd-button-renderer');
    const viewportMid = window.innerHeight / 2;
    const candidates = [];

    buttons.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      if (rect.width > 200 || rect.height > 200) return;

      // CRITICAL: must be visible within the viewport
      if (rect.top < 0 || rect.bottom > window.innerHeight) return;
      if (rect.left < 0 || rect.right > window.innerWidth) return;

      // Must be in the FAR right of viewport (past the interaction column)
      if (rect.left < window.innerWidth * 0.6) return;

      // Reject obvious interaction buttons by context
      if (!isLikelyNavArrow(el)) return;

      // Reject elements inside comment/menu renderers
      if (
        el.closest('ytd-comment-view-model, ytd-comments, ytd-menu-renderer, ytd-engagement-panel-section-list-renderer')
      ) {
        return;
      }

      // Explicit nav arrow gets priority
      const explicit = isExplicitNavArrow(el, direction);
      candidates.push({
        el,
        rect,
        elMid: rect.top + rect.height / 2,
        explicit,
      });
    });

    if (candidates.length === 0) return null;

    // Explicit matches win
    const explicitMatches = candidates.filter((c) => c.explicit);
    if (explicitMatches.length > 0) {
      console.log('[VoiceSwipe/main] explicit nav match found');
      return { ...explicitMatches[0], via: 'aria' };
    }

    // Otherwise, pick the one closest to viewport middle but on the correct side
    const correctSide = candidates.filter((c) =>
      direction > 0 ? c.elMid > viewportMid : c.elMid < viewportMid
    );
    const pool = correctSide.length > 0 ? correctSide : candidates;

    // Sort by distance from viewport middle (closest first)
    pool.sort((a, b) => Math.abs(a.elMid - viewportMid) - Math.abs(b.elMid - viewportMid));

    console.log('[VoiceSwipe/main] position-based candidates:', pool.length, 'picked first');
    return { ...pool[0], via: 'position' };
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
