// 메일·영상·잔디가 제시각에 안 나간 날 SparkScope 관리자(ADMIN_EMAILS)에게 알린다(2026-10-22 소윤 요청).
// 셋은 반드시 같이 나가고 하나라도 늦으면 셋 다 12시까지 재시도한다 — 그래서 "늦어진 날"을 사람이 알 수 있어야 한다.
//   09:00 KST(stage=late)  아직 안 나감 → 상태 알림(자동 재시도 중)
//   12:00 KST(stage=final) 끝내 안 나감 → 오늘은 발송하지 않았다는 알림
// 같은 날 같은 단계는 한 번만 보낸다(DashboardInsight briefing_delay_alert). ?dry=1이면 보내지 않고 내용만 돌려준다.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { adminEmails } from '@/lib/roles';
import { kstDateKey, broadcastFor, loadBriefingSnapshot } from '@/lib/sparkscope/briefing';
import { loadBriefingVideo } from '@/lib/briefing-video/publish';
import { sendAdminAlert } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';
const KIND = 'briefing_delay_alert';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const u = new URL(req.url);
  const stage = u.searchParams.get('stage') === 'final' ? 'final' : 'late';
  const dry = u.searchParams.get('dry') === '1';

  const dateKey = kstDateKey();
  const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  // Digest.date는 한국 날짜의 UTC 자정으로 저장된다 — 서버 시간대와 무관하게 같은 값을 만든다.
  const mailDay = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()));
  const todayStartUtc = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()) - 9 * 3600e3);

  const [video, mail, notified, snapshot, collect] = await Promise.all([
    loadBriefingVideo(dateKey).catch(() => null),
    prisma.digest.findUnique({ where: { date: mailDay }, select: { sentAt: true, errorMsg: true } }),
    prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: 'briefing_notified', key: dateKey } } }),
    loadBriefingSnapshot(dateKey).catch(() => null),
    prisma.runLog.findFirst({ where: { runType: 'daily-collect', startedAt: { gte: todayStartUtc } }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true, finishedAt: true } }),
  ]);
  if (!dry && video && mail?.sentAt && notified) return NextResponse.json({ ok: true, status: 'all-sent' });

  const key = `${dateKey}:${stage}`;
  if (!dry && (await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: KIND, key } } }))) {
    return NextResponse.json({ ok: true, status: 'already-alerted' });
  }

  const hhmm = (d?: Date | null) => (d ? new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : '—');
  const program = broadcastFor().program === 'weekly' ? '위클리' : '데일리';
  const lines = [
    stage === 'final'
      ? `오늘(${dateKey}) ${program} 브리핑 메일·영상·잔디가 12시까지 나가지 않았습니다. 오늘 자동 발송은 중단됐습니다.`
      : `오늘(${dateKey}) ${program} 브리핑 메일·영상·잔디가 아직 나가지 않았습니다(평소 08:30). 12시까지 15분마다 자동 재시도합니다.`,
    '',
    `- 영상: ${video ? `완료(${hhmm(new Date(video.publishedAt))})` : '없음'}`,
    `- 메일: ${mail?.sentAt ? `발송(${hhmm(mail.sentAt)})` : `미발송${mail?.errorMsg ? ` — ${mail.errorMsg.slice(0, 120)}` : ''}`}`,
    `- 잔디: ${notified ? '전송' : '미전송'}`,
    `- 헤드라인 확정: ${snapshot ? '완료' : '없음'}`,
    `- 오늘 수집: ${collect ? `${collect.status}(시작 ${hhmm(collect.startedAt)}, 종료 ${hhmm(collect.finishedAt)})` : '기록 없음'}`,
    '',
    '확인할 곳: GitHub Actions의 Daily Briefing Video · Daily Collect 실행 기록, Vercel 크론 로그.',
    stage === 'final'
      ? '수동으로 보내려면 영상을 먼저 만든 뒤(Actions → Daily Briefing Video → Run workflow) 검수 화면에서 발송하세요.'
      : '영상이 실패했으면 10:00에 한 번 더 자동으로 만듭니다.',
  ];
  const to = adminEmails();
  const subject = stage === 'final' ? `[SparkScope] 오늘 브리핑 미발송 (${dateKey})` : `[SparkScope] 브리핑 발송 지연 (${dateKey})`;
  if (dry) return NextResponse.json({ ok: true, dry: true, to, subject, text: lines.join('\n') });

  const sent = await sendAdminAlert(to, subject, lines.join('\n'));
  if (sent) {
    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: KIND, key } },
      create: { kind: KIND, key, value: JSON.stringify({ at: new Date().toISOString(), to }) },
      update: {},
    });
  }
  return NextResponse.json({ ok: sent, status: sent ? 'alerted' : 'alert-failed', to: to.length });
}
