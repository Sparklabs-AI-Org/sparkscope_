// 투자·펀드 탭 "포폴 매칭" — 투자팀이 포폴사 하나를 고르면, 지금 그 분야에 실제로 돈을 쓰는 하우스와
// 새로 생긴(돈이 남은) 펀드를 점수·이유와 함께 보여준다(2026-11-26 소윤). 읽기 전용.
// 재료: Deal·Fund(deal-extract.ts가 기사에서 뽑음) + MonitoringTarget.sector(포폴 분야).
// 포폴사 투자 단계는 아직 없다 — SLAB 연결(SLAB_DATABASE_URL) 후 단계 맞춤을 더한다.
import { prisma } from '@/lib/prisma';
import { investorKey, sectorOf, stageOf, STAGES } from './deal-stats';

export interface HouseMatch {
  key: string; name: string; score: number; reasons: string[];
  sectorDeals: number; leads: number; recent: string; topStage: string; ourPortfolio: number;
}
export interface FundMatch {
  id: string; name: string; stage: string; gps: string[]; sizeKrw: number | null; date: string; reasons: string[]; link: string | null;
}
export interface PortfolioCo { id: string; name: string; sector: string | null; bucket: string; lastDeal: { date: string; round: string | null; investors: string[] } | null }
export interface MatchStats {
  days: number;
  buckets: { id: string; companies: number; deals: number; funds: number }[];
  companies: PortfolioCo[];
  selected: PortfolioCo | null;
  houses: HouseMatch[];
  funds: FundMatch[];
  /** 지난 7일 새로 결성·GP선정된 펀드와, 분야가 맞는 우리 포폴 수 — 화면 맨 위 알림. */
  newFunds: { id: string; name: string; stage: string; gps: string[]; sizeKrw: number | null; date: string; buckets: string[]; matchCount: number; link: string | null }[];
  /** 선택한 포폴사의 진행 기록. 키 = `${kind}|${counterKey}` */
  actions: Record<string, { status: string; by: string | null; at: string }>;
  /** 팀 전체 최근 진행 기록(보류 제외) */
  pipeline: { targetId: string; targetName: string; kind: string; counterName: string; status: string; by: string | null; at: string }[];
}

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (day: string) => Math.floor((Date.now() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000);

export async function getMatchStats(opts: { days?: number; companyId?: string; bucket?: string } = {}): Promise<MatchStats> {
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * 86_400_000);
  const [targets, deals, funds] = await Promise.all([
    prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' },
      select: { id: true, name: true, sector: true }, orderBy: { name: 'asc' },
    }),
    prisma.deal.findMany({
      where: { announcedAt: { gte: since }, reviewStatus: { not: 'REJECTED' } },
      include: { company: { select: { sector: true, monitoringTargetId: true } }, investors: { include: { investor: { select: { name: true } } } } },
    }),
    prisma.fund.findMany({
      where: { reviewStatus: { not: 'REJECTED' }, OR: [{ announcedAt: { gte: since } }, { closedAt: { gte: since } }, { createdAt: { gte: since } }] },
      include: { gps: { include: { investor: { select: { name: true } } } }, sources: { include: { article: { select: { link: true } } }, take: 1 } },
    }),
  ]);

  // 우리 포폴사의 지난 투자(기사에 잡힌 것) — 이미 아는 하우스는 따로 표시한다.
  const pastByTarget = new Map<string, { date: string; round: string | null; investors: string[] }>();
  for (const d of [...deals].sort((a, b) => a.announcedAt.getTime() - b.announcedAt.getTime())) {
    const t = d.company.monitoringTargetId;
    if (t) pastByTarget.set(t, { date: kstDay(d.announcedAt), round: d.round, investors: d.investors.map(i => i.investor.name) });
  }

  const companies: PortfolioCo[] = targets.map(t => ({ id: t.id, name: t.name, sector: t.sector, bucket: sectorOf(t.sector), lastDeal: pastByTarget.get(t.id) ?? null }));

  const dealRows = deals.map(d => ({
    bucket: sectorOf(d.company.sector), stage: stageOf(d.round), date: kstDay(d.announcedAt), portfolio: !!d.company.monitoringTargetId,
    investors: d.investors.map(i => ({ name: i.investor.name, role: i.role })),
  }));
  const fundRows = funds.map(f => ({
    id: f.id, name: f.fundName ?? f.programName ?? (f.gps[0] ? `${f.gps[0].investor.name} 펀드` : '이름 미상 펀드'),
    stage: f.stage as string, gps: f.gps.map(g => g.investor.name),
    sizeKrw: f.closedSizeKrw != null ? Number(f.closedSizeKrw) : f.targetSizeKrw != null ? Number(f.targetSizeKrw) : null,
    date: kstDay(f.closedAt ?? f.announcedAt ?? f.createdAt), buckets: new Set(f.sectors.map(s => sectorOf(s))),
    link: f.sources[0]?.article.link ?? null,
  }));

  const bucketIds = [...new Set(companies.map(c => c.bucket))];
  const buckets = bucketIds.map(id => ({
    id, companies: companies.filter(c => c.bucket === id).length,
    deals: dealRows.filter(d => d.bucket === id).length, funds: fundRows.filter(f => f.buckets.has(id)).length,
  })).sort((a, b) => b.deals - a.deals || b.companies - a.companies);

  const selected = companies.find(c => c.id === opts.companyId) ?? null;
  const bucket = selected?.bucket ?? opts.bucket ?? null;

  // 새 펀드 알림: 지난 7일 안에 결성 완료·GP 선정으로 처음 잡힌 펀드.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const newFunds = funds.filter(f => (f.stage === 'CLOSED' || f.stage === 'GP_SELECTED') && f.createdAt.getTime() >= weekAgo).map(f => {
    const row = fundRows.find(r => r.id === f.id)!;
    const bs = [...row.buckets].filter(b => b !== '기타' && b !== '미상');
    return { id: f.id, name: row.name, stage: row.stage, gps: row.gps, sizeKrw: row.sizeKrw, date: row.date, buckets: bs,
      matchCount: companies.filter(c => bs.includes(c.bucket)).length, link: row.link };
  }).sort((a, b) => b.matchCount - a.matchCount || b.date.localeCompare(a.date));

  const nameById = new Map(companies.map(c => [c.id, c.name]));
  const [mine, recentActs] = await Promise.all([
    selected ? prisma.matchAction.findMany({ where: { targetId: selected.id } }) : Promise.resolve([]),
    prisma.matchAction.findMany({ where: { status: { not: 'PASSED' } }, orderBy: { updatedAt: 'desc' }, take: 12 }),
  ]);
  const actions: MatchStats['actions'] = {};
  for (const a of mine) actions[`${a.kind}|${a.counterKey}`] = { status: a.status, by: a.updatedBy, at: kstDay(a.updatedAt) };
  const pipeline = recentActs.map(a => ({ targetId: a.targetId, targetName: nameById.get(a.targetId) ?? '—', kind: a.kind,
    counterName: a.counterName, status: a.status, by: a.updatedBy, at: kstDay(a.updatedAt) }));

  if (!bucket) return { days, buckets, companies, selected, houses: [], funds: [], newFunds, actions, pipeline };

  // ── 하우스 점수: 같은 분야 딜 ×3, 리드 ×2, 최근 30일 +2, 우리 포폴에 들어온 적 +1.
  const known = new Set((selected?.lastDeal?.investors ?? []).map(investorKey));
  const hm = new Map<string, { name: string; sectorDeals: number; leads: number; recent: string; stage: Map<string, number>; pf: number }>();
  for (const d of dealRows) {
    if (d.bucket !== bucket) continue;
    for (const i of d.investors) {
      if (i.role === 'EXISTING') continue; // 기존 투자자 후속은 "새 돈"이 아니다
      const k = investorKey(i.name);
      const e = hm.get(k) ?? { name: i.name, sectorDeals: 0, leads: 0, recent: '', stage: new Map(), pf: 0 };
      e.sectorDeals++; if (i.role === 'LEAD') e.leads++;
      if (d.date > e.recent) e.recent = d.date;
      e.stage.set(d.stage, (e.stage.get(d.stage) ?? 0) + 1);
      if (d.portfolio) e.pf++;
      hm.set(k, e);
    }
  }
  const stageLabel = (id: string) => STAGES.find(s => s.id === id)?.label ?? id;
  const houses: HouseMatch[] = [...hm].map(([k, e]) => {
    const recentDays = daysAgo(e.recent);
    const topStage = stageLabel([...e.stage].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '');
    const reasons = [`${bucket} 딜 ${e.sectorDeals}건`];
    if (e.leads) reasons.push(`리드 ${e.leads}건`);
    if (recentDays <= 30) reasons.push(`${recentDays}일 전 투자`);
    if (e.pf) reasons.push(`우리 포폴 ${e.pf}곳 투자`);
    if (known.has(k)) reasons.push('이미 이 회사 투자사');
    const score = e.sectorDeals * 3 + e.leads * 2 + (recentDays <= 30 ? 2 : 0) + (e.pf ? 1 : 0);
    return { key: k, name: e.name, score, reasons, sectorDeals: e.sectorDeals, leads: e.leads, recent: e.recent, topStage, ourPortfolio: e.pf };
  }).sort((a, b) => b.score - a.score || b.recent.localeCompare(a.recent)).slice(0, 10);

  // ── 펀드: 같은 분야를 내건 펀드. 결성 완료(이제 막 투자 시작)·GP 선정(곧 결성) 순.
  const order: Record<string, number> = { CLOSED: 0, GP_SELECTED: 1, ANNOUNCED: 2 };
  const fundsOut: FundMatch[] = fundRows.filter(f => f.buckets.has(bucket)).map(f => {
    const reasons = [`주목적 분야 ${bucket}`];
    if (f.stage === 'CLOSED') reasons.push('결성 완료 — 투자 집행 시작 단계');
    else if (f.stage === 'GP_SELECTED') reasons.push('GP 선정 — 곧 결성');
    else reasons.push('출자 공고 — GP 미정');
    if (f.gps.some(g => hm.has(investorKey(g)))) reasons.push('GP가 이 분야에 최근 투자');
    return { id: f.id, name: f.name, stage: f.stage, gps: f.gps, sizeKrw: f.sizeKrw, date: f.date, reasons, link: f.link };
  }).sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9) || b.date.localeCompare(a.date)).slice(0, 8);

  return { days, buckets, companies, selected, houses, funds: fundsOut, newFunds, actions, pipeline };
}
