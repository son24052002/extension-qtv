// QTV Extension v3 - Content script chạy trên Tab YouTube gốc (ISOLATED world)
// Chỉ kích hoạt khi được background.js xác nhận đây là Tab Player của QTV

(function () {
  let isQtvPlayer = false;
  let overlayState = {
    roomId: '',
    queue: [],
    toast: null,
    remoteUrl: '',
  };
  let lastToastKey = '';
  let toastTimeout = null;
  let isDrawerOpen = false;
  let shadowRoot = null;

  function postToMain(payload) {
    window.postMessage({ source: 'QTV_YT_ISOLATED', ...payload }, '*');
  }

  // Chỉ ẩn bằng CSS (TUYỆT ĐỐI KHÔNG dùng el.remove() để tránh làm crash JS của YouTube)
  function injectCleanCss() {
    if (document.getElementById('qtv-yt-clean-style')) return;
    const style = document.createElement('style');
    style.id = 'qtv-yt-clean-style';
    style.textContent = `
      html, body {
        overflow: hidden !important;
        background: #000 !important;
      }
      ytd-masthead,
      #masthead-container,
      #secondary,
      #below,
      #chat,
      ytd-merch-shelf-renderer,
      ytd-mini-guide-renderer,
      tp-yt-app-drawer {
        display: none !important;
      }
      ytd-app, #page-manager, ytd-watch-flexy {
        margin: 0 !important;
        padding: 0 !important;
        background: #000 !important;
      }
      #movie_player {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        z-index: 9999 !important;
        background: #000 !important;
      }
      #movie_player .html5-video-container,
      #movie_player video.html5-main-video {
        width: 100vw !important;
        height: 100vh !important;
        left: 0 !important;
        top: 0 !important;
        object-fit: contain !important;
      }
      .ytp-size-button,
      .ytp-miniplayer-button {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // Tạo Shadow DOM Overlay nhẹ (không dùng backdrop-blur để tối ưu GPU)
  function mountOverlay() {
    if (shadowRoot) return;
    const host = document.createElement('div');
    host.id = 'qtv-yt-overlay-root';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .topbar {
          position: fixed;
          top: 16px;
          left: 16px;
          right: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          pointer-events: none;
        }
        .badge {
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #fff;
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 13px;
          cursor: pointer;
          user-select: none;
        }
        .badge:hover { background: rgba(24, 24, 27, 0.92); }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
        }
        .room-id {
          color: #ef4444;
          font-weight: 800;
          font-family: ui-monospace, monospace;
          font-size: 14px;
          letter-spacing: 0.05em;
        }
        .actions {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn {
          background: rgba(0, 0, 0, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: #f4f4f5;
          padding: 7px 14px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn:hover { background: rgba(39, 39, 42, 0.95); color: #fff; }
        .btn-red {
          background: rgba(220, 38, 38, 0.85);
          border-color: rgba(239, 68, 68, 0.5);
        }
        .btn-red:hover { background: #dc2626; }
        .toast {
          position: fixed;
          top: 66px;
          right: 16px;
          max-width: 340px;
          background: rgba(9, 9, 11, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: #fff;
          padding: 12px 16px;
          border-radius: 16px;
          box-shadow: 0 12px 32px rgba(0,0,0,0.6);
          display: none;
          pointer-events: none;
        }
        .toast.show { display: block; }
        .toast-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #f87171;
          font-weight: 800;
          margin-bottom: 3px;
        }
        .toast-title {
          font-size: 13px;
          font-weight: 700;
          color: #f4f4f5;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .toast-by {
          font-size: 11px;
          color: #a1a1aa;
          margin-top: 2px;
        }
        .drawer {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: 360px;
          max-width: 90vw;
          background: rgba(9, 9, 11, 0.95);
          border-left: 1px solid rgba(255, 255, 255, 0.14);
          color: #fff;
          display: none;
          flex-direction: column;
          padding: 20px;
          pointer-events: auto;
          box-shadow: -12px 0 32px rgba(0,0,0,0.7);
        }
        .drawer.open { display: flex; }
        .drawer-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          margin-bottom: 14px;
        }
        .drawer-title {
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #e4e4e7;
        }
        .queue-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .q-item {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.06);
          padding: 8px 10px;
          border-radius: 12px;
        }
        .q-idx {
          font-size: 12px;
          font-family: ui-monospace, monospace;
          color: #71717a;
          width: 18px;
          text-align: center;
          flex-shrink: 0;
        }
        .q-thumb {
          width: 60px;
          height: 36px;
          object-fit: cover;
          border-radius: 6px;
          background: #27272a;
          flex-shrink: 0;
        }
        .q-info { min-width: 0; flex: 1; }
        .q-title {
          font-size: 12px;
          font-weight: 600;
          color: #f4f4f5;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .q-by {
          font-size: 11px;
          color: #a1a1aa;
          margin-top: 2px;
        }
        .empty {
          text-align: center;
          color: #71717a;
          font-size: 12px;
          padding: 40px 10px;
        }
        .drawer-foot {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 12px;
          color: #a1a1aa;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
      </style>

      <div class="topbar">
        <div class="badge" id="qtv-room-badge" title="Quay lại màn hình QTV">
          <span class="dot"></span>
          <span>TV</span>
          <span class="room-id" id="qtv-room-id">#----</span>
        </div>

        <div class="actions">
          <button class="btn" id="qtv-queue-btn">Hàng đợi (0)</button>
          <button class="btn" id="qtv-fs-btn" title="Toàn màn hình">⛶</button>
        </div>
      </div>

      <div class="toast" id="qtv-toast">
        <div class="toast-label">Đã thêm vào hàng đợi</div>
        <div class="toast-title" id="qtv-toast-title"></div>
        <div class="toast-by" id="qtv-toast-by"></div>
      </div>

      <aside class="drawer" id="qtv-drawer">
        <div class="drawer-head">
          <span class="drawer-title" id="qtv-drawer-title">Hàng đợi (0)</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-red" id="qtv-skip-btn" style="display:none;">Qua bài</button>
            <button class="btn" id="qtv-close-btn">✕</button>
          </div>
        </div>
        <div class="queue-list" id="qtv-queue-list"></div>
        <div class="drawer-foot">
          <span>Mã phòng: <strong class="room-id" id="qtv-foot-room">#----</strong></span>
          <button class="btn" id="qtv-back-tv-btn">Mở mã QR</button>
        </div>
      </aside>
    `;

    shadowRoot.getElementById('qtv-room-badge').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'QTV_FOCUS_TV_TAB' });
    });

    shadowRoot.getElementById('qtv-back-tv-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'QTV_FOCUS_TV_TAB' });
    });

    shadowRoot.getElementById('qtv-queue-btn').addEventListener('click', () => {
      isDrawerOpen = !isDrawerOpen;
      renderOverlay();
    });

    shadowRoot.getElementById('qtv-close-btn').addEventListener('click', () => {
      isDrawerOpen = false;
      renderOverlay();
    });

    shadowRoot.getElementById('qtv-skip-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'QTV_SKIP_NEXT' });
    });

    shadowRoot.getElementById('qtv-fs-btn').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderOverlay() {
    if (!shadowRoot) return;
    const roomId = overlayState?.roomId || '----';
    const queue = Array.isArray(overlayState?.queue) ? overlayState.queue : [];

    shadowRoot.getElementById('qtv-room-id').textContent = `#${roomId}`;
    shadowRoot.getElementById('qtv-foot-room').textContent = `#${roomId}`;
    shadowRoot.getElementById('qtv-queue-btn').textContent = `Hàng đợi (${queue.length})`;
    shadowRoot.getElementById('qtv-drawer-title').textContent = `Hàng đợi (${queue.length})`;

    const skipBtn = shadowRoot.getElementById('qtv-skip-btn');
    skipBtn.style.display = queue.length > 0 ? 'inline-block' : 'none';

    const drawer = shadowRoot.getElementById('qtv-drawer');
    drawer.classList.toggle('open', isDrawerOpen);

    const listEl = shadowRoot.getElementById('qtv-queue-list');
    if (queue.length === 0) {
      listEl.innerHTML = '<div class="empty">Hàng đợi đang trống. Mở điện thoại để chọn bài!</div>';
    } else {
      listEl.innerHTML = queue
        .map(
          (item, idx) => `
          <div class="q-item">
            <span class="q-idx">${idx + 1}</span>
            <img class="q-thumb" src="${escapeHtml(item.thumbnail)}" alt="" />
            <div class="q-info">
              <div class="q-title">${escapeHtml(item.title)}</div>
              <div class="q-by">Bởi: ${escapeHtml(item.addedBy || 'Khách')}</div>
            </div>
          </div>
        `
        )
        .join('');
    }

    // Toast khi có bài mới được thêm
    const toast = overlayState?.toast;
    if (toast && toast.key && toast.key !== lastToastKey) {
      lastToastKey = toast.key;
      const toastEl = shadowRoot.getElementById('qtv-toast');
      shadowRoot.getElementById('qtv-toast-title').textContent = toast.title || '';
      shadowRoot.getElementById('qtv-toast-by').textContent = `Bởi: ${toast.addedBy || 'Khách'}`;
      toastEl.classList.add('show');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toastEl.classList.remove('show');
      }, 3500);
    }
  }

  // Tự động bấm nút "Bỏ qua quảng cáo" nếu có (không xóa DOM)
  function startAdSkipHelper() {
    setInterval(() => {
      if (!isQtvPlayer) return;
      const skipBtn = document.querySelector(
        '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
      );
      if (skipBtn && skipBtn.offsetParent !== null) {
        skipBtn.click();
      }
    }, 1000);
  }

  function activatePlayerMode(initialState) {
    if (isQtvPlayer) {
      if (initialState) {
        overlayState = { ...overlayState, ...initialState };
        renderOverlay();
      }
      return;
    }
    isQtvPlayer = true;
    if (initialState) {
      overlayState = { ...overlayState, ...initialState };
    }
    injectCleanCss();
    mountOverlay();
    renderOverlay();
    startAdSkipHelper();

    // Đảm bảo phát ngay sau khi mở tab
    setTimeout(() => {
      postToMain({ type: 'PLAY' });
    }, 800);
  }

  // Hỏi background.js xem tab này có phải Tab Player do QTV mở không
  chrome.runtime.sendMessage({ type: 'QTV_YT_CHECK_ROLE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp?.isQtvPlayer) {
      activatePlayerMode(resp.state);
    }
  });

  // Nhận sự kiện từ MAIN world (youtube-main.js)
  window.addEventListener('message', (event) => {
    if (!isQtvPlayer || event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'QTV_YT_MAIN') return;

    if (data.type === 'VIDEO_ENDED') {
      const hasNext = Array.isArray(overlayState?.queue) && overlayState.queue.length > 0;
      if (hasNext) {
        chrome.runtime.sendMessage({ type: 'QTV_VIDEO_ENDED' });
      }
    }
  });

  // Nhận lệnh từ background.js (do trang QTV gửi tới)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'QTV_LOAD_VIDEO') {
      activatePlayerMode(msg.state);
      postToMain({ type: 'LOAD_VIDEO', videoId: msg.videoId });
      sendResponse({ ok: true });
      return;
    }

    if (!isQtvPlayer) return;

    switch (msg.type) {
      case 'QTV_SYNC_STATE':
        if (msg.state) {
          overlayState = { ...overlayState, ...msg.state };
          renderOverlay();
        }
        break;
      case 'QTV_CMD_PLAY':
        postToMain({ type: 'PLAY' });
        break;
      case 'QTV_CMD_PAUSE':
        postToMain({ type: 'PAUSE' });
        break;
      case 'QTV_CMD_SEEK_DELTA':
        postToMain({ type: 'SEEK_DELTA', delta: msg.delta });
        break;
      case 'QTV_CMD_SEEK_TO':
        postToMain({ type: 'SEEK_TO', time: msg.time });
        break;
      case 'QTV_CMD_SET_VOLUME':
        postToMain({ type: 'SET_VOLUME', volume: msg.volume });
        break;
      case 'QTV_CMD_SET_MUTE':
        postToMain({ type: 'SET_MUTE', muted: msg.muted });
        break;
    }
    sendResponse({ ok: true });
  });
})();
