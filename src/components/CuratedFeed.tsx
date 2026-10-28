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
    // 생태계·동향(ecosystem)은 업계 동향 탭으로 옮겼다(2026-10-28 소윤) — DB 분류는 그대로.
  ],
  // 시장 동향(market)은 대시보드에서 뺐다 — 업계 동향 탭이 다루는 내용이라 그쪽으로 보낸다(policy-classify.ts, 2026-10-28 소윤).
  fund: [
    { id: 'fund', label: '🏦 펀드 결성·출자' },
    { id: 'round', label: '🚀 투자 유치' },
  ],
};
const HERO_DAYS = 7;
/** 데모데이 주간 공고 정리 글 — 지원사업 공고 칸에서 오른쪽 주차별 칸으로 따로 모은다. */
const isRoundup = (a: Item) => a.source === PINNED_SOURCE && /TOP\s?\d+/i.test(a.title);

// ── 주차 계산(KST, 월요일 시작). 데모데이 표기("10월 4주차" = 10/26 월요일)와 같게 월요일 날짜÷7 올림으로 센다.
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function weekLabel(monday: string, locale: 'ko' | 'en'): string {
  const [, mm, dd] = monday.split('-').map(Number);
  const n = Math.ceil(dd! / 7);
  return locale === 'en' ? `Week ${n} of ${new Date(`${monday}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}` : `${mm}월 ${n}주차`;
}

/**
 * 지원사업 공고 칸 — 위는 데모데이 주간 공고 정리를 주차별로, 아래는 개별 공고(2026-10-28 소윤).
 * 주차는 ◀ ▶ 또는 달력에서 날짜를 고르면 그 날이 속한 주로 간다. 정리 글이 없는 주를 고르면 그렇다고 알려 준다.
 */
function GrantSplit({ grants, roundups }: { grants: Item[]; roundups: Item[] }) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  const weeks = [...new Set(roundups.map(a => mondayOf(kstDay(a.pubDate))))].sort().reverse();
  const [week, setWeek] = useState<string | null>(weeks[0] ?? null);
  const idx = week ? weeks.indexOf(week) : -1;
  const ofWeek = week ? roundups.filter(a => mondayOf(kstDay(a.pubDate)) === week) : [];
  const step = (dir: 1 | -1) => {
    // 정리 글이 없는 주를 보고 있으면 그 주에서 가장 가까운 있는 주로.
    if (idx >= 0) { const next = weeks[idx + dir]; if (next) setWeek(next); return; }
    const target = dir === 1 ? weeks.find(w => w < (week ?? '')) : [...weeks].reverse().find(w => w > (week ?? ''));
    if (target) setWeek(target);
  };

  return (
    <div className="mt-4 flex flex-col gap-4">

      <section className="overflow-hidden rounded-xl border border-sky-200">
        <div className="flex flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2.5">
          <span className="text-[15px] font-extrabold tracking-tight text-sky-900">📌 {t('주간 공고 정리')}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => step(1)} disabled={idx === weeks.length - 1} aria-label={t('이전 주')}
              className="rounded-md border border-sky-200 bg-white px-2 py-0.5 text-[12px] font-bold text-sky-800 disabled:opacity-40">◀</button>
            <span className="min-w-[78px] text-center text-[13px] font-extrabold text-sky-900">{week ? weekLabel(week, locale) : '—'}</span>
            <button type="button" onClick={() => step(-1)} disabled={idx === 0} aria-label={t('다음 주')}
              className="rounded-md border border-sky-200 bg-white px-2 py-0.5 text-[12px] font-bold text-sky-800 disabled:opacity-40">▶</button>
            <label className="flex items-center gap-1 rounded-md border border-sky-200 bg-white px-2 py-0.5 text-[12px] text-sky-800">
              📅
              <input
                type="date"
                aria-label={t('주차 고르기')}
                className="bg-transparent text-[12px] outline-none"
                value={week ?? ''}
                onChange={e => e.target.value && setWeek(mondayOf(e.target.value))}
              />
            </label>
          </div>
        </div>
        {ofWeek.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-spark-muted">
            {weeks.length === 0 ? t('아직 수집된 주간 공고 정리가 없습니다.') : t('이 주에는 공고 정리 글이 없습니다. ◀ ▶로 가까운 주를 보세요.')}
          </p>
        ) : (
          <ul className="space-y-2.5 p-4">
            {ofWeek.map(a => (
              <li key={a.id}>
                <a href={a.link} target="_blank" rel="noopener noreferrer"
                  className="group block rounded-lg border border-sky-200/80 bg-white p-3.5 transition-colors hover:border-sky-400">
                  <div className="text-[14px] font-bold leading-snug text-gray-900 group-hover:text-sky-800">{articleTitle(a, locale)}</div>
                  <div className="mt-1 text-[11.5px] text-gray-500">{t(a.source)} · {dayLabel(kstDay(a.pubDate), locale)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
        {weeks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-sky-100 px-4 py-3">
            {weeks.slice(0, 8).map(w => (
              <button key={w} type="button" onClick={() => setWeek(w)}
                className={`rounded-md px-2 py-0.5 text-[11.5px] font-bold ${w === week ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-800 hover:bg-sky-100'}`}>
                {weekLabel(w, locale)}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-xl border border-spark-border">
        <div className="flex items-baseline gap-2 border-b border-spark-border bg-spark-subtle px-4 py-2.5">
          <span className="text-[15px] font-extrabold tracking-tight text-spark-ink">📋 {t('개별 공고')}</span>
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-spark-muted">{grants.length}{t('건')}</span>
        </div>
        {grants.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-spark-muted">{t('이 기간에 수집된 공고가 없습니다.')}</p>
        ) : (
          <ul className="max-h-[560px] divide-y divide-spark-border/60 overflow-y-auto px-4">
            {grants.map(a => (
              <li key={a.id}>
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="group block py-2.5">
                  <div className="text-[13.5px] font-semibold leading-snug text-gray-900 group-hover:text-spark-purple">{articleTitle(a, locale)}</div>
                  <div className="mt-0.5 text-[11.5px] text-gray-400">{t(a.source)} · {dayLabel(kstDay(a.pubDate), locale)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CuratedFeed({ kind, items, roundups = [], rangeLabel }: { kind: 'policy' | 'fund'; items: Item[]; roundups?: Item[]; rangeLabel: string }) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  // 첫 세부 분류가 기본 — 칩 순서는 세부 분류들 → 전체(2026-10-28 소윤).
  const [topic, setTopic] = useState<string | null>(TOPICS[kind][0]!.id);
  const [showList, setShowList] = useState(true);  // 펼친 상태가 기본(2026-10-28 소윤)

  const title = kind === 'fund' ? t('투자·펀드') : t('정책·지원사업');
  const sub = kind === 'fund'
    ? t('투자 유치·펀드 결성·출자 소식')
    : t('정부·지자체 지원사업 공고와 창업 정책');

  const topics = TOPICS[kind];
  // 판정 전·다른 칸 값이면 마지막 묶음(정책·제도 / 투자 유치)으로 둔다.
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
        {[...topics.map(x => ({ id: x.id as string | null, label: t(x.label) })), { id: null as string | null, label: t('전체') }].map(x => {
          // 건수는 세부 분류 칩에만 — '전체'에는 붙이지 않는다(2026-10-28 소윤).
          const n = x.id ? items.filter(a => topicOf(a) === x.id).length : null;
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
              {x.label}{n !== null && <> <span className={active ? 'text-white/80' : 'text-spark-muted'}>{n}</span></>}
            </button>
          );
        })}
      </div>

      {topic === 'grant' ? (
        <GrantSplit grants={byImportance(pool.filter(a => !isRoundup(a)))} roundups={roundups} />
      ) : topic === null ? (
        // 전체는 카드 없이 세부 분류별 목록만(2026-10-28 소윤).
        <TopicList topics={topics} pool={pool} topicOf={topicOf} byImportance={byImportance} />
      ) : !hero ? (
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
            <TopicList topics={topics.filter(x => x.id === topic)} pool={pool} topicOf={topicOf} byImportance={byImportance} />
          )}
        </>
      )}
    </div>
  );
}

/** 세부 분류별 목록 — 분류 머리를 띠로, 안은 중요도 순. 목록이 길어도 묶음이 바뀌는 곳이 한눈에 보이게. */
function TopicList({ topics, pool, topicOf, byImportance }: {
  topics: { id: string; label: string }[];
  pool: Item[];
  topicOf: (a: Item) => string;
  byImportance: (list: Item[]) => Item[];
}) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  return (
    <div className="mt-5 space-y-6">
      {topics.map(x => {
        const list = byImportance(pool.filter(a => topicOf(a) === x.id));
        if (list.length === 0) return null;
        return (
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
  );
}

/**
 * 업계 동향 탭 아래 — 특정 하우스가 아닌 업계 전반·창업 생태계 소식(깡프로·데모데이 큐레이션). 중요도 → 최신 순, 처음 10건 + 더보기.
 */
export function IndustryCuratedList({ items, rangeLabel }: { items: Item[]; rangeLabel: string }) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const sorted = [...items].sort((x, y) => rank(y) - rank(x) || new Date(y.pubDate).getTime() - new Date(x.pubDate).getTime());
  const shown = all ? sorted : sorted.slice(0, 10);
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-spark-border bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-spark-border bg-spark-subtle px-5 py-3">
        <span className="text-[16px] font-extrabold tracking-tight text-spark-ink">🌱 {t('업계 전반·생태계')}</span>
        <span className="text-[12px] text-spark-muted">{t('특정 하우스가 아닌 투자 시장·창업 생태계 소식')}</span>
        <span className="ml-auto text-[12px] text-spark-muted">{rangeLabel} · {items.length}{t('건')}</span>
      </div>
      <ul className="divide-y divide-spark-border/60 px-5">
        {shown.map(a => (
          <li key={a.id}>
            <a href={a.link} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-gray-900 group-hover:text-spark-purple">{articleTitle(a, locale)}</span>
              <span className="shrink-0 text-[11.5px] text-gray-400">{t(a.source)} · {dayLabel(kstDay(a.pubDate), locale)}</span>
            </a>
          </li>
        ))}
      </ul>
      {sorted.length > 10 && (
        <button type="button" onClick={() => setAll(v => !v)}
          className="w-full border-t border-spark-border bg-spark-subtle py-2 text-[12.5px] font-bold text-spark-ink-soft hover:text-spark-purple">
          {all ? `${t('접기')} ↑` : `${t('더보기')} (${sorted.length - 10}${t('건')}) ↓`}
        </button>
      )}
    </section>
  );
}
