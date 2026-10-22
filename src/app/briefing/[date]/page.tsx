// 데일리 브리핑 페이지 — 잔디 링크가 여기로 온다. 회사 구글 계정 로그인이 필요하다(한 번 로그인하면 이후 자동 유지).
// 메일 링크(토큰)로 들어온 구독자는 토큰으로 본인이 확인되므로 로그인 없이 연다.
// 보여주는 건 공개 기사 헤드라인과 영상뿐이다 — 내부 분석(ourTake·포트폴리오 매칭)은 없다.
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { loadBriefingVideo, listBriefingVideos } from '@/lib/briefing-video/publish';
import { spokenDate, longDate } from '@/lib/briefing-video/script';
import BriefingTracker from '@/components/BriefingTracker';
import { getSessionUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function BriefingPage({
  params,
  searchParams,
}: {
  params: { date: string };
  searchParams: { s?: string };
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound();
  const video = await loadBriefingVideo(params.date);
  if (!video) notFound();
  // 로그인도 없고 메일 토큰도 없으면 로그인 화면으로 보낸다 — 로그인해야 시청이 개인 기록으로 집계된다.
  const me = await getSessionUser();
  const tokenOwner = searchParams.s
    ? await prisma.digestSubscriber.findUnique({ where: { token: searchParams.s }, select: { id: true } }).catch(() => null)
    : null;
  if (!me && !tokenOwner) redirect(`/login?callbackUrl=${encodeURIComponent(`/briefing/${params.date}`)}`);
  const tokenQ = searchParams.s ? `?s=${encodeURIComponent(searchParams.s)}` : '';
  const past = (await listBriefingVideos(8)).filter(v => v.dateKey !== video.dateKey).slice(0, 7);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <BriefingTracker dateKey={video.dateKey} token={searchParams.s} />
      <div className="text-sm font-semibold text-spark-purple">SparkScope {video.program === 'weekly' ? '위클리' : '데일리'} 브리핑</div>
      <h1 className="mt-1 text-2xl font-bold text-spark-ink">
        {video.program === 'weekly' ? spokenDate(video.dateKey) : `[데일리 브리핑] ${longDate(video.dateKey)} 스파크스코프 주요 뉴스`}
      </h1>
      <video src={video.url} controls playsInline preload="metadata" className="mt-4 w-full rounded-xl bg-black aspect-video" />
      {video.overview && <p className="mt-4 text-sm leading-relaxed text-spark-ink-soft">{video.overview}</p>}
      <ol className="mt-6 space-y-3">
        {video.headlines.map((h, i) => (
          <li key={h.url} className="rounded-xl border border-spark-border bg-white p-4">
            <div className="text-xs text-spark-muted">{i + 1}. {h.label} · {h.source}</div>
            <a href={h.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-semibold text-spark-ink hover:text-spark-purple">
              {h.headline ?? h.title}
            </a>
            {h.brief && <p className="mt-1 text-sm text-spark-ink-soft">{h.brief}</p>}
            {h.points && h.points.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-spark-ink-soft">
                {h.points.map(pt => (
                  <li key={pt.label}><span className="font-semibold text-spark-ink">{pt.label}</span> · {pt.text}</li>
                ))}
              </ul>
            )}
            {h.headline && h.headline !== h.title && (
              <div className="mt-1 text-xs text-spark-muted">원문 제목 · {h.title}</div>
            )}
          </li>
        ))}
      </ol>
      <details className="mt-6 text-sm text-spark-ink-soft">
        <summary className="cursor-pointer font-semibold">대본 보기</summary>
        <div className="mt-2 space-y-2">{video.script.map((t, i) => <p key={i}>{t}</p>)}</div>
      </details>
      {past.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold text-spark-ink">지난 영상</h2>
            <Link href={`/briefing${tokenQ}`} className="text-sm font-semibold text-spark-purple">전체 보기</Link>
          </div>
          <ul className="mt-2 divide-y divide-spark-border rounded-xl border border-spark-border bg-white">
            {past.map(v => (
              <li key={v.dateKey}>
                <Link href={`/briefing/${v.dateKey}${tokenQ}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-spark-subtle">
                  <span className="font-semibold text-spark-ink">{spokenDate(v.dateKey)}</span>
                  <span className="text-xs text-spark-muted">{v.program === 'weekly' ? '위클리' : '데일리'} · {Math.floor(v.seconds / 60)}분 {v.seconds % 60}초</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
