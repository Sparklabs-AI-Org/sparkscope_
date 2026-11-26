// 투자·펀드 탭 "투자 유치 분석" — 어느 단계·분야로 돈이 가나, 지금 실제로 쓰는 하우스는 어디인가,
// 단계별로 보통 얼마 받나, 누가 누구와 같이 들어가나(2026-11-26 소윤). 집계는 deal-stats.ts, 여긴 그리기만.
import Link from 'next/link';
import { STAGES, type DealStats } from '@/lib/sparkscope/deal-stats';

// 단계 색: 초기(연한 보라) → 후기(진한 보라), 전략·M&A·기타는 회색.
const STAGE_COLOR: Record<string, string> = {
  SEED: '#ddd6fe', PRE_A: '#c4b5fd', A: '#a78bfa', B: '#8b5cf6', 'C+': '#6d28d9', ETC: '#a8a29e',
};
import { Card, Kpi, krw, type T } from './FundAnalysis';

const ROLE: Record<string, string> = { LEAD: '리드', NEW: '신규', FOLLOW: '후속', EXISTING: '기존' };

export function DealAnalysis({ stats, t }: { stats: DealStats; t: T }) {
  if (stats.total === 0) {
    return (
      <div className="mb-4 rounded-2xl border border-spark-border bg-white p-5 text-[13px] text-spark-muted">
        {t('최근 {d}일 투자 유치 분석 — 아직 정리된 딜이 없습니다. 매일 07:30에 기사에서 딜을 뽑아 쌓습니다.', { d: stats.days })}
      </div>
    );
  }
  const maxRow = Math.max(1, ...stats.matrix.map(m => m.total));
  const maxWeek = Math.max(1, ...stats.weekly.map(w => w.count));
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
        <Kpi label={t('딜 수')} value={String(stats.total)} sub={t('우리 포트폴리오 {n}건', { n: stats.portfolioDeals })} />
        <Kpi label={t('공개 투자액 합')} value={krw(stats.sumKrw, t)} sub={t('금액 공개 {p}% ({n}건)', { p: sizedPct, n: stats.sized })} />
        <Kpi label={t('딜 1건 중간값')} value={stats.medianKrw != null ? krw(stats.medianKrw, t) : '—'} sub={t('큰 딜 몇 건에 끌려가지 않는 값')} />
        <Kpi label={t('가장 활발한 하우스')} value={lead?.name ?? '—'}
          sub={lead ? t('{n}건 참여 · 리드 {l}', { n: lead.deals, l: lead.leads }) : undefined} />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card title={t('분야별 딜 — 돈이 가는 곳')} hint={t('막대 길이 = 건수 · 색 = 단계 · 마우스 올리면 금액')}>
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
                <span className="truncate font-semibold text-spark-ink-soft" title={t(m.sector)}>{t(m.sector)}</span>
                <span className="flex h-5 overflow-hidden rounded" style={{ width: `${Math.max(6, (m.total / maxRow) * 100)}%` }}>
                  {STAGES.map(s => {
                    const c = m.cells[s.id];
                    if (!c) return null;
                    return (
                      <span key={s.id} title={`${t(m.sector)} · ${t(s.label)} · ${c.count}${t('건')}${c.sumKrw ? ` · ${krw(c.sumKrw, t)}` : ''}`}
                        className="h-full border-r border-white/70 last:border-0"
                        style={{ width: `${(c.count / m.total) * 100}%`, background: STAGE_COLOR[s.id] }} />
                    );
                  })}
                </span>
                <span className="text-right font-bold tabular-nums text-spark-ink">{m.total}{t('건')}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('단계별 투자 금액대')} hint={t('막대 = 최소~최대, 점 = 중간값 · 로그 눈금')}>
          <ul className="space-y-2.5">
            {stats.stageAmounts.map(s => (
              <li key={s.stage} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-[12px]">
                <span className="font-semibold text-spark-ink-soft">{t(s.label)} <span className="text-spark-muted">{s.n}</span></span>
                <span className="relative h-2.5 rounded-full bg-spark-subtle">
                  <span className="absolute h-full rounded-full bg-violet-200"
                    style={{ left: `${pos(s.min)}%`, width: `${Math.max(1.5, pos(s.max) - pos(s.min))}%` }} />
                  <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-spark-purple shadow"
                    style={{ left: `${pos(s.median)}%` }} />
                </span>
                <span className="whitespace-nowrap tabular-nums text-spark-muted">{t('중간 {v}', { v: krw(s.median, t) })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-spark-muted">{t('포트폴리오사 다음 라운드 규모를 잡을 때 기준점으로 씁니다. 금액 비공개 딜은 빠집니다.')}</p>
        </Card>
      </div>

      <div className="mt-2.5">
        <Card title={t('지금 실제로 투자하는 하우스')} hint={t('참여 건수 순 · 신규 = 기존 투자사가 아닌 새 돈')}>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[680px] text-[12.5px]">
              <thead>
                <tr className="border-b border-spark-border text-left text-[11px] text-spark-muted">
                  <th className="px-1 py-1.5 font-semibold">{t('하우스')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('참여')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('리드')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('신규')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('주력 단계')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('주력 분야')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('참여 딜 합계')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('최근')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.investors.map(i => (
                  <tr key={i.name} className="border-b border-spark-border/60 last:border-0">
                    <td className="px-1 py-1.5 font-semibold text-spark-ink">
                      {i.name}
                      {i.portfolioDeals > 0 && <span className="ml-1.5 rounded bg-spark-purple/10 px-1.5 py-0.5 text-[10px] font-bold text-spark-purple">{t('우리 포폴 {n}', { n: i.portfolioDeals })}</span>}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums font-bold">{i.deals}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{i.leads || '—'}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{i.newMoney || '—'}</td>
                    <td className="px-1 py-1.5 text-spark-ink-soft">{t(i.topStage)}</td>
                    <td className="px-1 py-1.5 text-spark-ink-soft">{t(i.topSector)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{krw(i.sumKrw, t)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums text-spark-muted">{i.recent.slice(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-spark-muted">{t('참여 딜 합계는 그 하우스가 들어간 라운드 전체 금액의 합입니다(하우스별 지분은 기사에 거의 없음).')}</p>
        </Card>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-[1fr_1.4fr]">
        <Card title={t('자주 같이 들어가는 하우스')} hint={t('2번 이상 같은 라운드')}>
          {stats.pairs.length ? (
            <ul className="space-y-1.5 text-[12.5px]">
              {stats.pairs.map(p => (
                <li key={`${p.a}|${p.b}`} className="flex items-center gap-1.5">
                  <span className="font-semibold text-spark-ink">{p.a}</span>
                  <span className="text-spark-muted">+</span>
                  <span className="font-semibold text-spark-ink">{p.b}</span>
                  <span className="ml-auto tabular-nums text-spark-muted">{p.count}{t('회')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-spark-muted">{t('아직 두 번 이상 같이 들어간 하우스가 없습니다. 딜이 쌓이면 나타납니다.')}</p>}
          <p className="mt-3 text-[11px] text-spark-muted">{t('리드 한 곳을 잡으면 따라 들어올 가능성이 큰 곳입니다.')}</p>
        </Card>

        <Card title={t('주별 딜 건수')} hint={t('마우스 올리면 공개 금액')}>
          <div className="flex h-32 items-end gap-1">
            {stats.weekly.map(w => (
              <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${w.week} · ${w.count}${t('건')} · ${krw(w.sumKrw, t)}`}>
                {w.count > 0 && <span className="text-[10px] tabular-nums text-spark-muted">{w.count}</span>}
                <div className="w-full rounded-t bg-spark-purple/80" style={{ height: `${w.count ? Math.max(4, (w.count / maxWeek) * 100) : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-spark-muted">
            <span>{stats.weekly[0]?.week.slice(5)}</span><span>{stats.weekly[stats.weekly.length - 1]?.week.slice(5)}</span>
          </div>
        </Card>
      </div>

      <div className="mt-2.5">
        <Card title={t('최근 딜')} hint={t('최근 {n}건', { n: Math.min(15, stats.rows.length) })}>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[680px] text-[12.5px]">
              <thead>
                <tr className="border-b border-spark-border text-left text-[11px] text-spark-muted">
                  <th className="px-1 py-1.5 font-semibold">{t('날짜')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('회사')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('분야')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('단계')}</th>
                  <th className="px-1 py-1.5 text-right font-semibold">{t('금액')}</th>
                  <th className="px-1 py-1.5 font-semibold">{t('투자사')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.slice(0, 15).map(r => (
                  <tr key={r.id} className="border-b border-spark-border/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-1 py-1.5 tabular-nums text-spark-muted">{r.date.slice(5)}</td>
                    <td className="px-1 py-1.5 font-semibold text-spark-ink">
                      {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple">{r.company}</a> : r.company}
                      {r.portfolio && <span className="ml-1.5 rounded bg-spark-purple/10 px-1.5 py-0.5 text-[10px] font-bold text-spark-purple">{t('포폴')}</span>}
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-spark-ink-soft">{t(r.sector)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-spark-ink-soft">{t(STAGES.find(s => s.id === r.stage)!.label)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums font-semibold">{r.amountKrw != null ? krw(r.amountKrw, t) : <span className="font-normal text-spark-muted">{t('비공개')}</span>}</td>
                    <td className="px-1 py-1.5 text-[12px] text-spark-ink-soft">
                      {r.investors.length ? r.investors.map((i, k) => (
                        <span key={i.name}>{k > 0 && ', '}<span className={i.role === 'LEAD' ? 'font-bold text-spark-ink' : ''}>{i.name}</span>
                          {i.role && ROLE[i.role] && i.role !== 'NEW' && <span className="text-[10.5px] text-spark-muted">({t(ROLE[i.role]!)})</span>}</span>
                      )) : <span className="text-spark-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}
