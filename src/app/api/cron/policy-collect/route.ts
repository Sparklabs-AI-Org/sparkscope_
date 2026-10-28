/**
 * 정책·지원사업 큐레이션 수집 크론 — 평일 10:10 KST(01:10 UTC).
 *
 * 무엇을: 깡프로 스타트업 뉴스(네이버 블로그)가 매일 아침 고른 기사들을 Article로 저장한다.
 *         자세한 구조는 lib/sparkscope/policy-collect.ts 머리말 참고.
 *
 * 왜 10:10인가:
 *   블로그 글이 08:57 전후에 올라온다(실측). 아침 수집·발송 크론(05:50~09:00)이 다 끝난
 *   뒤라 서로 안 겹치고, 그날 글을 당일에 받는다. 평일만 도는 건 글이 평일에만 올라와서다.
 *
 * 왜 AI 분석(analyzeArticles)을 안 태우는가:
 *   analyzer는 "이 기사가 어느 회사 것인가"를 푸는 도구다. 여기 기사들은 회사가 아니라
 *   정책·지원사업 주제로 묶여 있어 회사 매칭이 의미가 없고, 사람이 이미 골라 준 것이라
 *   중요도 판정도 중복이다. LLM 비용만 쓰고 얻는 게 없어 원문 그대로 저장한다.
 *   화면에 요약이 필요해지면 그때 붙인다(대시보드 사전계산과 같은 방식).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  collectPolicyArticles,
  collectDemodayArticles,
  POLICY_CURATOR,
  DEMODAY_SOURCE,
} from '@/lib/sparkscope/policy-collect';
import { fillMissingBodies } from '@/lib/sparkscope/collector';
import { classifyPolicyItems } from '@/lib/sparkscope/policy-classify';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get('days') ?? 3);

  try {
    const curated = await collectPolicyArticles(days);

    // 데모데이는 사이트맵 전체를 보고 "아직 없는 것"만 읽는다(lastmod를 못 믿어서다 —
    // policy-collect.ts 머리말 참고). 이미 저장한 주소를 넘겨 그만큼 요청을 아낀다.
    const known = new Set(
      (
        await prisma.article.findMany({
          where: { source: DEMODAY_SOURCE },  // 칸이 나뉘어 policy_support가 아닌 글도 있다
          select: { link: true },
        })
      ).map(a => a.link),
    );
    const demoday = await collectDemodayArticles(known);

    const raw = [...curated, ...demoday];
    console.log(`[cron:policy-collect] ${POLICY_CURATOR} ${curated.length}건 · ${DEMODAY_SOURCE} ${demoday.length}건`);
    if (raw.length === 0) {
      // 블로그 글 형식이 바뀌면 조용히 0건이 된다 — 가장 위험한 실패라 로그를 남긴다.
      console.warn('[cron:policy-collect] 수집 0건 — 연속되면 블로그 글 형식·데모데이 사이트맵 확인 필요');
      return NextResponse.json({ ok: true, collected: 0, saved: 0 });
    }

    // 본문을 읽어 둔다 — 데일리 브리핑 정책 칸의 대본 재료(Article.bodyText). 예전엔 제목만 저장해서
    // 영상이 제목만 보고 문장을 지어야 했다(2026-10-28).
    const filledBodies = await fillMissingBodies(raw);
    console.log(`[cron:policy-collect] 본문 채움 ${filledBodies}/${raw.length}건`);

    // 칸 나누기 — 정책·지원사업 / 투자·펀드 / AC·VC 업계 / 스파크랩 / 포트폴리오사, 관계없는 기사는 노이즈(2026-10-28 소윤).
    const buckets = await classifyPolicyItems(raw.map(a => ({ title: a.title, body: a.body })));

    let saved = 0;
    let skipped = 0;
    for (const [i, a] of raw.entries()) {
      const b = buckets[i] ?? { category: 'policy_support' as const };
      try {
        const res = await prisma.article.upsert({
          where: { link: a.link },
          create: {
            title: a.title,
            link: a.link,
            source: a.source,
            pubDate: a.pubDate,
            // 회사·투자사에 걸린 기사는 matchedKeyword가 그 이름이 된다(그 칸 화면이 이 이름으로 묶는다).
            matchedKeyword: b.matchedKeyword ?? a.matchedKeyword,
            category: b.category === 'noise' ? a.category : b.category,
            isNoise: b.category === 'noise',
            importance: b.importance ?? null,
            isOverseas: b.isOverseas ?? null,
            curationTopic: b.curationTopic ?? null,
            priorityScore: a.basePriority,
            bodyText: a.body ? a.body.slice(0, 3000) : null,
          },
          // 이미 있는 기사는 그대로 둔다 — 일반 수집기가 먼저 가져왔거나 사람이
          // 스크랩·노이즈 표시를 해 뒀을 수 있다. 덮어쓰지 않는다(비어 있던 본문만 채운다).
          update: a.body ? { bodyText: a.body.slice(0, 3000) } : {},
          select: { collectedAt: true },
        });
        // upsert는 새로 만들었는지 알려주지 않는다. 방금 만든 행만 collectedAt이 지금에 가깝다.
        if (Date.now() - res.collectedAt.getTime() < 60_000) saved++;
        else skipped++;
      } catch (e) {
        console.error('[cron:policy-collect] 저장 실패:', a.link, e);
      }
    }

    console.log(`[cron:policy-collect] 합계 ${raw.length}건 → 신규 ${saved}건 · 기존 ${skipped}건`);
    return NextResponse.json({ ok: true, collected: raw.length, saved, skipped });
  } catch (e: any) {
    console.error('[cron:policy-collect] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
