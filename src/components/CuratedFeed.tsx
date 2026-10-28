'use client';
// 정책·지원사업 / 투자·펀드 탭 — 깡프로·데모데이 큐레이션 기사. 오늘의 시그널(SignalBanner)과 같은 배치로
// 큰 카드 1장 + 작은 카드 6장만 보여주고, 조회 기간의 전체 목록은 '전체 목록 보기'로 펼친다(2026-10-28 소윤).
// 위의 세부 분류 칩으로 카드·목록을 함께 거른다.
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { articleTitle } from '@/lib/sparkscope/article-title';

const CARDS = 7;
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
  importance?: string | null;
  curationTopic?: string | null;
}

const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const rank = (a: Item) => IMPORTANCE_RANK[a.importance ?? ''] ?? 0;

const kstDay = (d: string | Date) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(day: string, locale: 'ko' | 'en'): string {
  const d = new Date(`${day}T00:00:00Z`);
  const [, mm, dd] = day.split('-');
  return locale === 'en'
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
    : `${Number(mm)}월 ${Number(dd)}일 (${WEEKDAY[d.getUTCDay()]})`;
}

// 탭 안의 세부 분류(policy-classify.ts curationTopic) — 날짜보다 "무슨 종류의 소식인가"로 묶는 편이 읽기 쉽다(2026-10-28 소윤).
const TOPICS: Record<'policy' | 'fund', { id: string; label: string }[]> = {
  policy: [
    { id: 'grant', label: '📋 지원사업 공고' },
    { id: 'policy', label: '🏛️ 정책·제도' },
    { id: 'ecosystem', label: '🌱 생태계·동향' },
  ],
  fund: [
    { id: 'round', label: '🚀 투자 유치' },
    { id: 'fund', label: '🏦 펀드 결성·출자' },
    { id: 'market', label: '📊 시장 동향' },
  ],
};
const HERO_DAYS = 7;

export function CuratedFeed({ kind, items, rangeLabel }: { kind: 'policy' | 'fund'; items: Item[]; rangeLabel: string }) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  const [topic, setTopic] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const title = kind === 'fund' ? t('투자·펀드') : t('정책·지원사업');
  const sub = kind === 'fund'
    ? t('투자 유치·펀드 결성·출자 소식')
    : t('정부·지자체 지원사업 공고와 창업 정책');

  const topics = TOPICS[kind];
  // 판정 전·다른 칸 값이면 마지막 묶음(생태계·동향 / 시장 동향)으로 둔다.
  const topicOf = (a: Item) => (topics.some(x => x.id === a.curationTopic) ? a.curationTopic! : topics[topics.length - 1]!.id);
  const pool = topic ? items.filter(a => topicOf(a) === topic) : items;
  const byImportance = (list: Item[]) => [...list]
    .sort((x, y) => rank(y) - rank(x) || new Date(y.pubDate).getTime() - new Date(x.pubDate).getTime());

  // 큰 카드는 최근 7일 안에서 — 3개월 조회 때 4주 전 기사가 맨 위에 서던 문제(2026-10-28).
  // 정책 탭은 데모데이 주간 공고 정리 최신 회차가 우선이다. 7일 안에 없으면 기간 전체에서 고른다.
  const latest = pool.reduce((m, a) => Math.max(m, new Date(a.pubDate).getTime()), 0);
  const recent = pool.filter(a => new Date(a.pubDate).getTime() >= latest - HERO_DAYS * 864e5);
  const pinned = kind === 'policy'
    ? recent.filter(a => a.source === PINNED_SOURCE && /TOP\s?\d+/i.test(a.title)).slice(0, 2)
    : [];
  const pinnedIds = new Set(pinned.map(a => a.id));
  const hero = pinned[0] ?? byImportance(recent)[0] ?? byImportance(pool)[0];
  const cards = [...pinned.slice(1), ...byImportance(pool.filter(a => a.id !== hero?.id && !pinnedIds.has(a.id)))].slice(0, CARDS - 1);

  return (
    <div className="rounded-2xl border border-spark-border bg-white p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        <h2 className="text-[19px] font-extrabold tracking-tight">{kind === 'fund' ? '💰' : '📑'} {title}</h2>
        <span className="text-[13px] text-spark-muted">{sub}</span>
        <span className="ml-auto text-[12px] text-spark-muted">
          {t('{range} · {n}건 · 깡프로 스타트업 뉴스 · 데모데이', { range: rangeLabel, n: items.length })}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {[{ id: null as string | null, label: t('전체') }, ...topics.map(x => ({ id: x.id as string | null, label: t(x.label) }))].map(x => {
          const n = x.id ? items.filter(a => topicOf(a) === x.id).length : items.length;
          const active = topic === x.id;
          return (
            <button
              key={x.id ?? 'all'}
              type="button"
              onClick={() => setTopic(x.id)}
              className={`rounded-lg border px-3 py-1 text-[12.5px] font-bold transition-colors ${
                active ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple'
              }`}
            >
              {x.label} <span className={active ? 'text-white/80' : 'text-spark-muted'}>{n}</span>
            </button>
          );
        })}
      </div>

      {!hero ? (
        <div className="mt-4 rounded-xl border border-spark-border bg-spark-subtle p-8 text-center text-[13px] text-spark-muted">
          {t('{range} 내 수집된 기사가 없습니다.', { range: rangeLabel })}
        </div>
      ) : (
        <>
          <a
            href={hero.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-4 block rounded-xl border border-spark-purple/25 border-l-4 border-l-spark-purple bg-gradient-to-br from-spark-light-purple/55 via-white to-white p-5 shadow-card"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-spark-purple/30 bg-white px-2 py-0.5 text-[11px] font-bold text-spark-purple">{t(hero.source)}</span>
              <span className="text-[11.5px] font-bold text-spark-ink-soft">{t(topics.find(x => x.id === topicOf(hero))!.label)}</span>
              {pinnedIds.has(hero.id) && <span className="text-[11.5px] font-bold text-sky-700">📌 {t('이번 주 지원사업 공고 정리')}</span>}
              <span className="text-[11px] tabular-nums text-spark-muted">{dayLabel(kstDay(hero.pubDate), locale)}</span>
            </div>
            <div className="text-[18px] font-extrabold leading-snug tracking-tight text-spark-ink group-hover:text-spark-purple">{articleTitle(hero, locale)}</div>
            {hero.snippet && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-spark-ink-soft">{hero.snippet}</p>}
          </a>

          {cards.length > 0 && (
            <ol className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(a => (
                <li key={a.id}>
                  <a
                    href={a.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col rounded-xl border border-spark-border bg-white px-3.5 py-3 transition-colors hover:border-spark-purple/30"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] text-spark-muted">
                      <span className="font-semibold text-spark-ink-soft">{t(a.source)}</span>
                      {pinnedIds.has(a.id) && <span className="font-bold text-sky-700">📌 {t('공고 정리')}</span>}
                      <span className="tabular-nums">{dayLabel(kstDay(a.pubDate), locale)}</span>
                    </div>
                    <div className="line-clamp-2 text-[14px] font-bold leading-snug text-spark-ink group-hover:text-spark-purple">{articleTitle(a, locale)}</div>
                  </a>
                </li>
              ))}
            </ol>
          )}

          {pool.length > CARDS && (
            <button
              type="button"
              onClick={() => setShowList(v => !v)}
              aria-expanded={showList}
              className="mt-4 w-full rounded-lg border border-spark-border bg-spark-subtle py-2 text-[12.5px] font-bold text-spark-ink-soft transition-colors hover:border-spark-purple/40 hover:text-spark-purple"
            >
              {showList ? `${t('접기')} ↑` : `${t('전체 목록 보기')} (${pool.length}${t('건')}) ↓`}
            </button>
          )}

          {showList && (
            <div className="mt-5 space-y-6">
              {topics.filter(x => !topic || x.id === topic).map(x => {
                const list = byImportance(pool.filter(a => topicOf(a) === x.id));
                if (list.length === 0) return null;
                return (
                  // 세부 분류 머리를 띠로 — 목록이 길어도 묶음이 바뀌는 곳이 한눈에 보이게.
                  <section key={x.id} className="overflow-hidden rounded-xl border border-spark-border">
                    <div className="flex items-baseline gap-2 border-b border-spark-border bg-spark-subtle px-4 py-2.5">
                      <span className="text-[15px] font-extrabold tracking-tight text-spark-ink">{t(x.label)}</span>
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-spark-muted">{list.length}{t('건')}</span>
                    </div>
                    <ul className="divide-y divide-spark-border/60 px-4">
                      {list.map(a => (
                        <li key={a.id}>
                          <a href={a.link} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-4 py-2">
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-gray-900 group-hover:text-spark-purple">{articleTitle(a, locale)}</span>
                            <span className="shrink-0 text-[11.5px] text-gray-400">{t(a.source)} · {dayLabel(kstDay(a.pubDate), locale)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
