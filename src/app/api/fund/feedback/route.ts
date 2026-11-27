// 펀드 카드 O/X 피드백 저장(2026-11-27 벤처1본부 회의). 사내 계정만 — 포폴사·게스트는 403.
// 한 사람이 한 펀드에 한 줄. verdict를 비우면 내 기록을 지운다.
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireInternal } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await requireInternal();
  if (!auth.ok) return auth.response;
  const email = auth.user.email;
  if (!email) return NextResponse.json({ error: '계정 이메일을 확인할 수 없습니다.' }, { status: 400 });
  const b = await req.json().catch(() => null);
  const fundId = typeof b?.fundId === 'string' ? b.fundId : '';
  if (!fundId) return NextResponse.json({ error: 'fundId는 필수입니다.' }, { status: 400 });
  const exists = await prisma.fund.findUnique({ where: { id: fundId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: '펀드를 찾을 수 없습니다.' }, { status: 404 });

  try {
    if (!b.verdict) {
      await prisma.$executeRaw`DELETE FROM "FundFeedback" WHERE "fundId" = ${fundId} AND "userEmail" = ${email}`;
      return NextResponse.json({ verdict: null });
    }
    if (b.verdict !== 'O' && b.verdict !== 'X') return NextResponse.json({ error: 'verdict 값이 올바르지 않습니다.' }, { status: 400 });
    const verdict: string = b.verdict;
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
    const shownKind = b.shownKind === 'MOTHER' || b.shownKind === 'CHILD' ? b.shownKind : null;
    await prisma.$executeRaw`
      INSERT INTO "FundFeedback" ("id", "fundId", "userEmail", "verdict", "note", "shownKind")
      VALUES (${randomUUID()}, ${fundId}, ${email}, ${verdict}, ${note}, ${shownKind})
      ON CONFLICT ("fundId", "userEmail")
      DO UPDATE SET "verdict" = EXCLUDED."verdict", "note" = EXCLUDED."note", "shownKind" = EXCLUDED."shownKind", "updatedAt" = CURRENT_TIMESTAMP`;
    return NextResponse.json({ verdict, note });
  } catch (e) {
    console.error('[fund-feedback] 저장 실패', (e as Error).message);
    return NextResponse.json({ error: '저장하지 못했습니다.' }, { status: 500 });
  }
}
