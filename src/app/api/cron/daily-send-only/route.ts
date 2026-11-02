// 발송 전용 엔드포인트 (이미 분류된 데이터를 빠르게 발송)
// 시간: 자동 발송(월~금 08:10부터 5~15분 간격으로 12시까지, 영상이 나오면 발송 — 08:30 도착 목표) 또는 수동 트리거
// 특징: 수집/분석 생략 → 초고속(5초), 타임아웃 불가
import { NextResponse } from 'next/server';
import { runDailyDigest, VIDEO_WAIT_UNTIL_MIN } from '@/lib/sparkscope/runner';
import { prisma } from '@/lib/prisma';
import { kstDateKey, loadBriefingSnapshot, isBriefingPaused, isDigestPaused } from '@/lib/sparkscope/briefing';
import { loadBriefingVideo } from '@/lib/briefing-video/publish';

export const runtime = 'nodejs';
// 발송만 하므로 원래 60초였는데, AI 시그널 섹션이 사전계산을 못 찾으면 그 자리에서
// 목록을 만든다(signal-feed.ts). 그게 최악의 경우 2분 넘게 걸려서 60초로는 발송
// 전체가 타임아웃될 수 있다. 넉넉히 잡는다 — 평소에는 사전계산을 읽어 1초도 안 걸린다.
export const maxDuration = 300;

export async function GET(req: Request) {
  // 인증: Vercel Cron이 보내는 Authorization 헤더 검증
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  // hold=1: 영상이 완성된 뒤에만 보낸다(08:10 이후 여러 번 불려도 한 번만 나간다 — 08:30 도착 목표, 2026-10-22).
  // 메일과 영상은 반드시 같이 나간다 — 영상이 늦으면 메일도 기다린다. 12시까지 재시도하고 그 뒤엔 보내지 않는다(소윤 결정).
  const hold = new URL(req.url).searchParams.get('hold') === '1';
  if (hold) {
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const minutes = kstNow.getHours() * 60 + kstNow.getMinutes();
    if (minutes >= 12 * 60) {
      return NextResponse.json({ ok: true, status: 'deadline-passed', message: '12시 이후라 발송하지 않습니다' });
    }
    const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0, 0);
    const sent = await prisma.digest.findUnique({ where: { date: today }, select: { sentAt: true } });
    if (sent?.sentAt) {
      return NextResponse.json({ ok: true, status: 'already-sent' });
    }
    // 첫 실행(08:10)이 오늘 헤드라인을 확정한 뒤로는, 영상을 기다리는 동안 메일을 처음부터 다시 만들 필요가 없다 — 그 자리에서 끝낸다(2026-11-02).
    // 예전엔 5~15분마다 TOP3 검증 AI·링크 풀기·트렌드 섹션·브리핑 추천을 매번 다시 돌린 뒤 '영상 대기'로 멈췄다(평일 하루 8회 이상).
    // 08:45가 지나면(영상 없이 '준비 중'으로 보내는 시각) 평소대로 끝까지 돈다.
    if (sent && minutes < VIDEO_WAIT_UNTIL_MIN) {
      const dateKey = kstDateKey();
      const [snapshot, video, briefingPaused] = await Promise.all([loadBriefingSnapshot(dateKey), loadBriefingVideo(dateKey), isBriefingPaused()]);
      if (snapshot && !video && !briefingPaused) {
        return NextResponse.json({ ok: true, status: 'waiting-for-video' });
      }
    }
    // 메일 발송 일시 중지 중이면 첫 실행이 기록을 남긴 뒤로는 다시 만들지 않는다.
    if (sent && (await isDigestPaused())) {
      return NextResponse.json({ ok: true, status: 'digest-paused' });
    }
  }

  try {
    console.log('[cron:daily-send-only] 발송 전용 모드 실행');
    const result = await runDailyDigest({
      send: true,
      skipCollect: true, // 🔑 핵심: 수집 건너뛰고 기존 데이터만 사용
      holdUntilVideo: hold,
      baseUrl,
    });

    console.log('[cron:daily-send-only] 발송 완료:', result);
    return NextResponse.json({
      ok: true,
      message: 'Digest sent successfully (send-only mode)',
      result,
    });
  } catch (e: any) {
    console.error('[cron:daily-send-only] 실패:', e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
