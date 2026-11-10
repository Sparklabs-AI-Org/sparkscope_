'use client';

// 브리핑 영상 — 페이지에 들어오면 바로 재생한다(2026-11-10 은빛).
// 브라우저는 소리 있는 자동 재생을 막는 경우가 많다. 그때는 소리 없이 재생하고 '소리 켜기' 버튼을 띄운다.
import { useEffect, useRef, useState } from 'react';

export default function BriefingVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => { /* 저전력 모드 등으로 자동 재생 자체가 막히면 재생 버튼을 누르면 된다 */ });
    });
    const onVolume = () => setMuted(v.muted);
    // '소리로 듣기' 등 다른 소리가 재생되면 영상은 멈춘다 — 두 소리가 겹치지 않게.
    const onOtherPlay = (e: Event) => {
      if (e.target !== v && e.target instanceof HTMLMediaElement) v.pause();
    };
    v.addEventListener('volumechange', onVolume);
    document.addEventListener('play', onOtherPlay, true);
    return () => {
      v.removeEventListener('volumechange', onVolume);
      document.removeEventListener('play', onOtherPlay, true);
    };
  }, []);

  const unmute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {});
  };

  return (
    <div className="relative mt-2">
      <video ref={ref} src={src} controls playsInline preload="auto" className="w-full rounded-xl bg-black aspect-video" />
      {muted && (
        <button
          type="button"
          onClick={unmute}
          className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-bold text-white shadow"
        >
          🔊 소리 켜기
        </button>
      )}
    </div>
  );
}
