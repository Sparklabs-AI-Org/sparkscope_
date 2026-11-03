// 브리핑 영상 시청 이벤트 수집. 로그인 없이 열리는 페이지에서 부르므로 공개 API다(middleware PUBLIC_API_EXACT).
// 누가 봤는지는 남기지 않는다 — 횟수만 센다(2026-11-03 회의). visitorId는 익명 브라우저 값이다.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const EVENTS = new Set(['open', 'play', 'half', 'complete']);

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const dateKey = typeof body?.dateKey === 'string' ? body.dateKey : '';
  const event = typeof body?.event === 'string' ? body.event : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !EVENTS.has(event)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const visitorId = typeof body?.visitorId === 'string' && body.visitorId.length <= 64 ? body.visitorId : null;
  await prisma.briefingView.create({ data: { dateKey, event, visitorId } });
  return NextResponse.json({ ok: true });
}
