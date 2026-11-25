// QTV Extension v3 - Background Service Worker
// Quản lý kết nối 2 chiều giữa Tab QTV (Firebase) và Tab YouTube gốc

const STORAGE_KEY = 'qtv_session_state';

async function getSession() {
  try {
    const res = await chrome.storage.session.get(STORAGE_KEY);
    return (
      res[STORAGE_KEY] || {
        qtvTabId: null,
        ytTabId: null,
        overlayState: null,
      }
    );
  } catch {
    return { qtvTabId: null, ytTabId: null, overlayState: null };
  }
}

async function saveSession(patch) {
  const current = await getSession();
  const next = { ...current, ...patch };
  await chrome.storage.session.set({ [STORAGE_KEY]: next });
  return next;
}

async function isTabAlive(tabId) {
  if (typeof tabId !== 'number') return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function safeSendToTab(tabId, message) {
  if (typeof tabId !== 'number') return false;
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  (async () => {
    const session = await getSession();

    // 1. QTV TV Page đăng ký Tab của mình
    if (msg.type === 'QTV_REGISTER_TV_TAB') {
      if (sender.tab?.id) {
        await saveSession({ qtvTabId: sender.tab.id });
      }
      sendResponse({ ok: true, ytTabActive: await isTabAlive(session.ytTabId) });
      return;
    }

    // 2. YouTube Tab hỏi xem nó có phải là Tab Player do QTV quản lý không
    if (msg.type === 'QTV_YT_CHECK_ROLE') {
      const isQtvPlayer = Boolean(sender.tab?.id && sender.tab.id === session.ytTabId);
      sendResponse({
        isQtvPlayer,
        state: isQtvPlayer ? session.overlayState : null,
      });
      return;
    }

    // 3. Mở hoặc chuyển bài trên Tab YouTube gốc (không reload trang)
    if (msg.type === 'QTV_OPEN_OR_LOAD_VIDEO') {
      const { videoId, overlayState } = msg;
      const qtvTabId = sender.tab?.id || session.qtvTabId;
      await saveSession({ qtvTabId, overlayState: overlayState || session.overlayState });

      if (!videoId) {
        sendResponse({ ok: false });
        return;
      }

      const ytAlive = await isTabAlive(session.ytTabId);
      if (ytAlive) {
        // Thử chuyển bài tức thì bằng SPA (movie_player.loadVideoById)
        const delivered = await safeSendToTab(session.ytTabId, {
          type: 'QTV_LOAD_VIDEO',
          videoId,
          state: overlayState,
        });

        if (!delivered) {
          // Fallback nếu tab YouTube đang ở trang khác hoặc chưa sẵn sàng
          await chrome.tabs.update(session.ytTabId, {
            url: `https://www.youtube.com/watch?v=${videoId}`,
            active: true,
          });
        } else {
          await chrome.tabs.update(session.ytTabId, { active: true });
        }

        sendResponse({ ok: true, reused: true });
      } else {
        // Tạo Tab YouTube mới và kích hoạt ngay
        const newTab = await chrome.tabs.create({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          active: true,
        });
        await saveSession({ ytTabId: newTab.id });
        sendResponse({ ok: true, reused: false, ytTabId: newTab.id });
      }
      return;
    }

    // 4. Đồng bộ trạng thái Overlay (Hàng đợi, Toast, RoomId) sang Tab YouTube
    if (msg.type === 'QTV_SYNC_STATE') {
      await saveSession({ overlayState: msg.overlayState });
      if (await isTabAlive(session.ytTabId)) {
        await safeSendToTab(session.ytTabId, {
          type: 'QTV_SYNC_STATE',
          state: msg.overlayState,
        });
      }
      sendResponse({ ok: true });
      return;
    }

    // 5. Chuyển các lệnh điều khiển (Play/Pause/Seek/Volume/Mute) sang Tab YouTube
    if (
      msg.type === 'QTV_CMD_PLAY' ||
      msg.type === 'QTV_CMD_PAUSE' ||
      msg.type === 'QTV_CMD_SEEK_DELTA' ||
      msg.type === 'QTV_CMD_SEEK_TO' ||
      msg.type === 'QTV_CMD_SET_VOLUME' ||
      msg.type === 'QTV_CMD_SET_MUTE'
    ) {
      if (await isTabAlive(session.ytTabId)) {
        await safeSendToTab(session.ytTabId, msg);
      }
      sendResponse({ ok: true });
      return;
    }

    // 6. Focus lại Tab YouTube từ trang QTV
    if (msg.type === 'QTV_FOCUS_YT_TAB') {
      if (await isTabAlive(session.ytTabId)) {
        await chrome.tabs.update(session.ytTabId, { active: true });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return;
    }

    // 7. Khi phòng hết bài (currentVideo = null) -> quay lại màn hình chờ QR của QTV
    if (msg.type === 'QTV_STOP_AND_RETURN') {
      if (await isTabAlive(session.ytTabId)) {
        await safeSendToTab(session.ytTabId, { type: 'QTV_CMD_PAUSE' });
      }
      if (await isTabAlive(session.qtvTabId)) {
        await chrome.tabs.update(session.qtvTabId, { active: true });
      }
      sendResponse({ ok: true });
      return;
    }

    // 8. Sự kiện từ Tab YouTube gửi ngược về Tab QTV (Hết bài / Bấm Qua bài)
    if (msg.type === 'QTV_VIDEO_ENDED' || msg.type === 'QTV_SKIP_NEXT') {
      if (await isTabAlive(session.qtvTabId)) {
        await safeSendToTab(session.qtvTabId, { type: msg.type });
      }
      sendResponse({ ok: true });
      return;
    }

    // 9. Focus lại Tab QTV (khi bấm vào huy hiệu phòng TV trên YouTube)
    if (msg.type === 'QTV_FOCUS_TV_TAB') {
      if (await isTabAlive(session.qtvTabId)) {
        await chrome.tabs.update(session.qtvTabId, { active: true });
      }
      sendResponse({ ok: true });
      return;
    }
  })();

  return true; // Giữ kênh sendResponse cho async handler
});

// Dọn dẹp nếu người dùng tự đóng Tab YouTube
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (tabId === session.ytTabId) {
    await saveSession({ ytTabId: null });
    if (await isTabAlive(session.qtvTabId)) {
      await safeSendToTab(session.qtvTabId, { type: 'QTV_YT_CLOSED' });
    }
  }
});
