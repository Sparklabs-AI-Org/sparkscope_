// 월~금 브리핑 잔디 알림 — 08:30부터 12시까지 재시도(영상과 메일이 둘 다 나갔을 때만 전송, 월=위클리·화~금=데일리) · ?test=1 연결 테스트.
import { NextResponse } from 'next/server';
import { notifyBriefing, sendJandiTest } from '@/lib/briefing-video/notify';
import { isBriefingPaused } from '@/lib/sparkscope/briefing';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const u = new URL(req.url);
  try {
    // ?test=1 — 연결 확인용 테스트 메시지(발송 기록 안 남김)
    if (u.searchParams.get('test') === '1') {
      await sendJandiTest(process.env.NEXTAUTH_URL ?? u.origin);
      return NextResponse.json({ ok: true, status: 'test-sent' });
    }
    // 발행 일시 중지 중이면 잔디도 보내지 않는다(briefing.ts isBriefingPaused).
    if (await isBriefingPaused()) return NextResponse.json({ ok: true, status: 'paused' });
    const result = await notifyBriefing({
      final: u.searchParams.get('final') === '1',
      baseUrl: process.env.NEXTAUTH_URL ?? u.origin,
    });
    console.log('[briefing-notify]', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[briefing-notify] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
