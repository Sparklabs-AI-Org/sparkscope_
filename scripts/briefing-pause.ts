/**
 * 브리핑·메일 발행 일시 중지·재개(briefing.ts BRIEFING_PAUSE · DIGEST_PAUSE).
 *   on|off [briefing|mail|all]  — 대상 기본값 briefing
 *     briefing: 영상 제작·잔디·지연 알림을 건너뛰고, 메일은 브리핑 링크 없이 나간다
 *     mail:     다이제스트 메일 발송을 건너뛴다(헤드라인 확정·발송 기록은 그대로)
 *   status — 지금 상태
 *
 *   npx tsx --env-file=.env.local scripts/briefing-pause.ts on all
 */
import { prisma } from '../src/lib/prisma';
import { BRIEFING_PAUSE, DIGEST_PAUSE, isBriefingPaused, isDigestPaused } from '../src/lib/sparkscope/briefing';

(async () => {
  const [cmd, target = 'briefing'] = process.argv.slice(2);
  const keys = target === 'all' ? [BRIEFING_PAUSE, DIGEST_PAUSE] : target === 'mail' ? [DIGEST_PAUSE] : target === 'briefing' ? [BRIEFING_PAUSE] : null;
  if (!keys || !['on', 'off', 'status'].includes(cmd ?? '')) {
    console.error('사용법: briefing-pause.ts on|off|status [briefing|mail|all]');
    process.exit(1);
  }
  for (const k of cmd === 'status' ? [] : keys) {
    if (cmd === 'on') {
      const value = JSON.stringify({ since: new Date().toISOString() });
      await prisma.dashboardInsight.upsert({ where: { kind_key: k }, create: { ...k, value }, update: { value } });
    } else {
      await prisma.dashboardInsight.deleteMany({ where: k });
    }
  }
  console.log(`브리핑: ${(await isBriefingPaused()) ? '⏸ 일시 중지' : '▶ 정상'} · 메일: ${(await isDigestPaused()) ? '⏸ 일시 중지' : '▶ 정상'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
