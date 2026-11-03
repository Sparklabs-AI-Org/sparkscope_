// 이용 현황 — 날짜별 로그인 횟수와 브리핑 시청 횟수. 관리자 전용.
// 누가 봤는지는 보여주지 않는다(남기지도 않는다 — 2026-11-03 회의).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/authz';
import { addDays, kstToday, usageByDay } from '@/lib/sparkscope/usage-stats';

export const dynamic = 'force-dynamic';

const RANGES = [7, 30, 90];

export default async function UsageStatsPage({ searchParams }: { searchParams: { days?: string } }) {
  // ADMIN 역할만(명단 기준). canManage 는 스크랩 허용 목록도 통과시키므로 쓰지 않는다.
  const user = await getSessionUser();
  if (user?.role !== 'ADMIN' || !user.active) redirect('/dashboard');

  const days = RANGES.includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;
  const to = kstToday();
  const rows = await usageByDay(addDays(to, -(days - 1)), to);
  const sum = rows.reduce((a, r) => ({ logins: a.logins + r.logins, opens: a.opens + r.opens, plays: a.plays + r.plays, completes: a.completes + r.completes }), { logins: 0, opens: 0, plays: 0, completes: 0 });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-spark-ink">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-spark-purple">관리자 전용</div>
          <h1 className="mt-1 text-2xl font-bold">📊 SparkScope 이용 현황</h1>
        </div>
        <Link href="/dashboard" className="text-sm text-spark-ink-soft hover:text-spark-purple">← 대시보드</Link>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {RANGES.map(d => (
          <Link key={d} href={`/dashboard/briefing-stats?days=${d}`} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${d === days ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40'}`}>
            최근 {d}일
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-spark-muted">로그인은 새로 로그인한 횟수(세션 90일 유지라 매 방문이 아님) · 브리핑은 브리핑 날짜 기준 · 누가 봤는지는 기록하지 않습니다</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-spark-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-spark-light-purple text-left text-spark-ink-soft">
            <tr>
              <th className="px-3 py-2">날짜</th>
              <th className="px-3 py-2 text-right">로그인</th>
              <th className="px-3 py-2 text-right">브리핑 열기</th>
              <th className="px-3 py-2 text-right">재생</th>
              <th className="px-3 py-2 text-right">끝까지 봄</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-spark-border bg-spark-subtle font-semibold">
              <td className="px-3 py-2">합계</td>
              <td className="px-3 py-2 text-right">{sum.logins}</td>
              <td className="px-3 py-2 text-right">{sum.opens}</td>
              <td className="px-3 py-2 text-right">{sum.plays}</td>
              <td className="px-3 py-2 text-right">{sum.completes}</td>
            </tr>
            {rows.map(r => (
              <tr key={r.date} className="border-t border-spark-border">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2 text-right">{r.logins}</td>
                <td className="px-3 py-2 text-right">{r.opens}</td>
                <td className="px-3 py-2 text-right">{r.plays}</td>
                <td className="px-3 py-2 text-right">{r.completes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
