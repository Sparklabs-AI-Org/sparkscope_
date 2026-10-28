/**
 * 정책·지원사업(policy_support)에 한 통으로 들어 있던 깡프로·데모데이 기사를 칸별로 다시 나눈다(2026-10-28).
 * 분류 규칙은 수집 크론과 같은 policy-classify.ts. 사람이 노이즈 표시한 기사는 건드리지 않는다.
 *
 *   npx tsx --env-file=.env.local scripts/reclassify-policy.ts [--fund] [--meta] [--dry]   (--fund: 투자·펀드 칸을 다시 본다, --meta: 중요도·국내/해외만 채운다)
 */
import { prisma } from '../src/lib/prisma';
import { classifyPolicyItems } from '../src/lib/sparkscope/policy-classify';

(async () => {
  const dry = process.argv.includes('--dry');
  const rows = await prisma.article.findMany({
    where: { category: process.argv.includes('--fund') ? 'fund_invest' : 'policy_support', isNoise: false },
    select: { id: true, title: true, bodyText: true, matchedKeyword: true },
    orderBy: { pubDate: 'desc' },
  });
  const res = await classifyPolicyItems(rows.map(r => ({ title: r.title, body: r.bodyText })));
  const tally: Record<string, number> = {};
  for (const [i, r] of rows.entries()) {
    const b = res[i]!;
    tally[b.category] = (tally[b.category] ?? 0) + 1;
    if (dry) { console.log(`${b.category}${b.matchedKeyword ? `(${b.matchedKeyword})` : ''} | ${r.title.slice(0, 50)}`); continue; }
    if (!process.argv.includes('--meta') && b.category === (process.argv.includes('--fund') ? 'fund_invest' : 'policy_support')) continue;
    // --meta: 칸은 그대로 두고 중요도·국내/해외만 채운다(2026-10-28 컬럼 추가 후 기존 기사 보충).
    if (process.argv.includes('--meta')) {
      if (b.category !== 'noise') await prisma.article.update({ where: { id: r.id }, data: { importance: b.importance ?? null, isOverseas: b.isOverseas ?? null, curationTopic: b.curationTopic ?? null } });
      continue;
    }
    // --fund는 '관계없음'만 반영한다 — GP 선정 기사가 AC·VC로 옮겨 가는 등 칸 사이 이동은 처음 분류를 믿는다.
    if (process.argv.includes('--fund') && b.category !== 'noise') continue;
    await prisma.article.update({
      where: { id: r.id },
      data: b.category === 'noise'
        ? { isNoise: true }
        : { category: b.category, importance: b.importance ?? null, isOverseas: b.isOverseas ?? null, curationTopic: b.curationTopic ?? null, ...(b.matchedKeyword ? { matchedKeyword: b.matchedKeyword } : {}) },
    });
  }
  console.log(`${rows.length}건`, tally);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
