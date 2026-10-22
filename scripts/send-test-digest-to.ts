/**
 * 지금 발송 경로 그대로 만든 다이제스트를 주소 한 곳에만 보낸다(테스트용). DB에는 쓰지 않는다.
 *   npx tsx --env-file=.env.local scripts/send-test-digest-to.ts 주소
 * 기사 범위: 어제 09:30 KST ~ 지금.
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import { buildDigestForSend } from '../src/lib/sparkscope/runner';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { sendDigestEmail } from '../src/lib/sparkscope/mailer';
import type { AnalyzedArticle } from '../src/lib/sparkscope/types';

const BASE = 'https://sparkscope.vercel.app';

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) { console.error('받는 주소를 지정하세요.'); process.exit(1); }
  const kstToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const from = new Date(new Date(`${kstToday}T09:30:00+09:00`).getTime() - 86400e3);
  const rows = await prisma.article.findMany({
    where: { pubDate: { gte: from }, isNoise: false, category: { not: 'unrelated' }, analyzedAt: { not: null } },
    select: {
      id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true,
      category: true, importance: true, tone: true, oneLiner: true, ourTake: true,
      relatedCompanies: true, pitchScore: true, pitchTopic: true, riskFlag: true,
      isNoise: true, noiseReason: true, priorityScore: true,
    },
    orderBy: { priorityScore: 'desc' },
    take: 500,
  });
  const analyzed = rows.map((a: any) => ({
    ...a,
    relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
  })) as AnalyzedArticle[];
  console.log(`[test] 기사 후보 ${analyzed.length}건 (${from.toISOString()} ~ 지금)`);
  const data = await buildDigestForSend(analyzed);
  const html = renderDigestHtml(data, BASE, { subscriberToken: 'TEST' });
  const subject = `[SparkScope 테스트] ${kstToday} — 구독 설정 숨김 확인`;
  console.log(`[test] 구독 안내 포함 여부: ${/구독 설정/.test(html) ? '있음' : '없음'}`);
  const r = await sendDigestEmail({ subject, html, to });
  console.log(`[test] 발송 → ${to}`, JSON.stringify(r).slice(0, 200));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
