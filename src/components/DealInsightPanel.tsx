// 투자·펀드 탭 맨 위 "한눈에 보는 요약" — 3줄 요약 · 눈여겨볼 신호 · 지금 할 일(2026-11-26 소윤).
// 매일 07:30 크론이 만든 AI 요약을 읽기만 한다. 아직 없으면 집계 숫자로 만든 기본 요약을 보여주고 출처를 구분해 표시한다.
import Link from 'next/link';
import type { DealInsight, InsightLink, InsightSource } from '@/lib/sparkscope/deal-insight';
import { dealsHref } from '@/lib/sparkscope/deal-links';
import type { T } from './FundAnalysis';
import { InsightRefreshButton } from './InsightRefreshButton';
import type { FundRow } from '@/lib/sparkscope/fund-stats';
import { lpGroup } from '@/lib/sparkscope/fund-stats';
import { krw } from './FundAnalysis';
import { FundKindTabs } from './FundKindTabs';
import { FundFeedbackButtons } from './FundFeedbackButtons';
import type { FundFeedbackState } from '@/lib/sparkscope/fund-kind';

const FSTAGE: Record<string, { label: string; cls: string; order: number }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', order: 0 },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200', order: 1 },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200', order: 2 },
};
// 같은 단계라도 모펀드와 자펀드는 뜻이 다르다 — GP를 뽑기 전인 재원에 '결성 완료'가 붙어 헷갈렸다(2026-11-27 벤처1본부).
const STAGE_LABEL: Record<'CHILD' | 'MOTHER', Record<string, string>> = {
  CHILD: { CLOSED: '결성 완료', GP_SELECTED: 'GP 선정 · 결성 전', ANNOUNCED: '결성 추진' },
  MOTHER: { CLOSED: '재원 조성', GP_SELECTED: 'GP 선정', ANNOUNCED: '출자 공고' },
};
export type FundFit = { count: number; names: string[]; bucket: string | null };

const LINK_LABEL: Record<string, string> = { sector: '딜 표', stage: '딜 표', house: '딜 표', fundSector: '펀드 표', match: '포폴 매칭', newFunds: '새 펀드' };

export function insightHref(l?: InsightLink): string | null {
  if (!l) return null;
  switch (l.kind) {
    case 'sector': return dealsHref('deals', { sec: l.value });
    case 'stage': return dealsHref('deals', { st: l.value });
    case 'house': return dealsHref('deals', { inv: l.value });
    case 'fundSector': return dealsHref('funds', { sec: l.value });
    case 'match': return `/dashboard?tab=fund&ana=match&sec=${encodeURIComponent(l.value ?? '')}`;
    case 'newFunds': return '/dashboard?tab=fund&ana=match';
    default: return null;
  }
}

function Go({ href, children, className }: { href: string | null; children: React.ReactNode; className?: string }) {
  return href ? <Link href={href} className={`${className ?? ''} group block h-full rounded-lg transition-colors hover:bg-spark-purple/[0.04]`}>{children}</Link> : <div className={`${className ?? ''} h-full`}>{children}</div>;
}

/** 문장 속 [n]을 근거 기사 링크(작은 번호)로 바꾼다. */
function Cite({ text, sources }: { text: string; sources: InsightSource[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return <>{parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    const src = m ? sources.find(s => s.n === Number(m[1])) : null;
    if (m && !src) return null;
    return src ? <a key={i} href={src.link} target="_blank" rel="noopener noreferrer" title={`${src.title} · ${src.source}`}
      className="mx-0.5 align-super text-[10px] font-bold text-spark-purple hover:underline">[{src.n}]</a> : <span key={i}>{p}</span>;
  })}</>;
}

export function DealInsightPanel({ data, fallback, t, funds = [], fits = {}, feedback }: {
  data: { insight: DealInsight; computedAt: Date } | null;
  fallback: string[];
  t: T;
  /** 펀드 카드 재료(DB 그대로) — 갓 결성된 펀드가 맨 위(2026-11-26 실무 피드백) */
  funds?: FundRow[];
  /** 펀드 이름 → 분야가 맞는 우리 포폴 */
  fits?: Record<string, FundFit>;
  /** 카드별 O/X(2026-11-27 벤처1본부). 표가 아직 없으면 ready=false라 버튼이 안 나온다. */
  feedback?: FundFeedbackState;
}) {
  const ai = data?.insight;
  const time = data ? new Date(data.computedAt.getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : null;
  const small = ai && ai.basis.deals < 30;
  const srcs = ai?.sources ?? [];

  return (
    <section className="mb-3 rounded-2xl border border-spark-purple/25 bg-gradient-to-br from-spark-purple/[0.06] to-white p-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">🧭 {t('요즘 돈의 흐름 — 한눈에')}</h2>
        <span className="text-[11.5px] text-spark-muted">
          {ai ? `🤖 ${t('AI 분석 · {d} 기준', { d: time! })}` : `⚙️ ${t('기본 요약 · AI 분석 전')}`}
          {ai && ` · ${t('딜 {d}건 · 펀드 {f}개 바탕', { d: ai.basis.deals, f: ai.basis.funds })}`}
        </span>
        <span className="ml-auto"><InsightRefreshButton computedAt={data ? data.computedAt.toISOString() : null}
          label={{ run: t('AI 분석 실행'), rerun: t('최신으로 다시 분석'), busy: t('분석 중… (30~60초)'), confirm: t('오늘 이미 만든 분석이 있습니다. 다시 분석할까요? (회당 약 200원)') }} /></span>
      </div>
      {small && <p className="mb-2 text-[11.5px] text-amber-700">{t('기록이 아직 적어(딜 30건 미만) 초기 신호로만 보세요.')}</p>}

      {funds.length > 0 && (() => {
        const sorted = [...funds].sort((a, b) => (FSTAGE[a.stage]?.order ?? 9) - (FSTAGE[b.stage]?.order ?? 9) || b.date.localeCompare(a.date));
        const plays = new Map((ai?.fundPlays ?? []).map(p => [p.fund, p]));
        const fbLabels = { ask: t('이 카드, 이 탭에 맞나요?'), o: t('맞아요'), x: t('생뚱맞아요'), note: t('이유 적기(선택)'), save: t('저장'), saved: t('저장됨'), fail: t('저장 실패') };
        const cards = (kind: 'CHILD' | 'MOTHER') => (
            <ul className="space-y-2">
              {sorted.filter(f => f.kind === kind).map(f => {
                const play = plays.get(f.name);
                const fit = fits[f.name];
                const lpGroups = new Map<string, string[]>();
                for (const l of f.lps) { const g = lpGroup(l).label; lpGroups.set(g, [...(lpGroups.get(g) ?? []), l]); }
                return (
                  <li key={f.id} className="grid grid-cols-1 overflow-hidden rounded-xl border border-spark-border bg-white lg:grid-cols-[1.05fr_1fr]">
                    <div className="p-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${FSTAGE[f.stage]?.cls ?? ''}`}>{t(STAGE_LABEL[kind][f.stage] ?? FSTAGE[f.stage]?.label ?? f.stage)}</span>
                        <span className="text-[11.5px] tabular-nums text-spark-muted">{f.date.slice(5)}</span>
                        <span className="ml-auto text-[15px] font-extrabold tabular-nums text-spark-ink">{f.sizeKrw != null ? krw(f.sizeKrw, t) : '—'}{f.sizeIsTarget && <span className="ml-0.5 text-[10.5px] font-normal text-spark-muted">({t('목표')})</span>}</span>
                      </div>
                      <div className="mt-1 text-[14px] font-extrabold text-spark-ink">
                        {f.link ? <a href={f.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple hover:underline">{f.label} ↗</a> : f.label}
                      </div>
                      {play?.what && <div className="mt-0.5 text-[12.5px] text-spark-ink-soft">{play.what}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="text-[10.5px] font-bold text-spark-muted">LP</span>
                        {lpGroups.size ? [...lpGroups].map(([g, names]) => (
                          <span key={g} className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-800" title={names.join(', ')}>{t(g)} · {names[0]}{names.length > 1 ? ` ${t('외 {n}', { n: names.length - 1 })}` : ''}</span>
                        )) : <span className="text-spark-muted">{t('기사에 없음')}</span>}
                        <span className="font-bold text-spark-muted">→</span>
                        <span className="text-[10.5px] font-bold text-spark-muted">GP</span>
                        <span className="rounded bg-spark-purple/10 px-1.5 py-0.5 font-bold text-spark-purple">{f.gps.join(', ') || t('선정 전')}</span>
                      </div>
                      <div className="mt-1.5 text-[11.5px] text-spark-muted">
                        {t('분야')}: {f.sectors.length ? f.sectors.join(' · ') : t('지정 안 됨(블라인드)')}
                      </div>
                      {feedback?.ready && <FundFeedbackButtons fundId={f.id} shownKind={kind} labels={fbLabels}
                        initial={feedback.mine[f.id] ?? null} counts={feedback.counts[f.id] ?? { o: 0, x: 0 }} />}
                    </div>
                    <div className="border-t border-emerald-200 bg-emerald-50/50 p-3.5 lg:border-l lg:border-t-0">
                      <div className="mb-1 text-[11px] font-extrabold tracking-wide text-emerald-800">✅ {t('우리 포지션 · 할 일')}</div>
                      {play ? (
                        <>
                          <p className="text-[12.5px] leading-snug text-emerald-950">{play.position}</p>
                          {play.action && <p className="mt-1.5 text-[12.5px] font-bold text-emerald-900">→ {play.action}</p>}
                        </>
                      ) : <p className="text-[12px] text-emerald-900/70">{ai ? t('이 펀드는 마지막 분석 뒤에 들어왔거나 예전 형식 분석입니다. 다시 분석하면 나옵니다.') : t('AI 분석을 실행하면 우리 포지션과 할 일이 나옵니다.')}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10.5px] font-bold text-emerald-800">{t('소개할 포폴')}</span>
                        {(play?.targets.length ? play.targets : fit?.names.slice(0, 4) ?? []).map(n => <span key={n} className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-900">{n}</span>)}
                        {fit && fit.count > 0
                          ? <Link href={`/dashboard?tab=fund&ana=match${fit.bucket ? `&sec=${encodeURIComponent(fit.bucket)}` : ''}`} className="ml-1 text-[11px] font-bold text-spark-purple hover:underline">{t('분야 맞는 포폴 {n}곳 · 매칭 →', { n: fit.count })}</Link>
                          : <span className="text-[11px] text-emerald-900/70">{t('분야가 정해지지 않아 자동 매칭 없음')}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
        );
        const n = (kind: 'CHILD' | 'MOTHER') => sorted.filter(f => f.kind === kind).length;
        return (
          <div className="mb-4">
            <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">🆕 {t('새로 잡힌 펀드')}</h3>
            <FundKindTabs emptyLabel={t('최근 90일에 잡힌 펀드가 없습니다.')} tabs={[
              { id: 'CHILD', label: `🎯 ${t('자펀드 — 후속 투자 연결')}`, count: n('CHILD'), body: cards('CHILD'),
                hint: t('GP가 스타트업에 투자하려고 만든 펀드입니다. 포폴 후속 투자를 연결할 곳을 찾을 때 봅니다. 결성 완료 → GP 선정 → 결성 추진 순.') },
              { id: 'MOTHER', label: `🏦 ${t('모펀드·출자사업 — 큰 돈의 흐름')}`, count: n('MOTHER'), body: cards('MOTHER'),
                hint: t('자펀드에 돈을 대는 재원입니다. 여기서 출자 공고가 나고 GP가 뽑히면 몇 달 뒤 자펀드가 결성됩니다.') },
            ]} />
          </div>
        );
      })()}

      <h3 className="mb-1.5 text-[15px] font-extrabold text-spark-ink">🧭 {t('3줄 요약')}</h3>
      <ul className="space-y-1.5 text-[14px] font-semibold leading-snug text-spark-ink">
        {(ai?.summary ?? fallback).map((s, i) => (
          <li key={i} className="flex gap-2"><span className="tabular-nums text-spark-purple">{i + 1}.</span><span>
            <Cite text={s.replace(/^\s*\d+\.\s*/, '')} sources={srcs} />
            {(() => { const l = ai?.summaryLinks?.[i]; const h = insightHref(l ?? undefined); return h && l ? (
              <Link href={h} className="ml-1.5 inline-flex items-center rounded border border-spark-border bg-white px-1.5 py-px align-middle text-[10.5px] font-semibold text-spark-muted hover:border-spark-purple/40 hover:text-spark-purple">📊 {t(LINK_LABEL[l.kind])}{l.value ? ` · ${t(l.value)}` : ''} ›</Link>
            ) : null; })()}
          </span></li>
        ))}
      </ul>

      {ai && ai.insights.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">🔎 {t('눈여겨볼 신호')}</h3>
          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
            {ai.insights.map((x, i) => {
              const href = insightHref(x.link);
              return (
                <li key={i} className="flex flex-col rounded-lg border border-spark-border bg-white">
                  <Go href={href} className="flex-1 px-3 py-2">
                    <div className="text-[13px] font-bold text-spark-ink group-hover:text-spark-purple">{x.title}{href && <span className="ml-1 text-spark-muted">›</span>}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-spark-ink-soft"><Cite text={x.detail} sources={srcs} /></div>
                  </Go>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
