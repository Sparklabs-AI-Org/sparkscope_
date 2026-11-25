/**
 * 투자 딜·펀드 추출 크론 — 평일 07:30 KST(전날 22:30 UTC, 요일 0-4).
 * 07:00 policy-collect가 투자 매체 기사(deal_news)를 모은 뒤, 05:50 수집분과 함께 Deal/Fund 테이블로 옮긴다.
 * 자세한 규칙은 lib/sparkscope/deal-extract.ts 머리말. 메일·브리핑과 무관하다.
 * ?days=N&limit=N 으로 범위 조절, ?dry=1 이면 판정만 돌려주고 DB에 쓰지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractDeals } from '@/lib/sparkscope/deal-extract';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  try {
    const r = await extractDeals({
      days: Number(sp.get('days') ?? 3),
      limit: Number(sp.get('limit') ?? 120),
      dryRun: sp.get('dry') === '1',
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    console.error('[cron:deal-extract] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
