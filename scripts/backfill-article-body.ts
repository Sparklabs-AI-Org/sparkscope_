/**
 * 본문(Article.bodyText)이 비어 있는 기사를 채운다 — 수집기가 일부 대상만 본문을 읽던 시기(~2026-10-22)의 빈칸 보충용.
 * 비어 있는 행만 건드리고, 이미 있는 본문은 덮어쓰지 않는다. 중간에 끊겨도 다시 실행하면 남은 것만 이어서 한다.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-article-body.ts [--days 7] [--limit 2000] [--dry]
 */
import { prisma } from '../src/lib/prisma';
import { fillMissingBodies } from '../src/lib/sparkscope/collector';
import type { RawArticle } from '../src/lib/sparkscope/types';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const days = Number(argOf('--days') ?? 7);
  const limit = Number(argOf('--limit') ?? 2000);
  const dry = process.argv.includes('--dry');
  const rows = await prisma.article.findMany({
    where: { bodyText: null, isNoise: false, pubDate: { gte: new Date(Date.now() - days * 864e5) } },
    select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true },
    orderBy: { pubDate: 'desc' },
    take: limit,
  });
  console.log(`본문 빈 기사 ${rows.length}건 (최근 ${days}일, 노이즈 제외)`);
  if (dry || rows.length === 0) process.exit(0);

  const CHUNK = 40;
  let filled = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const items = chunk.map(r => ({ ...r, basePriority: 0 })) as unknown as RawArticle[];
    await fillMissingBodies(items);
    for (let j = 0; j < chunk.length; j++) {
      const body = items[j].body;
      if (!body) continue;
      await prisma.article.updateMany({ where: { id: chunk[j].id, bodyText: null }, data: { bodyText: body.slice(0, 3000) } });
      filled++;
    }
    console.log(`${Math.min(i + CHUNK, rows.length)}/${rows.length} 처리 · 채움 ${filled}`);
  }
  console.log(`완료 — ${filled}/${rows.length}건 채움`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
