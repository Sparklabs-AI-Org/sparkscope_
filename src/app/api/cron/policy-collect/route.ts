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
import { collectPolicyArticles, POLICY_CURATOR } from '@/lib/sparkscope/policy-collect';
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
    const raw = await collectPolicyArticles(days);
    if (raw.length === 0) {
      // 블로그 글 형식이 바뀌면 조용히 0건이 된다 — 가장 위험한 실패라 로그를 남긴다.
      console.warn('[cron:policy-collect] 수집 0건 — 연속되면 블로그 글 형식 변경 여부 확인 필요');
      return NextResponse.json({ ok: true, collected: 0, saved: 0 });
    }

    let saved = 0;
    let skipped = 0;
    for (const a of raw) {
      try {
        const res = await prisma.article.upsert({
          where: { link: a.link },
          create: {
            title: a.title,
            link: a.link,
            source: a.source,
            pubDate: a.pubDate,
            matchedKeyword: a.matchedKeyword,
            category: a.category,
            priorityScore: a.basePriority,
          },
          // 이미 있는 기사는 그대로 둔다 — 일반 수집기가 먼저 가져왔거나 사람이
          // 스크랩·노이즈 표시를 해 뒀을 수 있다. 덮어쓰지 않는다.
          update: {},
          select: { collectedAt: true },
        });
        // upsert는 새로 만들었는지 알려주지 않는다. 방금 만든 행만 collectedAt이 지금에 가깝다.
        if (Date.now() - res.collectedAt.getTime() < 60_000) saved++;
        else skipped++;
      } catch (e) {
        console.error('[cron:policy-collect] 저장 실패:', a.link, e);
      }
    }

    console.log(
      `[cron:policy-collect] ${POLICY_CURATOR} ${raw.length}건 → 신규 ${saved}건 · 기존 ${skipped}건`,
    );
    return NextResponse.json({ ok: true, collected: raw.length, saved, skipped });
  } catch (e: any) {
    console.error('[cron:policy-collect] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
