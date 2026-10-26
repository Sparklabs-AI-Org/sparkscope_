// 지난 브리핑 영상 보관함 — 날짜순 목록. 개별 영상 페이지와 같은 규칙: 회사 구글 계정 로그인 또는 메일 토큰.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { listBriefingVideos } from '@/lib/briefing-video/publish';
import { spokenDate } from '@/lib/briefing-video/script';
import { getSessionUser } from '@/lib/authz';
import { viewerSubscriberId, watchedDates } from '@/lib/briefing-video/viewer';

export const dynamic = 'force-dynamic';

export default async function BriefingArchivePage({ searchParams }: { searchParams: { s?: string } }) {
  const me = await getSessionUser();
  const tokenOwner = searchParams.s
    ? await prisma.digestSubscriber.findUnique({ where: { token: searchParams.s }, select: { id: true } }).catch(() => null)
    : null;
  if (!me && !tokenOwner) redirect(`/login?callbackUrl=${encodeURIComponent('/briefing')}`);
  const tokenQ = searchParams.s ? `?s=${encodeURIComponent(searchParams.s)}` : '';
  const videos = await listBriefingVideos(60);
  const watched = await watchedDates(await viewerSubscriberId(searchParams.s), videos.map(v => v.dateKey));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="text-sm font-semibold text-spark-purple">SparkScope 브리핑</div>
      <h1 className="mt-1 text-2xl font-bold text-spark-ink">지난 영상</h1>
      <p className="mt-1 text-sm text-spark-muted">놓친 브리핑을 날짜별로 다시 볼 수 있어요.</p>
      {videos.length === 0 ? (
        <p className="mt-6 text-sm text-spark-muted">아직 올라온 영상이 없습니다.</p>
      ) : (
        <ul className="mt-5 divide-y divide-spark-border rounded-xl border border-spark-border bg-white">
          {videos.map(v => (
            <li key={v.dateKey}>
              <Link href={`/briefing/${v.dateKey}${tokenQ}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-spark-subtle">
                <span className="font-semibold text-spark-ink">{spokenDate(v.dateKey)}{watched && (watched.has(v.dateKey)
                    ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">시청함</span>
                    : <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">시청 전</span>)}</span>
                <span className="text-xs text-spark-muted">
                  {v.program === 'weekly' ? '위클리' : '데일리'} · 기사 {v.count}건 · {Math.floor(v.seconds / 60)}분 {v.seconds % 60}초
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
