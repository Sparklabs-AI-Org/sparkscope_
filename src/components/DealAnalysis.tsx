// 투자·펀드 탭 "투자 유치 분석" — 어느 단계·분야로 돈이 가나, 지금 실제로 쓰는 하우스는 어디인가,
// 단계별로 보통 얼마 받나, 누가 누구와 같이 들어가나(2026-11-26 소윤). 집계는 deal-stats.ts, 여긴 그리기만.
import Link from 'next/link';
import { STAGES, type DealStats } from '@/lib/sparkscope/deal-stats';

// 단계 색: 초기(연한 보라) → 후기(진한 보라), 전략·M&A·기타는 회색.
const STAGE_COLOR: Record<string, string> = {
  SEED: '#ddd6fe', PRE_A: '#c4b5fd', A: '#a78bfa', B: '#8b5cf6', 'C+': '#6d28d9', ETC: '#a8a29e',
};
import { Card, Kpi, krw, type T } from './FundAnalysis';
import { dealsHref } from '@/lib/sparkscope/deal-links';
const H = (f: Parameters<typeof dealsHref>[1] = {}) => dealsHref('deals', f);


export function DealAnalysis({ stats, t }: { stats: DealStats; t: T }) {
  if (stats.total === 0) {
    return (
      <div className="mb-4 rounded-2xl border border-spark-border bg-white p-5 text-[13px] text-spark-muted">
        {t('최근 {d}일 투자 유치 분석 — 아직 정리된 딜이 없습니다. 매일 07:30에 기사에서 딜을 뽑아 쌓습니다.', { d: stats.days })}
      </div>
    );
  }
  const maxRow = Math.max(1, ...stats.matrix.map(m => m.total));
  // 금액은 1억~수천억이라 로그 눈금 — 큰 딜 하나가 나머지 막대를 왼쪽 끝으로 밀어붙이지 않게.
  const maxAmt = Math.max(1, ...stats.stageAmounts.map(s => s.max));
  const pos = (v: number) => (Math.log10(v / 1e8 + 1) / Math.log10(maxAmt / 1e8 + 1)) * 100;
  const sizedPct = Math.round((stats.sized / stats.total) * 100);
  const lead = stats.investors[0];

  return (
    <section className="mb-4 rounded-2xl border border-spark-border bg-spark-subtle/40 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">📈 {t('투자 유치 분석')}</h2>
        <span className="text-[13px] text-spark-muted">{t('최근 {d}일 · 기사에서 AI가 뽑은 국내 딜 {n}건', { d: stats.days, n: stats.total })}</span>
        <Link href="/dashboard/deals?tab=deals&days=90" className="ml-auto text-[12px] font-semibold text-spark-purple hover:underline">{t('딜 전체 표 보기 →')}</Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi href={H()} label={t('딜 수')} value={String(stats.total)} sub={t('우리 포트폴리오 {n}건', { n: stats.portfolioDeals })} />
        <Kpi href={H({ sized: '1' })} label={t('공개 투자액 합')} value={krw(stats.sumKrw, t)} sub={t('금액 공개 {p}% ({n}건)', { p: sizedPct, n: stats.sized })} />
        <Kpi href={H({ sized: '1' })} label={t('딜 1건 중간값')} value={stats.medianKrw != null ? krw(stats.medianKrw, t) : '—'} sub={t('큰 딜 몇 건에 끌려가지 않는 값')} />
        <Kpi href={lead ? H({ inv: lead.name }) : undefined} label={t('가장 활발한 하우스')} value={lead?.name ?? '—'}
          sub={lead ? t('{n}건 참여 · 리드 {l}', { n: lead.deals, l: lead.leads }) : undefined} />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card href={H()} title={t('분야별 딜 — 돈이 가는 곳')} hint={t('막대 길이 = 건수 · 색 = 단계 · 마우스 올리면 금액')}>
          <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-spark-muted">
            {STAGES.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAGE_COLOR[s.id] }} />{t(s.label)}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5">
            {stats.matrix.slice(0, 10).map(m => (
              <li key={m.sector} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-[12px]">
                <Link href={H({ sec: m.sector })} className="truncate font-semibold text-spark-ink-soft hover:text-spark-purple hover:underline" title={t(m.sector)}>{t(m.sector)}</Link>
                <span className="flex h-5 overflow-hidden rounded" style={{ width: `${Math.max(6, (m.total / maxRow) * 100)}%` }}>
                  {STAGES.map(s => {
                    const c = m.cells[s.id];
                    if (!c) return null;
                    return (
                      <Link key={s.id} href={H({ sec: m.sector, st: s.id })} title={`${t(m.sector)} · ${t(s.label)} · ${c.count}${t('건')}${c.sumKrw ? ` · ${krw(c.sumKrw, t)}` : ''}`}
                        className="h-full border-r border-white/70 last:border-0 hover:opacity-75"
                        style={{ width: `${(c.count / m.total) * 100}%`, background: STAGE_COLOR[s.id] }} />
                    );
                  })}
                </span>
                <Link href={H({ sec: m.sector })} className="text-right font-bold tabular-nums text-spark-ink hover:text-spark-purple">{m.total}{t('건')}</Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('단계별 투자 금액대')} hint={t('막대 = 최소~최대, 점 = 중간값 · 로그 눈금')}>
          <ul className="space-y-2.5">
            {stats.stageAmounts.map(s => (
              <li key={s.stage}><Link href={H({ st: s.stage, sized: '1' })} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-spark-subtle">
                <span className="font-semibold text-spark-ink-soft">{t(s.label)} <span className="text-spark-muted">{s.n}</span></span>
                <span className="relative h-2.5 rounded-full bg-spark-subtle">
                  <span className="absolute h-full rounded-full bg-violet-200"
                    style={{ left: `${pos(s.min)}%`, width: `${Math.max(1.5, pos(s.max) - pos(s.min))}%` }} />
                  <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-spark-purple shadow"
                    style={{ left: `${pos(s.median)}%` }} />
                </span>
                <span className="whitespace-nowrap tabular-nums text-spark-muted">{t('중간 {v}', { v: krw(s.median, t) })}</span>
              </Link></li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-spark-muted">{t('포트폴리오사 다음 라운드 규모를 잡을 때 기준점으로 씁니다. 금액 비공개 딜은 빠집니다.')}</p>
        </Card>
      </div>

    </section>
  );
}
