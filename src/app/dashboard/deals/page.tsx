// 투자 딜·펀드 결성 — 기사에서 뽑은 Deal/Fund 테이블을 보여준다(2026-11-24 소윤 요청).
//
// 데이터는 lib/sparkscope/deal-extract.ts가 매일 07:30에 채운다(국내만). 값마다 근거 기사가 붙어 있고,
// "어떤 펀드로"는 기사에 거의 안 나와서 비어 있는 게 정상이다. 누적 투자·이전 투자는 저장값이 아니라
// 우리 DB에 쌓인 그 회사 딜을 모아 계산한다(기사에 "누적 ○○억"이 있으면 그 숫자를 따로 보여준다).
//
// 사내 계정 전용 — 포트폴리오사 매칭 등 내부 분석이 들어간다.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getT } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/authz';
import { isInternal } from '@/lib/roles';
import { investorKey, sectorOf, stageOf, STAGES } from '@/lib/sparkscope/deal-stats';
import { lpGroup, normSector } from '@/lib/sparkscope/fund-stats';
import { dealsHref, kstDay, mondayOf, type DealFilter } from '@/lib/sparkscope/deal-links';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'icn1';

const ROUND_LABEL: Record<string, string> = {
  SEED: '시드', PRE_A: '프리A', A: '시리즈A', B: '시리즈B', C: '시리즈C', D_PLUS: '시리즈D+',
  BRIDGE: '브릿지', PRE_IPO: '프리IPO', STRATEGIC: '전략적 투자', MA: 'M&A', OTHER: '기타',
};
const ROLE_LABEL: Record<string, string> = { LEAD: '리드', FOLLOW: '후속', NEW: '신규', EXISTING: '기존' };
const STAGE: Record<string, { label: string; cls: string }> = {
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
const PERIODS = [7, 30, 90] as const;

function fmtDate(d: Date | null) {
  if (!d) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
/** 원 → "338억" / "1.2조". 비공개면 "비공개". */
function fmtKrw(v: bigint | null | undefined) {
  if (v == null) return null;
  const eok = Number(v) / 1e8;
  if (eok >= 10000) return `${(eok / 10000).toFixed(eok >= 100000 ? 0 : 1).replace(/\.0$/, '')}조`;
  return `${eok >= 100 ? Math.round(eok).toLocaleString() : eok.toFixed(1).replace(/\.0$/, '')}억`;
}

export default async function DealsPage({ searchParams }: { searchParams: { tab?: string; days?: string } & DealFilter }) {
  const viewer = await getSessionUser();
  if (!viewer || !isInternal(viewer.role)) redirect('/dashboard');
  const t = getT();

  const tab = searchParams.tab === 'funds' ? 'funds' : 'deals';
  const days = PERIODS.includes(Number(searchParams.days) as any) ? Number(searchParams.days) : 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const [deals, funds, dealCount, fundCount] = await Promise.all([
    tab === 'deals'
      ? prisma.deal.findMany({
          where: { announcedAt: { gte: since }, reviewStatus: { not: 'REJECTED' } },
          orderBy: { announcedAt: 'desc' },
          take: 300,
          include: {
            company: {
              include: {
                monitoringTarget: { select: { category: true } },
                // 이전 투자 이력·누적 계산용 — 이 회사의 모든 딜
                deals: { where: { reviewStatus: { not: 'REJECTED' } }, orderBy: { announcedAt: 'asc' }, select: { id: true, round: true, amountKrw: true, announcedAt: true } },
              },
            },
            investors: { include: { investor: { select: { name: true } } } },
            sources: { include: { article: { select: { title: true, link: true, source: true } } } },
          },
        })
      : [],
    tab === 'funds'
      ? prisma.fund.findMany({
          where: { OR: [{ announcedAt: { gte: since } }, { closedAt: { gte: since } }, { createdAt: { gte: since } }], reviewStatus: { not: 'REJECTED' } },
          orderBy: { announcedAt: 'desc' },
          take: 300,
          include: {
            gps: { include: { investor: { select: { name: true } } } },
            lps: { include: { investor: { select: { name: true } } } },
            sources: { include: { article: { select: { title: true, link: true, source: true, pubDate: true } } } },
          },
        })
      : [],
    prisma.deal.count({ where: { announcedAt: { gte: since }, reviewStatus: { not: 'REJECTED' } } }),
    prisma.fund.count({ where: { OR: [{ announcedAt: { gte: since } }, { closedAt: { gte: since } }, { createdAt: { gte: since } }], reviewStatus: { not: 'REJECTED' } } }),
  ]);

  // 분석 그래프에서 눌러 들어온 조건(분야·단계·하우스·날짜 등). 표 위에 칩으로 보이고 × 로 지운다.
  const f: DealFilter = {};
  for (const k of ['sec', 'st', 'inv', 'inv2', 'lp', 'day', 'week', 'pf', 'sized'] as const) {
    const v = searchParams[k]; if (typeof v === 'string' && v) (f as any)[k] = v.slice(0, 100);
  }
  const hasInv = (names: string[], want?: string) => !want || names.some(n => investorKey(n) === investorKey(want));
  const dateOk = (day: string) => (!f.day || day === f.day) && (!f.week || mondayOf(day) === f.week);
  const shownDeals = deals.filter(d => {
    const names = d.investors.map(i => i.investor.name);
    return (!f.sec || sectorOf(d.company.sector) === f.sec) && (!f.st || stageOf(d.round) === f.st)
      && hasInv(names, f.inv) && hasInv(names, f.inv2) && dateOk(kstDay(d.announcedAt))
      && (!f.pf || !!d.company.monitoringTargetId) && (!f.sized || d.amountKrw != null);
  });
  const shownFunds = funds.filter(x => {
    const gps = x.gps.map(g => g.investor.name);
    return (!f.sec || x.sectors.some(s => normSector(s) === f.sec)) && (!f.st || x.stage === f.st || (f.st === 'PIPE' && x.stage !== 'CLOSED')) && hasInv(gps, f.inv)
      && (!f.lp || x.lps.some(l => lpGroup(l.investor.name).id === f.lp)) && dateOk(kstDay(x.closedAt ?? x.announcedAt ?? x.sources[0]?.article.pubDate ?? x.createdAt))
      && (!f.sized || x.closedSizeKrw != null || x.targetSizeKrw != null);
  });
  const stLabel = (v: string) => v === 'PIPE' ? '출자 공고·GP 선정' : STAGES.find(s => s.id === v)?.label ?? STAGE[v]?.label ?? v;
  const LP_LABEL: Record<string, string> = { mother: '모태펀드', growth: '성장금융·산업은행', local: '지자체·지역', pension: '연기금·공제회', finance: '은행·증권·금융지주', corp: '기업(CVC·대기업)', other: '기타' };
  const chips: { k: keyof DealFilter; label: string }[] = [
    f.sec && { k: 'sec' as const, label: t(f.sec) }, f.st && { k: 'st' as const, label: t(stLabel(f.st)) },
    f.inv && { k: 'inv' as const, label: f.inv }, f.inv2 && { k: 'inv2' as const, label: `+ ${f.inv2}` },
    f.lp && { k: 'lp' as const, label: t(LP_LABEL[f.lp] ?? f.lp) }, f.day && { k: 'day' as const, label: f.day },
    f.week && { k: 'week' as const, label: t('{d} 주', { d: f.week }) }, f.pf && { k: 'pf' as const, label: t('우리 포트폴리오') },
    f.sized && { k: 'sized' as const, label: t('금액 공개') },
  ].filter(Boolean) as any;
  const without = (k: keyof DealFilter) => {
    const u = new URLSearchParams({ tab, days: String(days) });
    for (const [kk, v] of Object.entries(f)) if (v && kk !== k) u.set(kk, v);
    return `/dashboard/deals?${u.toString()}`;
  };
  const invHref = (name: string) => dealsHref(tab, { inv: name });

  const q = (p: Partial<{ tab: string; days: number }>) => {
    const u = new URLSearchParams({ tab: p.tab ?? tab, days: String(p.days ?? days) });
    if (!p.tab) for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
    return `/dashboard/deals?${u.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold">💰 {t('투자 딜·펀드')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('투자 전문 매체와 수집 기사에서 AI가 뽑은 국내 투자 유치·펀드 결성 소식입니다. 값마다 근거 기사가 붙어 있습니다.')}
          </p>
        </div>
        <Link href={`/dashboard?tab=fund&ana=${tab === 'funds' ? 'fund' : 'round'}`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← {t('투자·펀드 분석')}</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={q({ tab: 'deals' })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold border ${tab === 'deals' ? 'bg-spark-purple text-white border-spark-purple' : 'bg-white text-gray-600 border-gray-200 hover:border-spark-purple/40'}`}>
          🚀 {t('투자 유치')} <span className="tabular-nums opacity-80">{dealCount}</span>
        </Link>
        <Link href={q({ tab: 'funds' })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold border ${tab === 'funds' ? 'bg-spark-purple text-white border-spark-purple' : 'bg-white text-gray-600 border-gray-200 hover:border-spark-purple/40'}`}>
          🏦 {t('펀드 결성')} <span className="tabular-nums opacity-80">{fundCount}</span>
        </Link>
        <div className="ml-auto flex gap-1">
          {PERIODS.map(d => (
            <Link key={d} href={q({ days: d })} className={`rounded-md px-2.5 py-1 text-xs font-semibold border ${days === d ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200'}`}>
              {t('최근 {n}일', { n: d })}
            </Link>
          ))}
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs font-semibold text-gray-500">{t('조건')}</span>
          {chips.map(c => (
            <Link key={c.k} href={without(c.k)} className="inline-flex items-center gap-1 rounded-full border border-spark-purple/30 bg-spark-light-purple px-2.5 py-0.5 text-xs font-bold text-spark-purple hover:bg-white">
              {c.label} <span aria-hidden>×</span>
            </Link>
          ))}
          <span className="text-xs text-gray-500">{t('{n}건', { n: tab === 'deals' ? shownDeals.length : shownFunds.length })}</span>
          <Link href={q({ tab })} className="ml-1 text-xs text-gray-400 underline hover:text-gray-600">{t('조건 모두 지우기')}</Link>
        </div>
      )}

      {tab === 'deals' ? (
        <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {shownDeals.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">{t('이 기간에 정리된 투자 유치 소식이 없습니다. 매일 07:30에 새 기사를 정리합니다.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{t('날짜')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('회사')}</th>
                  <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{t('라운드·금액')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('투자사')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('이전 투자·누적')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('근거 기사')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shownDeals.map(d => {
                  const c = d.company;
                  const prior = c.deals.filter(x => x.id !== d.id && x.announcedAt < d.announcedAt);
                  const sum = c.deals.filter(x => x.announcedAt <= d.announcedAt).reduce((s, x) => s + (x.amountKrw ?? 0n), 0n);
                  const ours = c.monitoringTarget?.category === 'portfolio_company';
                  const investors = [...d.investors].sort((a, b) => (a.role === 'LEAD' ? -1 : 0) - (b.role === 'LEAD' ? -1 : 0));
                  return (
                    <tr key={d.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-gray-500">{fmtDate(d.announcedAt)}</td>
                      <td className="px-4 py-3 min-w-[200px]">
                        <div className="font-bold text-spark-ink">
                          {c.name}
                          {ours && <span className="ml-1.5 rounded bg-spark-light-purple px-1.5 py-0.5 text-[10px] font-bold text-spark-purple">{t('포트폴리오')}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {[c.ceoName && t('대표 {name}', { name: c.ceoName }), c.foundedYear && t('{y}년 설립', { y: c.foundedYear }), c.sector].filter(Boolean).join(' · ')}
                        </div>
                        {c.description && <div className="text-xs text-gray-600 mt-1 leading-snug">{c.description}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold">{d.round ? t(ROUND_LABEL[d.round] ?? d.round) : '—'}</div>
                        <div className="tabular-nums text-gray-700">{fmtKrw(d.amountKrw) ?? <span className="text-gray-400">{t('비공개')}</span>}</div>
                      </td>
                      <td className="px-4 py-3 min-w-[220px]">
                        {investors.length === 0 ? <span className="text-gray-400">—</span> : (
                          <ul className="space-y-0.5">
                            {investors.map(i => (
                              <li key={i.id} className="text-xs">
                                <Link href={invHref(i.investor.name)} className={`hover:text-spark-purple hover:underline ${i.role === 'LEAD' ? 'font-bold text-spark-ink' : 'text-gray-700'}`}>{i.investor.name}</Link>
                                {i.role && <span className="ml-1 text-gray-400">{t(ROLE_LABEL[i.role] ?? i.role)}</span>}
                                {i.fundName && <div className="text-[11px] text-gray-500 pl-2">└ {i.fundName}</div>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[160px] text-xs">
                        {prior.length === 0 ? <span className="text-gray-400">{t('기록 없음')}</span> : (
                          <ul className="space-y-0.5 text-gray-600">
                            {prior.map(p => (
                              <li key={p.id} className="tabular-nums">{fmtDate(p.announcedAt).slice(0, 7)} {p.round ? t(ROUND_LABEL[p.round] ?? p.round) : ''} {fmtKrw(p.amountKrw) ?? ''}</li>
                            ))}
                          </ul>
                        )}
                        {d.reportedCumulativeKrw != null ? (
                          <div className="mt-1 font-semibold text-gray-700">{t('누적 {v} (기사)', { v: fmtKrw(d.reportedCumulativeKrw)! })}</div>
                        ) : prior.length > 0 && sum > 0n ? (
                          <div className="mt-1 font-semibold text-gray-700">{t('누적 {v} (DB 합)', { v: fmtKrw(sum)! })}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 min-w-[200px]">
                        <ul className="space-y-1">
                          {d.sources.map(s => (
                            <li key={s.id} className="text-xs">
                              <a href={s.article.link} target="_blank" rel="noreferrer" className="text-spark-purple hover:underline line-clamp-1" title={s.evidence ?? undefined}>{s.article.title}</a>
                              <span className="text-gray-400">{s.article.source}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {shownFunds.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">{t('이 기간에 정리된 펀드 소식이 없습니다. 매일 07:30에 새 기사를 정리합니다.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{t('날짜')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('단계')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('펀드')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('운용사(GP)')}</th>
                  <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{t('규모')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('출자자(LP)')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('근거 기사')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shownFunds.map(f => {
                  const st = STAGE[f.stage] ?? STAGE.CLOSED;
                  return (
                    <tr key={f.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-gray-500">{fmtDate(f.closedAt ?? f.announcedAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{t(st.label)}</span></td>
                      <td className="px-4 py-3 min-w-[200px]">
                        <div className="font-bold text-spark-ink">{f.fundName ?? f.programName ?? '—'}</div>
                        {f.fundName && f.programName && <div className="text-xs text-gray-500">{f.programName}</div>}
                        {f.sectors.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{f.sectors.map(s => <Link key={s} href={dealsHref('funds', { sec: normSector(s) })} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-spark-light-purple hover:text-spark-purple">{s}</Link>)}</div>}
                      </td>
                      <td className="px-4 py-3 min-w-[160px] text-xs">
                        {f.gps.length === 0 ? <span className="text-gray-400">{f.stage === 'ANNOUNCED' ? t('선정 전') : '—'}</span> : (
                          <ul className="space-y-0.5">{f.gps.map(g => (
                            <li key={g.id}><Link href={invHref(g.investor.name)} className="font-semibold text-spark-ink hover:text-spark-purple hover:underline">{g.investor.name}</Link>{g.role === 'CO_GP' && <span className="ml-1 text-gray-400">Co-GP</span>}{g.amountKrw != null && <span className="ml-1 tabular-nums text-gray-500">{fmtKrw(g.amountKrw)}</span>}</li>
                          ))}</ul>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        {fmtKrw(f.closedSizeKrw) ?? (f.targetSizeKrw != null ? <span>{fmtKrw(f.targetSizeKrw)} <span className="text-xs text-gray-400">{t('목표')}</span></span> : <span className="text-gray-400">—</span>)}
                      </td>
                      <td className="px-4 py-3 min-w-[160px] text-xs">
                        {f.lps.length === 0 ? <span className="text-gray-400">—</span> : (
                          <ul className="space-y-0.5 text-gray-700">{f.lps.map(l => (
                            <li key={l.id}>{l.investor.name}{l.amountKrw != null && <span className="ml-1 tabular-nums text-gray-500">{fmtKrw(l.amountKrw)}</span>}</li>
                          ))}</ul>
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[200px]">
                        <ul className="space-y-1">
                          {f.sources.map(s => (
                            <li key={s.id} className="text-xs">
                              <a href={s.article.link} target="_blank" rel="noreferrer" className="text-spark-purple hover:underline line-clamp-1" title={s.evidence ?? undefined}>{s.article.title}</a>
                              <span className="text-gray-400">{s.article.source}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <p className="mt-3 text-xs text-gray-400 leading-relaxed">
        {t('국내 소식만 모읍니다. "어떤 펀드로"는 기사에 펀드명이 적힌 경우에만 나옵니다. 이전 투자·누적은 이 DB에 쌓인 딜 기준이라, 수집 시작(2026-11) 전 투자는 기사에 "누적"이 적힌 경우에만 보입니다. 근거 기사 제목에 마우스를 올리면 판단 근거 문장이 보입니다.')}
      </p>
    </>
  );
}
