'use client';

// 브리핑 영상 시청 이벤트 전송. 페이지 안의 첫 <video>에 붙는다.
// 이벤트는 페이지 한 번 열 때 이벤트마다 한 번씩만 보낸다(open · play · half · complete).
import { useEffect } from 'react';

const VISITOR_KEY = 'sparkscope-briefing-visitor';

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export default function BriefingTracker({ dateKey, token, title }: { dateKey: string; token?: string; title?: string }) {
  useEffect(() => {
    const vid = visitorId();
    const sent = new Set<string>();

    const send = (event: string) => {
      if (sent.has(event)) return;
      sent.add(event);
      const body = JSON.stringify({ dateKey, event, token: token ?? '', visitorId: vid });
      fetch('/api/briefing/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };

    send('open');

    // 영상과 '소리로 듣기'(audio) 둘 다 같은 이벤트로 잰다 — 소리로만 들어도 시청으로 본다.
    const media = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'));
    const cleanups = media.map(el => {
      const onPlay = () => {
        send('play');
        // 잠금화면·알림창에 제목이 뜨게(소리로 듣기를 백그라운드에서 켰을 때)
        if (el.tagName === 'AUDIO' && 'mediaSession' in navigator && title) {
          try { navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'SparkScope 브리핑' }); } catch { /* 지원 안 하는 브라우저 */ }
        }
      };
      const onTime = () => {
        if (el.duration > 0 && el.currentTime >= el.duration * 0.5) send('half');
      };
      const onEnded = () => send('complete');
      el.addEventListener('play', onPlay);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('ended', onEnded);
      return () => {
        el.removeEventListener('play', onPlay);
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('ended', onEnded);
      };
    });
    return () => cleanups.forEach(f => f());
  }, [dateKey, token, title]);

  return null;
}
