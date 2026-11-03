/**
 * 이용 현황 — 로그인 횟수와 브리핑 시청 횟수만 센다(2026-11-03 회의).
 *
 * 예전엔 구독자·본부별로 누가 봤는지까지 남겼지만, 관리할 게 늘고 코드가 무거워져 뺐다.
 * 사람을 가리키는 값은 남기지 않는다 — 날짜별 숫자뿐이다.
 *
 * 로그인 횟수는 DashboardInsight(kind 'login_count', key KST 날짜, value 숫자 문자열)에 쌓는다.
 * 세션이 90일 유지라 "로그인"은 새로 들어온 횟수다(매 방문이 아니다).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const LOGIN_KIND = 'login_count';

/** 한국 기준 오늘 날짜 키(YYYY-MM-DD). */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 날짜 키에 n일을 더한다(음수 가능). */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 오늘 로그인 수를 1 올린다. 동시에 들어와도 빠지지 않게 DB에서 더한다. */
export async function countLogin(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "DashboardInsight" (id, kind, key, value, "computedAt", "updatedAt")
    VALUES (${`login_${kstToday()}`}, ${LOGIN_KIND}, ${kstToday()}, '1', now(), now())
    ON CONFLICT (kind, key) DO UPDATE SET value = (("DashboardInsight".value)::int + 1)::text, "updatedAt" = now()
  `;
}

export type DayRow = { date: string; logins: number; opens: number; plays: number; completes: number };

/** 날짜별 로그인·브리핑 시청 횟수(양 끝 포함, 최근 날짜가 위). 브리핑은 브리핑 날짜 기준. */
export async function usageByDay(from: string, to: string): Promise<DayRow[]> {
  const [logins, views] = await Promise.all([
    prisma.dashboardInsight.findMany({
      where: { kind: LOGIN_KIND, key: { gte: from, lte: to } },
      select: { key: true, value: true },
    }),
    prisma.$queryRaw<{ dateKey: string; opens: bigint; plays: bigint; completes: bigint }[]>(Prisma.sql`
      SELECT "dateKey",
        COUNT(*) FILTER (WHERE event = 'open') AS opens,
        COUNT(*) FILTER (WHERE event = 'play') AS plays,
        COUNT(*) FILTER (WHERE event = 'complete') AS completes
      FROM "BriefingView"
      WHERE "dateKey" BETWEEN ${from} AND ${to}
      GROUP BY 1
    `),
  ]);
  const loginOf = new Map(logins.map(r => [r.key, Number(r.value) || 0]));
  const viewOf = new Map(views.map(r => [r.dateKey, r]));
  const out: DayRow[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const v = viewOf.get(d);
    out.push({
      date: d,
      logins: loginOf.get(d) ?? 0,
      opens: Number(v?.opens ?? 0),
      plays: Number(v?.plays ?? 0),
      completes: Number(v?.completes ?? 0),
    });
  }
  return out;
}
