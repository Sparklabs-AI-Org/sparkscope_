// 대표 검토용 브리핑 화면 — 검토용 브랜치에만 있고 main에 합치지 않는다. DB·로그인 없이 열리며 저장하지 않는다.
// 기사·대본은 확정본(data/briefing-review-2026-11-05.json), 영상은 public/review/에 둔다.
import BriefingView from '@/components/BriefingView';
import review from '../../../data/briefing-review-2026-11-05.json';

export const dynamic = 'force-dynamic';

export default function BriefingReviewPage() {
  const video = {
    dateKey: review.dateKey,
    program: 'daily' as const,
    url: `/review/briefing-${review.dateKey}.mp4`,
    headlines: review.items.map(({ script, ...h }) => ({ ...h, brief: script })),
    script: review.script,
  };
  return <BriefingView video={video} past={[]} watched={null} mine={new Map()} demo />;
}
