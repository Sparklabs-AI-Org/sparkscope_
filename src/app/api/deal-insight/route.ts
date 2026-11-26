// 투자·펀드 탭 AI 요약을 지금 다시 만든다 — 화면의 "최신으로 다시 분석" 버튼(2026-11-26). 사내 계정만.
// Claude Opus 5.5 한 번 호출(30~60초, 회당 약 $0.12~0.20). 결과는 저장돼 다른 사람은 읽기만 한다.
import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { computeAndStoreDealInsight } from '@/lib/sparkscope/deal-insight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'icn1';
export const maxDuration = 180;

export async function POST() {
  const auth = await requireInternal();
  if (!auth.ok) return auth.response;
  const started = Date.now();
  try {
    const insight = await computeAndStoreDealInsight();
    console.log(`[api/deal-insight] ${auth.user.email} 재분석 ${((Date.now() - started) / 1000).toFixed(1)}s ${insight ? 'OK' : '데이터 없음'}`);
    if (!insight) return NextResponse.json({ ok: false, error: '분석할 딜·펀드 데이터가 아직 없습니다.' }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/deal-insight] 실패', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
