/**
 * 지금 보고 있는 사람의 브리핑 시청 여부 — 지난 영상 목록에 "시청함 / 시청 전"을 붙인다(2026-10-26 소윤).
 * 시청 기록(BriefingView)은 메일 토큰 또는 회사 계정 이메일로 구독자에 연결돼 쌓인다(/api/briefing/view와 같은 기준).
 * 재생을 시작한 기록(play 이상)이 있으면 시청함으로 본다. 누군지 모르면 null(표시하지 않음).
 */
import { prisma } from '@/lib/prisma';
import { getRealSessionUser } from '@/lib/authz';

export async function viewerSubscriberId(token?: string): Promise<string | null> {
  if (token) {
    const sub = await prisma.digestSubscriber.findUnique({ where: { token }, select: { id: true } }).catch(() => null);
    if (sub) return sub.id;
  }
  const me = await getRealSessionUser().catch(() => null);
  if (!me?.email) return null;
  const sub = await prisma.digestSubscriber.findUnique({ where: { email: me.email.toLowerCase() }, select: { id: true } }).catch(() => null);
  return sub?.id ?? null;
}

export async function watchedDates(subscriberId: string | null, dateKeys: string[]): Promise<Set<string> | null> {
  if (!subscriberId || dateKeys.length === 0) return subscriberId ? new Set() : null;
  const rows = await prisma.briefingView.findMany({
    where: { subscriberId, dateKey: { in: dateKeys }, event: { in: ['play', 'half', 'complete'] } },
    select: { dateKey: true },
    distinct: ['dateKey'],
  });
  return new Set(rows.map(r => r.dateKey));
}
