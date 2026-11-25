// QTV Extension v3 - MAIN World helper trên www.youtube.com
// Cho phép gọi trực tiếp API nội bộ của #movie_player (chuyển bài tức thì không reload trang)

(function () {
  let boundPlayer = null;
  let lastEndedSent = 0;

  function getPlayer() {
    return document.getElementById('movie_player');
  }

  function getVideoEl() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function emitEnded() {
    const now = Date.now();
    if (now - lastEndedSent < 2500) return;
    lastEndedSent = now;
    window.postMessage({ source: 'QTV_YT_MAIN', type: 'VIDEO_ENDED' }, '*');
  }

  function bindPlayerEvents() {
    const player = getPlayer();
    if (player && player !== boundPlayer && typeof player.addEventListener === 'function') {
      boundPlayer = player;
      try {
        player.addEventListener('onStateChange', (state) => {
          // 0 = ENDED trong YouTube Player API
          if (state === 0) {
            emitEnded();
          }
        });
      } catch {
        // Fallback bằng thẻ video bên dưới
      }
    }

    const video = getVideoEl();
    if (video && !video.dataset.qtvEndedBound) {
      video.dataset.qtvEndedBound = '1';
      video.addEventListener('ended', emitEnded);
    }
  }

  // Kiểm tra gắn sự kiện định kỳ nhẹ (nhưng chỉ gửi message khi player ở chế độ QTV)
  setInterval(bindPlayerEvents, 1500);
  bindPlayerEvents();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'QTV_YT_ISOLATED') return;

    const player = getPlayer();
    const video = getVideoEl();

    switch (data.type) {
      case 'LOAD_VIDEO': {
        if (!data.videoId) return;
        if (player && typeof player.loadVideoById === 'function') {
          try {
            player.loadVideoById(data.videoId);
            if (typeof player.playVideo === 'function') {
              player.playVideo();
            }
            window.postMessage({ source: 'QTV_YT_MAIN', type: 'LOAD_VIDEO_OK' }, '*');
            return;
          } catch {
            // Fallback reload bên dưới
          }
        }
        window.location.href = `https://www.youtube.com/watch?v=${data.videoId}`;
        break;
      }

      case 'PLAY':
        if (player && typeof player.playVideo === 'function') {
          player.playVideo();
        } else if (video) {
          video.play().catch(() => {});
        }
        break;

      case 'PAUSE':
        if (player && typeof player.pauseVideo === 'function') {
          player.pauseVideo();
        } else if (video) {
          video.pause();
        }
        break;

      case 'SEEK_DELTA': {
        const delta = Number(data.delta) || 0;
        if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
          const cur = player.getCurrentTime() || 0;
          const dur = typeof player.getDuration === 'function' ? player.getDuration() : Infinity;
          const target = Math.max(0, Math.min(dur || Infinity, cur + delta));
          player.seekTo(target, true);
        } else if (video) {
          video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
        }
        break;
      }

      case 'SEEK_TO': {
        const time = Number(data.time);
        if (Number.isNaN(time)) return;
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(time, true);
        } else if (video) {
          video.currentTime = time;
        }
        break;
      }

      case 'SET_VOLUME': {
        const vol01 = Math.max(0, Math.min(1, Number(data.volume)));
        const vol100 = Math.round(vol01 * 100);
        if (player && typeof player.setVolume === 'function') {
          player.setVolume(vol100);
          if (vol100 > 0 && typeof player.unMute === 'function') player.unMute();
        } else if (video) {
          video.volume = vol01;
          if (vol01 > 0) video.muted = false;
        }
        break;
      }

      case 'SET_MUTE': {
        const muted = Boolean(data.muted);
        if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') {
          if (muted) player.mute();
          else player.unMute();
        } else if (video) {
          video.muted = muted;
        }
        break;
      }
    }
  });
})();
