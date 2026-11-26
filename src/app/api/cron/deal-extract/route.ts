/**
 * 투자 딜·펀드 추출 크론 — 평일 07:30 KST(전날 22:30 UTC, 요일 0-4).
 * 07:00 policy-collect가 투자 매체 기사(deal_news)를 모은 뒤, 05:50 수집분과 함께 Deal/Fund 테이블로 옮긴다.
 * 자세한 규칙은 lib/sparkscope/deal-extract.ts 머리말. 메일·브리핑과 무관하다.
 * ?days=N&limit=N 으로 범위 조절, ?dry=1 이면 판정만 돌려주고 DB에 쓰지 않는다.
 * 투자·펀드 탭 AI 요약(deal-insight.ts)은 여기서 자동으로 만들지 않는다 — 화면 버튼을 누를 때만(2026-11-26). ?insight=1 은 수동 재계산용.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractDeals } from '@/lib/sparkscope/deal-extract';
import { computeAndStoreDealInsight } from '@/lib/sparkscope/deal-insight';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  try {
    if (sp.get('insight') === '1') return NextResponse.json({ ok: true, insight: await computeAndStoreDealInsight() });
    const dryRun = sp.get('dry') === '1';
    const r = await extractDeals({
      days: Number(sp.get('days') ?? 3),
      limit: Number(sp.get('limit') ?? 120),
      dryRun,
      budgetMs: 200_000,
    });
    // 남는 시간에 지난 90일 투자·펀드 탭(fund_invest) 기사 중 아직 안 본 것을 채운다 — 펀드 결성 분석의 재료.
    // 한 번 본 기사는 표시되므로 밀린 게 다 차면 매일 0건으로 끝난다(2026-11-26).
    const backfill = dryRun ? null : await extractDeals({ days: 90, limit: 40, fundInvestOnly: true, budgetMs: 45_000 });
    return NextResponse.json({ ok: true, ...r, backfill });
  } catch (e: any) {
    console.error('[cron:deal-extract] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
