// 투자·펀드 탭 위 "펀드 결성 분석" 집계(2026-11-26 소윤 — 기사 목록만으론 의미가 없다, 한눈에 보이게).
// 재료는 deal-extract.ts가 기사에서 뽑아 둔 Fund·FundGP·FundLP 표. 숫자는 원문에 있던 것만 저장돼 있다.
import { prisma } from '@/lib/prisma';

export type FundStage = 'ANNOUNCED' | 'GP_SELECTED' | 'CLOSED';

/** 출자 재원(LP) 분류 — 어디 돈으로 펀드가 만들어지는가. 이름 규칙이라 애매하면 '기타'. */
const LP_GROUPS: { id: string; label: string; re: RegExp }[] = [
  { id: 'mother', label: '모태펀드(한국벤처투자)', re: /모태|한국벤처투자|중소벤처기업부|중기부/ },
  { id: 'growth', label: '성장금융·산업은행', re: /성장금융|산업은행|산은|국민성장|정책금융/ },
  { id: 'local', label: '지자체·지역', re: /[시도]청?$|광역시|특별시|특별자치|도$|지역|지자체|경기|강원|전남|전북|경북|경남|충북|충남|제주|부산|대구|광주|대전|울산|인천|세종/ },
  { id: 'pension', label: '연기금·공제회', re: /연금|공제회|기금|공단/ },
  { id: 'finance', label: '은행·증권·금융지주', re: /은행|금융|증권|캐피탈|보험|신협|농협|새마을|저축/ },
  { id: 'corp', label: '기업(CVC·대기업)', re: /전자|그룹|홀딩스|화학|자동차|건설|통신|텔레콤|주식회사|\(주\)|기업|코퍼레이션/ },
];
export function lpGroup(name: string): { id: string; label: string } {
  const g = LP_GROUPS.find(x => x.re.test(name));
  return g ? { id: g.id, label: g.label } : { id: 'other', label: '기타' };
}

export interface FundRow {
  id: string;
  name: string;
  stage: FundStage;
  sizeKrw: number | null;   // 결성액 우선, 없으면 목표액
  sizeIsTarget: boolean;
  date: string;             // KST yyyy-mm-dd
  gps: string[];
  lps: string[];
  sectors: string[];
  link: string | null;
}

export interface FundStats {
  days: number;
  total: number;
  byStage: Record<FundStage, number>;
  closedSumKrw: number;
  targetSumKrw: number;      // 공고·GP선정 단계 목표액 합(앞으로 만들어질 돈)
  sizedCount: number;
  weekly: { week: string; closed: number; pipeline: number; count: number }[];
  topGps: { name: string; count: number; sumKrw: number }[];
  lpMix: { id: string; label: string; funds: number }[];
  topSectors: { name: string; count: number }[];
  rows: FundRow[];
}

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
// 섹터 표기 흔들림 정리(인공지능=AI 등) — 집계용.
function normSector(s: string): string {
  const t = s.replace(/\s/g, '');
  if (/^(AI|인공지능)/i.test(t)) return 'AI';
  if (/반도체/.test(t)) return '반도체';
  if (/바이오|헬스/.test(t)) return '바이오·헬스';
  if (/이차전지|배터리/.test(t)) return '이차전지';
  if (/방산|국방/.test(t)) return '방산';
  if (/모빌리티|자동차/.test(t)) return '모빌리티';
  if (/딥테크|첨단|전략산업/.test(t)) return '딥테크·첨단전략';
  if (/세컨더리/.test(t)) return '세컨더리';
  if (/M&A|인수/.test(t)) return 'M&A';
  return s.trim();
}

export async function getFundStats(days = 90): Promise<FundStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const funds = await prisma.fund.findMany({
    where: { reviewStatus: { not: 'REJECTED' }, OR: [{ announcedAt: { gte: since } }, { closedAt: { gte: since } }, { createdAt: { gte: since } }] },
    include: {
      gps: { include: { investor: { select: { name: true } } } },
      lps: { include: { investor: { select: { name: true } } } },
      sources: { include: { article: { select: { link: true, pubDate: true } } }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });

  const rows: FundRow[] = funds.map(f => {
    const when = f.closedAt ?? f.announcedAt ?? f.sources[0]?.article.pubDate ?? f.createdAt;
    const closed = f.closedSizeKrw != null ? Number(f.closedSizeKrw) : null;
    const target = f.targetSizeKrw != null ? Number(f.targetSizeKrw) : null;
    return {
      id: f.id,
      name: f.fundName ?? f.programName ?? (f.gps[0] ? `${f.gps[0].investor.name} 펀드` : '이름 미상 펀드'),
      stage: (f.stage as FundStage) ?? 'CLOSED',
      sizeKrw: closed ?? target,
      sizeIsTarget: closed == null && target != null,
      date: kstDay(when),
      gps: f.gps.map(g => g.investor.name),
      lps: f.lps.map(l => l.investor.name),
      sectors: f.sectors,
      link: f.sources[0]?.article.link ?? null,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  const byStage: Record<FundStage, number> = { ANNOUNCED: 0, GP_SELECTED: 0, CLOSED: 0 };
  let closedSumKrw = 0, targetSumKrw = 0, sizedCount = 0;
  const weekMap = new Map<string, { closed: number; pipeline: number; count: number }>();
  const gpMap = new Map<string, { count: number; sumKrw: number }>();
  const lpMap = new Map<string, { label: string; funds: number }>();
  const secMap = new Map<string, number>();

  for (const r of rows) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    const size = r.sizeKrw ?? 0;
    if (r.sizeKrw != null) sizedCount++;
    if (r.stage === 'CLOSED' && !r.sizeIsTarget) closedSumKrw += size; else targetSumKrw += size;

    const w = mondayOf(r.date);
    const wk = weekMap.get(w) ?? { closed: 0, pipeline: 0, count: 0 };
    wk.count++;
    if (r.stage === 'CLOSED' && !r.sizeIsTarget) wk.closed += size; else wk.pipeline += size;
    weekMap.set(w, wk);

    // 공동 GP면 금액은 나눠 담는다(한 펀드가 두 번 세어지지 않게).
    for (const g of r.gps) {
      const e = gpMap.get(g) ?? { count: 0, sumKrw: 0 };
      e.count++; e.sumKrw += size / Math.max(1, r.gps.length);
      gpMap.set(g, e);
    }
    const seen = new Set<string>();
    for (const l of r.lps) {
      const g = lpGroup(l);
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const e = lpMap.get(g.id) ?? { label: g.label, funds: 0 };
      e.funds++; lpMap.set(g.id, e);
    }
    for (const s of new Set(r.sectors.map(normSector))) secMap.set(s, (secMap.get(s) ?? 0) + 1);
  }

  // 빈 주도 0으로 채워 그래프가 끊기지 않게.
  const weekly: FundStats['weekly'] = [];
  const end = mondayOf(kstDay(new Date()));
  for (let d = new Date(`${mondayOf(kstDay(since))}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const k = d.toISOString().slice(0, 10);
    weekly.push({ week: k, ...(weekMap.get(k) ?? { closed: 0, pipeline: 0, count: 0 }) });
  }

  return {
    days,
    total: rows.length,
    byStage,
    closedSumKrw,
    targetSumKrw,
    sizedCount,
    weekly,
    topGps: [...gpMap].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count || b.sumKrw - a.sumKrw).slice(0, 8),
    lpMix: [...lpMap].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.funds - a.funds),
    topSectors: [...secMap].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    rows,
  };
}
