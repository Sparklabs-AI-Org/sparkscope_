// 데일리 브리핑 페이지 — 잔디 링크가 여기로 온다. 회사 구글 계정 로그인이 필요하다(한 번 로그인하면 이후 자동 유지).
// 메일 링크(토큰)로 들어온 구독자는 토큰으로 본인이 확인되므로 로그인 없이 연다.
// 보여주는 건 공개 기사 헤드라인과 영상뿐이다 — 내부 분석(ourTake·포트폴리오 매칭)은 없다.
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { loadBriefingVideo, listBriefingVideos } from '@/lib/briefing-video/publish';
import { loadBriefingSnapshot } from '@/lib/sparkscope/briefing';
import { spokenDate, longDate } from '@/lib/briefing-video/script';
import BriefingView from '@/components/BriefingView';
import { getSessionUser } from '@/lib/authz';
import { viewerSubscriberId, watchedDates } from '@/lib/briefing-video/viewer';
import { myFeedback, viewerIdentity } from '@/lib/briefing-video/feedback';

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
  // 영상이 늦는 날은 메일이 "준비 중" 안내와 함께 먼저 나간다(08:45) — 그 링크로 들어오면 404 대신 준비 중 화면을 보여 준다.
  // 그날 헤드라인이 확정된 날짜만(없는 날짜는 그대로 404).
  if (!video && !(await loadBriefingSnapshot(params.date).catch(() => null))) notFound();
  // 로그인도 없고 메일 토큰도 없으면 로그인 화면으로 보낸다 — 로그인해야 시청이 개인 기록으로 집계된다.
  const me = await getSessionUser();
  const tokenOwner = searchParams.s
    ? await prisma.digestSubscriber.findUnique({ where: { token: searchParams.s }, select: { id: true } }).catch(() => null)
    : null;
  if (!me && !tokenOwner) redirect(`/login?callbackUrl=${encodeURIComponent(`/briefing/${params.date}`)}`);
  const tokenQ = searchParams.s ? `?s=${encodeURIComponent(searchParams.s)}` : '';
  if (!video) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="text-sm font-semibold text-spark-purple">SparkScope 데일리 브리핑</div>
        <h1 className="mt-1 text-2xl font-bold text-spark-ink">{`[데일리 브리핑] ${longDate(params.date)} 스파크스코프 주요 뉴스`}</h1>
        <div className="mt-6 rounded-2xl border border-spark-border bg-white p-6 text-spark-ink-soft">
          <p className="font-semibold text-spark-ink">오늘 브리핑 영상은 준비가 늦어지고 있습니다. 죄송합니다.</p>
          <p className="mt-2 text-sm">10시 이후 이 페이지에서 다시 확인해 주세요. 영상이 올라가면 잔디로도 알려 드립니다.</p>
        </div>
        <Link href={`/briefing${tokenQ}`} className="mt-6 inline-block text-sm font-semibold text-spark-purple">지난 영상 보기 →</Link>
      </main>
    );
  }
  const past = (await listBriefingVideos(5)).filter(v => v.dateKey !== video.dateKey).slice(0, 7);
  const watched = await watchedDates(await viewerSubscriberId(searchParams.s), past.map(v => v.dateKey));
  const viewer = await viewerIdentity(searchParams.s);
  const mine = viewer ? await myFeedback(video.dateKey, viewer.email) : null;

  return <BriefingView video={video} past={past} watched={watched} token={searchParams.s} mine={mine} />;
}
