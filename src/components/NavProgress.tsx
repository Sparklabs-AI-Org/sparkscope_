'use client';
// 화면 맨 위 진행 막대(2026-11-26 소윤 "창이 너무 느리다"). 대시보드는 탭·기간을 바꿀 때마다 서버가 새로 그리는데,
// 같은 /dashboard 안에서 주소만 바뀌면 loading 화면이 안 떠서 눌러도 반응이 없는 것처럼 보였다.
// 내부 링크를 누르는 순간 막대를 띄우고, 주소가 바뀌어 새 화면이 오면 끈다.
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [on, setOn] = useState(false);

  useEffect(() => { setOn(false); }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setOn(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // 30초 넘게 안 바뀌면(에러 등) 그냥 끈다.
  useEffect(() => { if (!on) return; const id = setTimeout(() => setOn(false), 30_000); return () => clearTimeout(id); }, [on]);

  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-spark-purple/15">
      <div className="h-full w-1/3 animate-[navprog_1.1s_ease-in-out_infinite] bg-spark-purple" />
      <style>{`@keyframes navprog{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}
