if (window.self !== window.top) {
  let hasNextInQueue = false;
  let lastReportedTime = 0;

  // 1. Tiêm CSS biến trang YouTube Watch thành trình phát tràn viền 100%
  const style = document.createElement('style');
  style.textContent = `
    html, body { overflow: hidden !important; background: #000 !important; }
    ytd-masthead, #secondary, #below, #chat, ytd-merch-shelf-renderer { display: none !important; }
    #page-manager { margin-top: 0 !important; }
    #movie_player, .html5-video-player, video {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 999999 !important;
    }
  `;
  document.documentElement.appendChild(style);

  // 2. Theo dõi thẻ <video> và gửi tiến độ phát lên cho QTV
  const attachVideoEvents = () => {
    const video = document.querySelector('video');
    if (!video || video.dataset.qtvBound) return;
    video.dataset.qtvBound = 'true';

    // Bật sẵn Autoplay của YouTube để tự chạy khi hàng đợi trống
    const autoplayBtn = document.querySelector('.ytp-autonav-toggle-button');
    if (autoplayBtn && autoplayBtn.getAttribute('aria-checked') === 'false') {
      autoplayBtn.click();
    }

    video.play().catch(() => {});

    video.addEventListener('ended', () => {
      if (hasNextInQueue) {
        window.parent.postMessage({ type: 'QTV_VIDEO_ENDED' }, '*');
      }
    });

    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastReportedTime > 1000) {
        lastReportedTime = now;
        window.parent.postMessage({
          type: 'QTV_TIME_UPDATE',
          currentTime: video.currentTime || 0,
          duration: video.duration || 0,
        }, '*');
      }
    });
  };

  setInterval(attachVideoEvents, 1000);

  // 3. Nhận toàn bộ lệnh điều khiển từ web QTV gửi xuống
  window.addEventListener('message', (event) => {
    const video = document.querySelector('video');
    const data = event.data;
    if (!data?.type) return;

    if (data.type === 'QTV_QUEUE_STATUS') {
      hasNextInQueue = Boolean(data.hasNext);
    }
    if (!video) return;

    switch (data.type) {
      case 'QTV_PLAY':
        video.play().catch(() => {});
        break;
      case 'QTV_PAUSE':
        video.pause();
        break;
      case 'QTV_SEEK_DELTA':
        video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (data.delta || 0)));
        break;
      case 'QTV_SEEK_TO':
        if (typeof data.time === 'number') video.currentTime = data.time;
        break;
      case 'QTV_SET_VOLUME':
        if (typeof data.volume === 'number') {
          video.volume = Math.max(0, Math.min(1, data.volume));
          if (video.volume > 0) video.muted = false;
        }
        break;
      case 'QTV_SET_MUTE':
        video.muted = Boolean(data.muted);
        break;
    }
  });
}