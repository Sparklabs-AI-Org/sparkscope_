'use client';
// 오늘의 정책·지원사업 / 투자·펀드 — 그날 들어온 큐레이션 기사 카드(아래 원본 표는 2026-10-28 뺐다).
// 표는 정렬·검색·CSV를 위한 밀도 높은 화면이라 "오늘 뭐 났나"를 훑기엔 맞지 않는다.
// 기본은 한 줄(6개)만 보여주고, 더보기를 누르면 그날치를 모두 펼친다.
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { articleTitle } from '@/lib/sparkscope/article-title';

const PREVIEW = 6;

interface Item {
  id: string;
  title: string;
  titleKo?: string | null;
  titleEn?: string | null;
  link: string;
  source: string;
}

export function PolicyTodayCards({
  kind = 'policy',
  items,
  label,
  isToday,
}: {
  kind?: 'policy' | 'fund';
  items: Item[];
  label: string;
  isToday: boolean;
}) {
  const t = useT();
  const locale = useLocale() === 'en' ? 'en' : 'ko';
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, PREVIEW);
  const rest = items.length - PREVIEW;

  return (
    <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/40 p-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[15px] font-extrabold text-sky-900">
          {kind === 'fund'
            ? (isToday ? t('오늘의 투자·펀드') : t('최근 투자·펀드'))
            : (isToday ? t('오늘의 정책·지원사업') : t('최근 정책·지원사업'))}
        </span>
        <span className="text-xs font-semibold text-sky-700">{label}</span>
        <span className="text-xs text-sky-700/70">
          {t('{n}건 · 깡프로 스타트업 뉴스 · 데모데이', { n: items.length })}
        </span>
        {rest > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="ml-auto rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-[11.5px] font-bold text-sky-800 transition-colors hover:border-sky-500 hover:bg-sky-50"
          >
            {expanded ? `${t('접기')} ↑` : `${t('+{n}건 더보기', { n: rest })} ↓`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {shown.map(a => (
          <a
            key={a.id}
            href={a.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-h-[112px] flex-col justify-between rounded-xl border border-sky-200/80 bg-white p-3.5 shadow-sm transition-colors hover:border-sky-400"
          >
            <span className="text-[13.5px] font-semibold leading-snug text-gray-900 group-hover:text-sky-700">
              {articleTitle(a, locale)}
            </span>
            <span className="mt-2 text-[11.5px] font-medium text-gray-500">{t(a.source)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
