'use client';
// 정책·지원사업 / 투자·펀드 탭 — 깡프로·데모데이 큐레이션 기사를 조회 기간 안에서 날짜별로 보여준다.
// 예전엔 최근 하루(뒤엔 7일)치 카드 6장 + 원본 표였는데, 표는 빼고(2026-10-28) 카드만 남겼더니 화면이 비어 보였다(소윤).
// 정책 탭은 데모데이의 주간 공고 정리(창업공고 TOP 10 · 정부지원사업 TOP 100)를 맨 위에 고정한다 — 이 탭에서 가장 쓸모 있는 글이다.
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { articleTitle } from '@/lib/sparkscope/article-title';

const DAYS_SHOWN = 5;
const PINNED_SOURCE = '데모데이';

interface Item {
  id: string;
  title: string;
  titleKo?: string | null;
  titleEn?: string | null;
  link: string;
  source: string;
  pubDate: string | Date;
  snippet?: string | null;
}

const kstDay = (d: string | Date) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(day: string, locale: 'ko' | 'en'): string {
  const d = new Date(`${day}T00:00:00Z`);
  const [, mm, dd] = day.split('-');
  return locale === 'en'
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
    : `${Number(mm)}월 ${Number(dd)}일 (${WEEKDAY[d.getUTCDay()]})`;
}

export function CuratedFeed({ kind, items, rangeLabel }: { kind: 'policy' | 'fund'; items: Item[]; rangeLabel: string }) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  const [showAll, setShowAll] = useState(false);

  const title = kind === 'fund' ? t('투자·펀드') : t('정책·지원사업');
  const sub = kind === 'fund'
    ? t('투자 유치·펀드 결성·출자 소식')
    : t('정부·지자체 지원사업 공고와 창업 정책');

  // 데모데이 공고 정리는 최신 회차 2편만 위에 고정하고, 날짜별 목록에서는 뺀다(두 번 보이지 않게).
  const pinned = kind === 'policy'
    ? items.filter(a => a.source === PINNED_SOURCE && /TOP\s?\d+/i.test(a.title)).slice(0, 2)
    : [];
  const pinnedIds = new Set(pinned.map(a => a.id));
  const byDay = new Map<string, Item[]>();
  for (const a of items) {
    if (pinnedIds.has(a.id)) continue;
    const day = kstDay(a.pubDate);
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }
  const days = [...byDay.keys()].sort().reverse();
  const shownDays = showAll ? days : days.slice(0, DAYS_SHOWN);

  return (
    <div className="rounded-2xl border border-spark-border bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[16px] font-extrabold text-spark-ink">{kind === 'fund' ? '💰' : '📑'} {title}</span>
        <span className="text-xs text-spark-muted">{sub}</span>
        <span className="ml-auto text-xs text-spark-muted">
          {t('{range} · {n}건 · 깡프로 스타트업 뉴스 · 데모데이', { range: rangeLabel, n: items.length })}
        </span>
      </div>

      {pinned.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          {pinned.map(a => (
            <a
              key={a.id}
              href={a.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-sky-200 bg-sky-50/60 p-4 transition-colors hover:border-sky-400"
            >
              <div className="mb-1 text-[11px] font-bold text-sky-700">📌 {t('이번 주 지원사업 공고 정리')} · {dayLabel(kstDay(a.pubDate), locale)}</div>
              <div className="text-[14px] font-bold leading-snug text-gray-900 group-hover:text-sky-800">{articleTitle(a, locale)}</div>
              {a.snippet && <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-gray-600">{a.snippet}</div>}
            </a>
          ))}
        </div>
      )}

      {days.length === 0 && pinned.length === 0 && (
        <div className="py-10 text-center text-sm text-spark-muted">{t('{range} 내 수집된 기사가 없습니다.', { range: rangeLabel })}</div>
      )}

      <div className="space-y-5">
        {shownDays.map(day => (
          <section key={day}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[12px] font-bold text-spark-ink-soft">{dayLabel(day, locale)}</span>
              <span className="text-[11px] text-spark-muted">{byDay.get(day)!.length}{t('건')}</span>
              <span className="h-px flex-1 bg-spark-border/70" />
            </div>
            <ul className="divide-y divide-spark-border/60">
              {byDay.get(day)!.map(a => (
                <li key={a.id}>
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold leading-snug text-gray-900 group-hover:text-spark-purple">{articleTitle(a, locale)}</div>
                      {a.snippet && <div className="mt-0.5 truncate text-[12px] text-gray-500">{a.snippet}</div>}
                    </div>
                    <span className="shrink-0 pt-0.5 text-[11.5px] font-medium text-gray-400">{t(a.source)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {days.length > DAYS_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="mt-4 w-full rounded-lg border border-spark-border bg-spark-subtle py-2 text-[12.5px] font-bold text-spark-ink-soft transition-colors hover:border-spark-purple/40 hover:text-spark-purple"
        >
          {showAll ? `${t('접기')} ↑` : `${t('이전 날짜 더보기')} (${days.length - DAYS_SHOWN}${t('일')}) ↓`}
        </button>
      )}
    </div>
  );
}
