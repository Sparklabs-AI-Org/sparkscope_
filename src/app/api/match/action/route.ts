// 포폴 매칭 진행 기록 저장(2026-11-26). 사내 계정만 — 포폴사·게스트는 403.
// 같은 짝(포폴사 × 하우스/펀드)은 행 하나를 덮어쓴다. status를 비우면 기록을 지운다.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireInternal } from '@/lib/authz';

export const runtime = 'nodejs';
const STATUSES = ['INTERESTED', 'CONTACTED', 'MEETING', 'PASSED'];

export async function POST(req: Request) {
  const auth = await requireInternal();
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => null);
  const targetId = typeof b?.targetId === 'string' ? b.targetId : '';
  const kind = b?.kind === 'FUND' ? 'FUND' : b?.kind === 'HOUSE' ? 'HOUSE' : '';
  const counterKey = typeof b?.counterKey === 'string' ? b.counterKey.slice(0, 200) : '';
  const counterName = typeof b?.counterName === 'string' ? b.counterName.slice(0, 200) : counterKey;
  if (!targetId || !kind || !counterKey) return NextResponse.json({ error: 'targetId·kind·counterKey는 필수입니다.' }, { status: 400 });
  const exists = await prisma.monitoringTarget.findFirst({ where: { id: targetId, category: 'portfolio_company' }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: '포폴사를 찾을 수 없습니다.' }, { status: 404 });

  const where = { targetId_kind_counterKey: { targetId, kind, counterKey } };
  if (!b.status) {
    await prisma.matchAction.deleteMany({ where: { targetId, kind, counterKey } });
    return NextResponse.json({ status: null });
  }
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'status 값이 올바르지 않습니다.' }, { status: 400 });
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : undefined;
  const row = await prisma.matchAction.upsert({
    where,
    create: { targetId, kind, counterKey, counterName, status: b.status, note, updatedBy: auth.user.email },
    update: { status: b.status, note, counterName, updatedBy: auth.user.email },
  });
  return NextResponse.json({ status: row.status, updatedAt: row.updatedAt });
}
