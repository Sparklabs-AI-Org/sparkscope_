/**
 * 데모데이 정책·자금 글 전체 백필.
 *
 * 평소엔 크론(/api/cron/policy-collect)이 하루 30편씩만 가져온다 — 상대 서버에
 * 한꺼번에 200번 넘게 요청하지 않으려는 제한이다. 처음 붙일 때나 오래 멈춰 있었을 때
 * 한 번에 다 채우려면 이 스크립트를 쓴다.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-demoday-policy.ts
 *   npx tsx --env-file=.env.local scripts/backfill-demoday-policy.ts --max 50
 *
 * 이미 저장한 주소는 건너뛰므로 중간에 끊겨도 그냥 다시 실행하면 이어서 진행된다.
 */
import { PrismaClient } from '@prisma/client';
import { collectDemodayArticles, DEMODAY_SOURCE } from '../src/lib/sparkscope/policy-collect';

const prisma = new PrismaClient();

async function main() {
  const i = process.argv.indexOf('--max');
  const max = i > 0 ? Number(process.argv[i + 1]) : 1000;

  const known = new Set(
    (
      await prisma.article.findMany({
        where: { source: DEMODAY_SOURCE, category: 'policy_support' },
        select: { link: true },
      })
    ).map(a => a.link),
  );
  console.log(`이미 저장된 데모데이 글 ${known.size}건 — 나머지를 최대 ${max}편까지 읽는다`);

  const raw = await collectDemodayArticles(known, max);
  console.log(`새로 읽은 글 ${raw.length}건 — 저장 시작`);

  let saved = 0;
  for (const a of raw) {
    try {
      await prisma.article.create({
        data: {
          title: a.title,
          link: a.link,
          source: a.source,
          pubDate: a.pubDate,
          matchedKeyword: a.matchedKeyword,
          category: a.category,
          priorityScore: a.basePriority,
        },
      });
      saved++;
      if (saved % 25 === 0) console.log(`  ... ${saved}/${raw.length}`);
    } catch (e: any) {
      // link가 unique라 이미 있으면 P2002 — 정상이므로 조용히 넘긴다.
      if (e?.code !== 'P2002') console.error('저장 실패:', a.link, e?.message ?? e);
    }
  }
  const total = await prisma.article.count({ where: { source: DEMODAY_SOURCE, category: 'policy_support' } });
  console.log(`완료 — 이번에 ${saved}건 저장 · 데모데이 글 총 ${total}건`);
  await prisma.$disconnect();
}

main();
