// QTV Extension v3 - Bridge script chạy trên trang QTV
// Chuyển tiếp lệnh giữa React App (window.postMessage) và background.js

(function () {
  function notifyReady() {
    if (window.location.pathname.startsWith('/tv/')) {
      chrome.runtime.sendMessage({ type: 'QTV_REGISTER_TV_TAB' }, () => {
        void chrome.runtime.lastError;
      });
    }
    window.postMessage(
      {
        source: 'QTV_EXTENSION',
        type: 'QTV_EXT_READY',
        version: '3.0',
      },
      '*'
    );
  }

  // Báo sẵn sàng ngay khi load
  notifyReady();

  // Nhận lệnh từ QTV Web Page -> gửi sang background.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'QTV_PAGE' || !data.type) return;

    if (data.type === 'QTV_EXT_PING') {
      notifyReady();
      return;
    }

    chrome.runtime.sendMessage(data, () => {
      void chrome.runtime.lastError;
    });
  });

  // Nhận sự kiện từ background.js (từ Tab YouTube) -> gửi vào QTV Web Page
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    window.postMessage(
      {
        source: 'QTV_EXTENSION',
        ...msg,
      },
      '*'
    );
  });
})();
