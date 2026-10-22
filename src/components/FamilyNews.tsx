'use client';
import { useT } from '@/lib/i18n/client';

// SparkLabs Family News — 공개 화면(포트폴리오사 등 외부 계정)의 기사 목록(2026-10-22 소윤 시안).
// 사내 '수집 기사 DB'와 같은 기사를 쓰되, 분류는 탭 네 개(스파크랩·포트폴리오·스타트업계·타 AC·VC)로만
// 고르고 '날짜순 전체보기'·CSV 내보내기·건수는 두지 않는다. 스파크랩 탭 안에는 지사 하위 탭이 있다.

import { useMemo, useState } from 'react';
import { ArticlesTable } from '@/components/ArticlesTable';

type Row = {
  id: string; title: string; link: string; source: string; pubDate: Date | string;
  matchedKeyword: string; category: string; titleEn?: string | null; [k: string]: unknown;
};

type TabId = 'sparklabs' | 'portfolio' | 'industry' | 'acvc';
const TABS: { id: TabId; label: string; on: string; off: string }[] = [
  { id: 'sparklabs', label: '스파크랩', on: 'bg-green-600 border-green-600 text-white', off: 'bg-green-50 border-green-200 text-green-800 hover:border-green-500' },
  { id: 'portfolio', label: '포트폴리오', on: 'bg-spark-purple border-spark-purple text-white', off: 'bg-spark-light-purple/40 border-spark-purple/30 text-spark-purple hover:border-spark-purple' },
  { id: 'industry', label: '스타트업계 소식', on: 'bg-amber-500 border-amber-500 text-white', off: 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-500' },
  { id: 'acvc', label: '타 AC·VC', on: 'bg-red-600 border-red-600 text-white', off: 'bg-red-50 border-red-200 text-red-800 hover:border-red-500' },
];

// 스파크랩 하위 탭 — 지사는 감시 대상 이름(matchedKeyword)으로 가른다(대시보드 page.tsx와 같은 키).
// ready=false 는 아직 감시 대상이 없는 지사 — 자리만 보여 준다.
type SubId = 'kr' | 'tw' | 'gv' | 'au' | 'sa' | 'spac';
const SUBS: { id: SubId; label: string; ready: boolean }[] = [
  { id: 'kr', label: '스파크랩 코리아', ready: true },
  { id: 'tw', label: '스파크랩 대만', ready: true },
  { id: 'gv', label: '스파크랩 글로벌', ready: true },
  { id: 'au', label: '스파크랩 호주', ready: false },
  { id: 'sa', label: '스파크랩 사우디', ready: false },
  { id: 'spac', label: '스파크랩 스펙', ready: false },
];
const TW_KEYS = new Set(['스파크랩 타이완']);
const GV_KEYS = new Set(['스파크랩 글로벌벤처스', '스파크랩 글로벌']);
function subOf(a: Row): SubId {
  if (TW_KEYS.has(a.matchedKeyword)) return 'tw';
  if (GV_KEYS.has(a.matchedKeyword)) return 'gv';
  return 'kr';
}
function tabOf(a: Row): TabId | null {
  if (a.category === 'sparklabs_self') return 'sparklabs';
  if (a.category.startsWith('portfolio_company')) return 'portfolio';
  if (a.category === 'industry_trend') return 'industry';
  if (a.category === 'competitor') return 'acvc';
  return null;
}

export function FamilyNews({ articles, canBookmark = false, emptyText }: { articles: Row[]; canBookmark?: boolean; emptyText: string }) {
  const t = useT();
  const [tab, setTab] = useState<TabId>('sparklabs');
  const [sub, setSub] = useState<SubId>('kr');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent');

  const view = useMemo(() => {
    let list = articles.filter(a => tabOf(a) === tab);
    if (tab === 'sparklabs') list = list.filter(a => subOf(a) === sub);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(a => [a.title, a.titleEn, a.source, t(a.source), a.matchedKeyword].some(v => String(v ?? '').toLowerCase().includes(s)));
    return [...list].sort((a, b) => (sort === 'recent' ? 1 : -1) * (+new Date(b.pubDate) - +new Date(a.pubDate)));
  }, [articles, tab, sub, q, sort, t]);

  return (
    <div>
      <div data-tour="family-tabs" className="flex flex-wrap items-center gap-2 mb-3">
        {TABS.map(b => (
          <button key={b.id} onClick={() => setTab(b.id)} aria-pressed={tab === b.id}
            className={`rounded-lg border px-3.5 py-1.5 text-sm font-bold whitespace-nowrap transition-colors ${tab === b.id ? b.on : b.off}`}>
            {t(b.label)}
          </button>
        ))}
      </div>

      {tab === 'sparklabs' && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 pl-1">
          {SUBS.map(s => (
            <button key={s.id} disabled={!s.ready} onClick={() => setSub(s.id)} aria-pressed={sub === s.id}
              title={s.ready ? undefined : t('준비 중')}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                !s.ready ? 'border-dashed border-spark-border text-spark-muted/70 cursor-default'
                  : sub === s.id ? 'border-green-600 bg-green-600 text-white' : 'border-green-200 bg-white text-green-800 hover:border-green-500'
              }`}>
              {t(s.label)}{!s.ready && <span className="ml-1 text-[10.5px]">{t('준비 중')}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔎</span>
          <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder={t('제목·매체·회사명으로 검색')}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-spark-purple focus:bg-white focus:outline-none" />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as 'recent' | 'oldest')} aria-label={t('정렬')}
          className="rounded-lg border border-spark-border px-2 py-1.5 text-sm focus:border-spark-purple focus:outline-none">
          <option value="recent">{t('최신순')}</option>
          <option value="oldest">{t('오래된순')}</option>
        </select>
      </div>

      <ArticlesTable articles={view as any} canBookmark={canBookmark} showCategoryColumn={false}
        showKeywordColumn={tab === 'industry' || tab === 'acvc'} showPitchColumn={false} showInternal={false} emptyText={emptyText} />
    </div>
  );
}
