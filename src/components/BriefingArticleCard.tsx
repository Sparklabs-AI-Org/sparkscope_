// 브리핑 페이지 기사 카드 — 모바일에서 한눈에 훑도록 제목만 보이고, 요약·사실은 「자세히」로 접는다(2026-11-05 은빛).
import type { ComponentProps } from 'react';
import BriefingFeedback from '@/components/BriefingFeedback';
import { SECTION_COLOR, sectionOf } from '@/lib/briefing-video/sections';
import type { BriefingVideoRecord } from '@/lib/briefing-video/publish';

const shortLabel = (label: string) => label.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}️\s]+/u, '');

export default function BriefingArticleCard({ h, feedback }: {
  h: BriefingVideoRecord['headlines'][number];
  /** 누군지 확인된 시청자일 때만 넘긴다 — 없으면 👍👎를 그리지 않는다 */
  feedback?: Omit<ComponentProps<typeof BriefingFeedback>, 'children' | 'url'>;
}) {
  const head = (
    <>
      <div className="truncate text-[11px] text-spark-muted">{shortLabel(h.label)} · {h.source}</div>
      <a href={h.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-[15px] font-semibold leading-snug text-spark-ink">
        {h.headline ?? h.title}
      </a>
    </>
  );
  return (
    <li className="relative overflow-hidden rounded-xl border border-spark-border bg-white py-2.5 pl-4 pr-3">
      {/* 왼쪽 세로 띠 — 영상과 같은 섹션 색 */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: SECTION_COLOR[sectionOf(h)].fill }} />
      {feedback ? <BriefingFeedback {...feedback} url={h.url}>{head}</BriefingFeedback> : head}
      <details className="mt-1 text-sm text-spark-ink-soft">
        <summary className="cursor-pointer text-xs font-semibold text-spark-muted">자세히</summary>
        {h.brief && <p className="mt-1">{h.brief}</p>}
        {h.points && h.points.length > 0 && (
          <ul className="mt-1 space-y-1">
            {h.points.map(pt => (
              <li key={pt.label}><span className="font-semibold text-spark-ink">{pt.label}</span> · {pt.text}</li>
            ))}
          </ul>
        )}
        <a
          href={h.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block rounded-lg border border-spark-border px-3 py-1.5 text-xs font-semibold text-spark-ink"
        >
          기사 전문 보기 →
        </a>
      </details>
    </li>
  );
}
