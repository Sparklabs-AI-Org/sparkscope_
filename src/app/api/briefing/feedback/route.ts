// 브리핑 기사 피드백 저장. 메일 토큰으로 로그인 없이 열리는 페이지에서도 부르므로 공개 API다(middleware PUBLIC_API_EXACT).
// 대신 누군지 확인되는 사람만, 그날 브리핑에 실제로 나온 기사에만 남길 수 있다.
import { NextResponse } from 'next/server';
import { loadBriefingVideo } from '@/lib/briefing-video/publish';
import { clearFeedback, saveFeedback, viewerIdentity } from '@/lib/briefing-video/feedback';
import { FEEDBACK_REASONS } from '@/lib/briefing-video/feedback-reasons';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const dateKey = typeof body?.dateKey === 'string' ? body.dateKey : '';
  const url = typeof body?.url === 'string' ? body.url : '';
  const vote = body?.vote;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !url || !['up', 'down', null].includes(vote)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' && body.token.length <= 64 ? body.token : undefined;
  const viewer = await viewerIdentity(token);
  if (!viewer) return NextResponse.json({ error: 'unknown viewer' }, { status: 401 });

  const video = await loadBriefingVideo(dateKey);
  const headline = video?.headlines.find(h => h.url === url);
  if (!headline) return NextResponse.json({ error: 'not in briefing' }, { status: 404 });

  if (vote === null) {
    await clearFeedback(dateKey, url, viewer.email);
    return NextResponse.json({ ok: true });
  }
  const reason = vote === 'down' && (FEEDBACK_REASONS as readonly string[]).includes(body?.reason) ? body.reason as string : undefined;
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 300) : '';
  await saveFeedback({
    ...viewer, dateKey, url, title: headline.headline ?? headline.title, vote, reason, comment: comment || undefined, at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
