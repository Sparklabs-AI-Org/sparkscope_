/**
 * 브리핑 발행 일시 중지·재개(briefing.ts BRIEFING_PAUSE).
 *   on     — 멈춤: 영상 제작·잔디·지연 알림을 건너뛰고, 메일은 브리핑 링크 없이 제시각에 나간다
 *   off    — 다시 시작
 *   status — 지금 상태
 *
 *   npx tsx --env-file=.env.local scripts/briefing-pause.ts on|off|status
 */
import { prisma } from '../src/lib/prisma';
import { BRIEFING_PAUSE, isBriefingPaused } from '../src/lib/sparkscope/briefing';

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'on') {
    await prisma.dashboardInsight.upsert({
      where: { kind_key: BRIEFING_PAUSE },
      create: { ...BRIEFING_PAUSE, value: JSON.stringify({ since: new Date().toISOString() }) },
      update: { value: JSON.stringify({ since: new Date().toISOString() }) },
    });
  } else if (cmd === 'off') {
    await prisma.dashboardInsight.deleteMany({ where: BRIEFING_PAUSE });
  } else if (cmd !== 'status') {
    console.error('사용법: briefing-pause.ts on|off|status');
    process.exit(1);
  }
  console.log(`브리핑 발행: ${(await isBriefingPaused()) ? '⏸ 일시 중지' : '▶ 정상'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
