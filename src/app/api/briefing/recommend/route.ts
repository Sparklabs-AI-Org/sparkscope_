// 임직원 기사 추천 저장. 메일 토큰으로 로그인 없이 열리는 페이지에서도 부르므로 공개 API다(middleware PUBLIC_API_EXACT).
// 대신 누군지 확인되는 사람만, 실제 방송된 날짜에, 하루 정해진 건수까지만 남길 수 있다.
// 링크는 저장만 하고 서버에서 열지 않는다. 관리자 화면에 링크로 그려지므로 http(s)만 받는다.
import { NextResponse } from 'next/server';
import { loadBriefingVideo } from '@/lib/briefing-video/publish';
import { RECOMMEND_DAILY_MAX, recommendationCount, saveRecommendation, viewerIdentity } from '@/lib/briefing-video/feedback';

export const runtime = 'nodejs';

function webLink(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 2000) return null;
  try {
    const u = new URL(text.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const dateKey = typeof body?.dateKey === 'string' ? body.dateKey : '';
  const url = webLink(body?.url);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !url) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' && body.token.length <= 64 ? body.token : undefined;
  const viewer = await viewerIdentity(token);
  if (!viewer) return NextResponse.json({ error: 'unknown viewer' }, { status: 401 });

  if (!(await loadBriefingVideo(dateKey))) return NextResponse.json({ error: 'no briefing' }, { status: 404 });
  if ((await recommendationCount(dateKey, viewer.email)) >= RECOMMEND_DAILY_MAX) {
    return NextResponse.json({ error: 'too many' }, { status: 429 });
  }

  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 300) : '';
  await saveRecommendation({ ...viewer, dateKey, url, comment: comment || undefined, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
