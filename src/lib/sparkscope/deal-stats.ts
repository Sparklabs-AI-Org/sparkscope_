// 투자·펀드 탭 "투자 유치 분석" 집계(2026-11-26 소윤). 실무 질문: 돈이 어느 단계·분야로 가나, 지금 실제로 쓰는 하우스는
// 어디인가, 단계별로 보통 얼마 받나, 누가 누구와 같이 들어가나. 재료는 deal-extract.ts가 기사에서 뽑은 Deal 표.
import { prisma } from '@/lib/prisma';

// ── 하우스 이름 합치기: 기사마다 'KB인베스트먼트'/'케이비인베스트먼트', 'BNH'/'비엔에이치'처럼 표기가 갈린다.
const PREFIX: [RegExp, string][] = [
  [/^비엔에이치/, 'BNH'], [/^에스엘/, 'SL'], [/^케이비/, 'KB'], [/^아이비케이/, 'IBK'], [/^에스브이/, 'SV'],
  [/^엘비/, 'LB'], [/^케이티/, 'KT'], [/^디에스씨/, 'DSC'], [/^에이치비/, 'HB'], [/^아이엠/, 'iM'], [/^지에스/, 'GS'],
  [/^씨제이/, 'CJ'], [/^엔에이치/, 'NH'], [/^에스케이/, 'SK'], [/^엘지/, 'LG'], [/^유티씨/, 'UTC'], [/^티에스/, 'TS'],
];
export function investorKey(name: string): string {
  let n = name.replace(/\(주\)|주식회사|\s/g, '').replace(/[‐-―–—]/g, '-');
  for (const [re, en] of PREFIX) n = n.replace(re, en);
  n = n.replace(/^에이티넘(인베스트먼트)?$/, '에이티넘인베스트먼트');
  return n.toUpperCase();
}

// ── 분야 묶기: 기사 표기가 자유 문장이라 실무에서 쓰는 큰 칸으로. 앞에서부터 처음 맞는 칸.
export const SECTORS: { id: string; re: RegExp }[] = [
  { id: '바이오·헬스', re: /바이오|신약|제약|의료|헬스|진단|병원|메디/ },
  { id: '반도체', re: /반도체|팹리스|칩/ },
  { id: '로봇', re: /로봇|드론/ },
  { id: 'AI', re: /AI|인공지능|LLM|에이전트/i },
  { id: '모빌리티·배터리', re: /모빌리티|자동차|전기차|배터리|이차전지|물류/ },
  { id: '기후·에너지', re: /기후|에너지|탄소|친환경|수소|태양광/ },
  { id: '핀테크', re: /핀테크|금융|결제|보험|블록체인|가상자산/ },
  { id: '커머스·소비재', re: /커머스|유통|식품|푸드|뷰티|패션|소비재|브랜드|외식/ },
  { id: '콘텐츠·게임', re: /콘텐츠|게임|엔터|미디어|웹툰|음악|영상/ },
  { id: 'SW·SaaS', re: /SaaS|소프트웨어|플랫폼|클라우드|보안|HR|에듀|교육|B2B/i },
  { id: '딥테크·제조', re: /제조|소재|하드웨어|우주|항공|방산|양자|3D/ },
];
export const sectorOf = (s: string | null | undefined) => (s ? SECTORS.find(x => x.re.test(s))?.id ?? '기타' : '미상');

// ── 단계 칸: 실무에서 보는 순서. 전략·M&A·미상은 끝에.
export const STAGES = [
  { id: 'SEED', label: '시드' }, { id: 'PRE_A', label: '프리A' }, { id: 'A', label: '시리즈A' },
  { id: 'B', label: '시리즈B' }, { id: 'C+', label: '시리즈C+' }, { id: 'ETC', label: '전략·M&A·기타' },
] as const;
export function stageOf(round: string | null): (typeof STAGES)[number]['id'] {
  if (round === 'SEED' || round === 'PRE_A' || round === 'A' || round === 'B') return round;
  if (round === 'C' || round === 'D_PLUS' || round === 'D+' || round === 'PRE_IPO') return 'C+';
  return 'ETC';
}

export interface DealRow {
  id: string; company: string; portfolio: boolean; sector: string; stage: string; round: string | null;
  amountKrw: number | null; date: string; investors: { name: string; role: string | null }[]; link: string | null;
}
export interface InvestorStat {
  name: string; deals: number; leads: number; newMoney: number; sumKrw: number;
  topStage: string; topSector: string; portfolioDeals: number; recent: string;
}
export interface DealStats {
  days: number; total: number; sized: number; sumKrw: number; medianKrw: number | null; portfolioDeals: number;
  weekly: { week: string; count: number; sumKrw: number }[];
  matrix: { sector: string; cells: Record<string, { count: number; sumKrw: number }>; total: number }[];
  stageAmounts: { stage: string; label: string; n: number; min: number; median: number; max: number }[];
  investors: InvestorStat[];
  pairs: { a: string; b: string; count: number }[];
  rows: DealRow[];
}

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

export async function getDealStats(days = 90): Promise<DealStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: { announcedAt: { gte: since }, reviewStatus: { not: 'REJECTED' } },
    include: {
      company: { select: { name: true, sector: true, monitoringTargetId: true } },
      investors: { include: { investor: { select: { name: true } } } },
      sources: { include: { article: { select: { link: true } } }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
    orderBy: { announcedAt: 'desc' },
  });

  const rows: DealRow[] = deals.map(d => {
    // 같은 딜 안에서 표기만 다른 같은 하우스는 하나로(리드 표시가 있는 쪽을 남긴다).
    const seen = new Map<string, { name: string; role: string | null }>();
    for (const di of d.investors) {
      const k = investorKey(di.investor.name);
      const prev = seen.get(k);
      if (!prev || (di.role === 'LEAD' && prev.role !== 'LEAD')) seen.set(k, { name: prev?.name ?? di.investor.name, role: di.role });
    }
    return {
      id: d.id, company: d.company.name, portfolio: !!d.company.monitoringTargetId,
      sector: sectorOf(d.company.sector), stage: stageOf(d.round), round: d.round,
      amountKrw: d.amountKrw != null ? Number(d.amountKrw) : null, date: kstDay(d.announcedAt),
      investors: [...seen.values()], link: d.sources[0]?.article.link ?? null,
    };
  });

  const sizedAmounts = rows.filter(r => r.amountKrw != null).map(r => r.amountKrw!);

  // 주별
  const wk = new Map<string, { count: number; sumKrw: number }>();
  for (const r of rows) {
    const k = mondayOf(r.date); const e = wk.get(k) ?? { count: 0, sumKrw: 0 };
    e.count++; e.sumKrw += r.amountKrw ?? 0; wk.set(k, e);
  }
  const weekly: DealStats['weekly'] = [];
  const end = mondayOf(kstDay(new Date()));
  for (let d = new Date(`${mondayOf(kstDay(since))}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const k = d.toISOString().slice(0, 10);
    weekly.push({ week: k, ...(wk.get(k) ?? { count: 0, sumKrw: 0 }) });
  }

  // 분야 × 단계
  const mx = new Map<string, Record<string, { count: number; sumKrw: number }>>();
  for (const r of rows) {
    const row = mx.get(r.sector) ?? {};
    const c = row[r.stage] ?? { count: 0, sumKrw: 0 };
    c.count++; c.sumKrw += r.amountKrw ?? 0; row[r.stage] = c; mx.set(r.sector, row);
  }
  const matrix = [...mx].map(([sector, cells]) => ({ sector, cells, total: Object.values(cells).reduce((s, c) => s + c.count, 0) }))
    .sort((a, b) => (a.sector === '미상' ? 1 : 0) - (b.sector === '미상' ? 1 : 0) || b.total - a.total);

  // 단계별 금액대
  const stageAmounts = STAGES.map(s => {
    const xs = rows.filter(r => r.stage === s.id && r.amountKrw != null).map(r => r.amountKrw!);
    return { stage: s.id, label: s.label, n: xs.length, min: xs.length ? Math.min(...xs) : 0, median: median(xs) ?? 0, max: xs.length ? Math.max(...xs) : 0 };
  }).filter(s => s.n > 0);

  // 하우스
  const inv = new Map<string, { name: string; deals: number; leads: number; newMoney: number; sumKrw: number; stage: Map<string, number>; sector: Map<string, number>; pf: number; recent: string }>();
  const pairMap = new Map<string, number>();
  for (const r of rows) {
    const keys: string[] = [];
    for (const i of r.investors) {
      const k = investorKey(i.name); keys.push(k);
      const e = inv.get(k) ?? { name: i.name, deals: 0, leads: 0, newMoney: 0, sumKrw: 0, stage: new Map(), sector: new Map(), pf: 0, recent: '' };
      e.deals++;
      if (i.role === 'LEAD') e.leads++;
      if (i.role !== 'EXISTING') e.newMoney++;
      e.sumKrw += r.amountKrw ?? 0;
      e.stage.set(r.stage, (e.stage.get(r.stage) ?? 0) + 1);
      e.sector.set(r.sector, (e.sector.get(r.sector) ?? 0) + 1);
      if (r.portfolio) e.pf++;
      if (r.date > e.recent) e.recent = r.date;
      inv.set(k, e);
    }
    const u = [...new Set(keys)].sort();
    for (let a = 0; a < u.length; a++) for (let b = a + 1; b < u.length; b++) {
      const k = `${u[a]}|${u[b]}`; pairMap.set(k, (pairMap.get(k) ?? 0) + 1);
    }
  }
  const stageLabel = (id: string) => STAGES.find(s => s.id === id)?.label ?? id;
  const investors: InvestorStat[] = [...inv.values()]
    .map(e => ({ name: e.name, deals: e.deals, leads: e.leads, newMoney: e.newMoney, sumKrw: e.sumKrw,
      topStage: stageLabel(top(e.stage)), topSector: top(e.sector), portfolioDeals: e.pf, recent: e.recent }))
    .sort((a, b) => b.deals - a.deals || b.leads - a.leads || b.sumKrw - a.sumKrw)
    .slice(0, 12);
  const nameOf = (k: string) => inv.get(k)?.name ?? k;
  const pairs = [...pairMap].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, count]) => { const [a, b] = k.split('|'); return { a: nameOf(a!), b: nameOf(b!), count }; });

  return {
    days, total: rows.length, sized: sizedAmounts.length, sumKrw: sizedAmounts.reduce((s, x) => s + x, 0),
    medianKrw: median(sizedAmounts), portfolioDeals: rows.filter(r => r.portfolio).length,
    weekly, matrix, stageAmounts, investors, pairs, rows,
  };
}
