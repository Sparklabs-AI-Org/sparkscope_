/**
 * 데모데이 주간 공고 정리(K-Startup 주간 창업공고 TOP 10 · 지난주 가장 많이 본 정부지원사업 TOP 100)의 본문을 채운다.
 *
 * 왜 브라우저로 여나: 데모데이 글은 페이지가 열린 뒤 스크립트가 순위표를 불러와 HTML에는 한 줄 소개(og:description)뿐이다
 * (policy-collect.ts가 저장하는 것). 위클리 브리핑이 이 두 글을 고정 2칸으로 요약해 읽으므로(2026-10-28 소윤) 순위표가 필요하다.
 * 그래서 브리핑 워크플로(GitHub Actions)에서 헤드리스 크로미움으로 열어 화면 글자를 읽는다. 사이트맵·robots가 허용한 /policy 글만 연다.
 *
 * 데모데이는 비로그인 방문자에게 글 몇 편까지만 보여 주고 그 뒤로는 로그인 안내를 띄운다(2026-10-28 실측 3편).
 * 그 제한을 피하려 하지 않는다 — 브리핑에 필요한 최신 회차 2편만 열고, 로그인 안내가 뜨면 바로 멈춘다.
 *
 * 이미 순위표가 있는 글(본문에 "순위"가 있는 것)은 건너뛴다. 실패해도 브리핑을 막지 않는다(종료 코드 0).
 *
 *   npx tsx --env-file=.env.local scripts/fill-demoday-roundups.ts
 */
import { chromium } from 'playwright';
import { prisma } from '../src/lib/prisma';

const BODY_MAX = 4000; // TOP 100은 길다 — 앞쪽 순위만으로 충분하다

(async () => {
  // 최신 회차 2편(창업공고 TOP 10 · 정부지원사업 TOP 100) — 최근 8일 안의 것.
  const rows = (await prisma.article.findMany({
    where: { source: '데모데이', title: { contains: 'TOP' }, pubDate: { gte: new Date(Date.now() - 8 * 864e5) } },
    select: { id: true, link: true, title: true, bodyText: true },
    orderBy: { pubDate: 'desc' },
    take: 2,
  })).filter(r => !r.bodyText?.includes('순위'));
  console.log(`[demoday] 순위표가 없는 공고 정리 ${rows.length}건`);
  if (rows.length === 0) process.exit(0);

  const browser = await chromium.launch();
  let filled = 0;
  try {
    const page = await browser.newPage();
    for (const r of rows) {
      try {
        await page.goto(r.link, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // 순위표는 페이지가 열린 뒤 따로 불러온다 — 표가 그려질 때까지 기다린다.
        await page.waitForFunction(() => document.body.innerText.includes('순위'), undefined, { timeout: 20_000 }).catch(() => {});
        const inner = await page.evaluate(() => ((document.querySelector('article') ?? document.querySelector('main')) as HTMLElement | null)?.innerText ?? '');
        const body = inner.replace(/\n?(마지막 수정|목록보기|글쓰기)[\s\S]*$/, '').trim();
        if (!body.includes('순위')) {
          const page_ = await page.evaluate(() => document.body.innerText);
          if (page_.includes('로그인하면 모든 콘텐츠')) { console.warn('[demoday] 로그인 안내가 떠서 멈춤'); break; }
          console.warn(`[demoday] 순위표를 못 찾음: ${r.title}`);
          continue;
        }
        await prisma.article.update({ where: { id: r.id }, data: { bodyText: body.slice(0, BODY_MAX) } });
        filled++;
      } catch (e) {
        console.warn(`[demoday] 열기 실패(건너뜀): ${r.link}`, e);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[demoday] 본문 채움 ${filled}/${rows.length}`);
  process.exit(0);
})().catch(e => { console.error('[demoday] 실패(브리핑은 계속):', e); process.exit(0); });
