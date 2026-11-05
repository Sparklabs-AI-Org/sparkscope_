// 브리핑 페이지 본문 — 모바일에서 영상과 기사 제목이 먼저 보이도록 글을 줄였다(2026-11-05 은빛).
import Link from 'next/link';
import BriefingTracker from '@/components/BriefingTracker';
import BriefingArticleCard from '@/components/BriefingArticleCard';
import BriefingRecommend from '@/components/BriefingRecommend';
import { spokenDate } from '@/lib/briefing-video/script';
import type { BriefingVideoRecord, BriefingVideoSummary } from '@/lib/briefing-video/publish';
import type { FeedbackVote } from '@/lib/briefing-video/feedback-reasons';

interface Props {
  video: Pick<BriefingVideoRecord, 'dateKey' | 'url' | 'audioUrl' | 'program' | 'headlines' | 'script'>;
  past: Pick<BriefingVideoSummary, 'dateKey' | 'program' | 'seconds' | 'url' | 'audioUrl'>[];
  watched: Set<string> | null;
  token?: string;
  /** 시청자가 그날 남긴 피드백. 누군지 모르면 null — 👍👎를 그리지 않는다 */
  mine: Map<string, { vote: FeedbackVote; reason?: string; comment?: string }> | null;
  /** 검토용 화면 — 시청 기록을 남기지 않고, 버튼을 눌러도 저장하지 않는다 */
  demo?: boolean;
}

export default function BriefingView({ video, past, watched, token, mine, demo }: Props) {
  const tokenQ = token ? `?s=${encodeURIComponent(token)}` : '';
  const name = video.program === 'weekly' ? '위클리 브리핑' : '데일리 브리핑';
  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      {demo
        ? <p className="mb-2 rounded-lg bg-spark-light-purple px-3 py-1.5 text-xs text-spark-ink-soft">검토용 화면입니다. 👍👎와 기사 추천은 눌러 볼 수 있지만 저장되지 않습니다.</p>
        : <BriefingTracker dateKey={video.dateKey} token={token} title={`${name} · ${spokenDate(video.dateKey)}`} />}
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold text-spark-ink">{spokenDate(video.dateKey)} 브리핑</h1>
        {!demo && <Link href={`/briefing${tokenQ}`} className="shrink-0 text-xs font-semibold text-spark-purple">지난 영상</Link>}
      </div>
      <video src={video.url} controls playsInline preload="metadata" className="mt-2 w-full rounded-xl bg-black aspect-video" />
      {video.audioUrl && (
        <div className="mt-2 rounded-xl border border-spark-border bg-white p-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-bold text-spark-ink">🎧 소리로 듣기</span>
            <span className="text-xs text-spark-muted">화면을 끄거나 다른 앱으로 넘어가도 계속 들려요</span>
          </div>
          <audio src={video.audioUrl} controls preload="none" className="mt-1.5 h-10 w-full" />
        </div>
      )}
      {mine && <p className="mt-3 text-xs text-spark-ink-soft">👍👎를 많이 남겨 주시면 매주 커피를 드려요 ☕</p>}
      <ol className="mt-2 space-y-2">
        {video.headlines.map(h => (
          <BriefingArticleCard
            key={h.url}
            h={h}
            feedback={mine ? { dateKey: video.dateKey, token, initial: mine.get(h.url), demo } : undefined}
          />
        ))}
      </ol>
      {mine && <BriefingRecommend dateKey={video.dateKey} token={token} demo={demo} />}
      <details className="mt-3 text-sm text-spark-ink-soft">
        <summary className="cursor-pointer text-xs font-semibold text-spark-muted">대본 보기</summary>
        <div className="mt-2 space-y-2">{video.script.map((t, i) => <p key={i}>{t}</p>)}</div>
      </details>
      {past.length > 0 && (
        <section className="mt-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-spark-ink">지난회 듣기</h2>
            {!demo && <Link href={`/briefing${tokenQ}`} className="text-xs font-semibold text-spark-purple">전체 보기</Link>}
          </div>
          <ul className="mt-1.5 divide-y divide-spark-border rounded-xl border border-spark-border bg-white">
            {past.map(v => (
              <li key={v.dateKey}>
                <details className="px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                    <span className="min-w-0 font-semibold text-spark-ink">
                      {spokenDate(v.dateKey)}
                      {watched && (watched.has(v.dateKey)
                        ? <span className="ml-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">시청함</span>
                        : <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">시청 전</span>)}
                    </span>
                    <span className="shrink-0 text-xs text-spark-muted">
                      {Math.floor(v.seconds / 60)}분 {v.seconds % 60}초 · <span className="font-semibold text-spark-purple">▶ 듣기</span>
                    </span>
                  </summary>
                  {/* 소리 파일이 없는 예전 회차는 영상 파일의 소리를 듣는다 */}
                  <audio src={v.audioUrl ?? v.url} controls preload="none" className="mt-2 h-10 w-full" />
                  {!demo && <Link href={`/briefing/${v.dateKey}${tokenQ}`} className="mt-1 inline-block text-xs font-semibold text-spark-purple">영상으로 보기 →</Link>}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
