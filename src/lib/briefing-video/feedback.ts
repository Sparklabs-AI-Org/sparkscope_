/**
 * 브리핑 기사별 임직원 피드백(2026-11-05 은빛) — 👍👎와 👎 사유·의견. 기사 선정을 다듬는 재료이고,
 * 활발히 참여한 사람에게 매주 커피 기프티콘을 주려고 사람별로도 집계한다.
 * DashboardInsight(kind=briefing_feedback)에 한 사람·한 기사당 한 행으로 둔다 — 표를 새로 만들지 않으려고(prisma db push 금지).
 * key는 「방송일|기사|사람」이라 날짜 범위로 읽을 수 있다.
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getRealSessionUser } from '@/lib/authz';
import type { FeedbackVote } from './feedback-reasons';

const KIND = 'briefing_feedback';
const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

export interface Viewer { email: string; name: string | null; department: string | null }

export interface Feedback extends Viewer {
  dateKey: string;
  url: string;
  title: string;
  vote: FeedbackVote;
  reason?: string;
  comment?: string;
  at: string;
}

export const feedbackKey = (dateKey: string, url: string, email: string) => `${dateKey}|${hash(url)}|${hash(email)}`;

/** 메일 토큰이 있으면 그 구독자, 없으면 회사 계정으로 로그인한 사람(/api/briefing/view와 같은 기준). 모르면 null. */
export async function viewerIdentity(token?: string): Promise<Viewer | null> {
  const select = { email: true, name: true, department: true } as const;
  if (token) {
    const sub = await prisma.digestSubscriber.findUnique({ where: { token }, select }).catch(() => null);
    if (sub) return sub;
  }
  const me = await getRealSessionUser().catch(() => null);
  if (!me?.email) return null;
  const email = me.email.toLowerCase();
  const sub = await prisma.digestSubscriber.findUnique({ where: { email }, select }).catch(() => null);
  return sub ?? { email, name: null, department: null };
}

const parse = (rows: { value: string }[]): Feedback[] => rows.flatMap(r => {
  try { return [JSON.parse(r.value) as Feedback]; } catch { return []; }
});

/** 이 사람이 그날 남긴 피드백(기사 url → 피드백). */
export async function myFeedback(dateKey: string, email: string): Promise<Map<string, Feedback>> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { startsWith: `${dateKey}|`, endsWith: `|${hash(email.toLowerCase())}` } },
    select: { value: true },
  });
  return new Map(parse(rows).map(f => [f.url, f]));
}

export async function saveFeedback(f: Feedback): Promise<void> {
  const key = feedbackKey(f.dateKey, f.url, f.email);
  const value = JSON.stringify(f);
  await prisma.dashboardInsight.upsert({ where: { kind_key: { kind: KIND, key } }, create: { kind: KIND, key, value }, update: { value } });
}

export async function clearFeedback(dateKey: string, url: string, email: string): Promise<void> {
  await prisma.dashboardInsight.deleteMany({ where: { kind: KIND, key: feedbackKey(dateKey, url, email) } });
}

export interface FeedbackPerson extends Viewer { articles: number; ups: number; downs: number; reasons: number; comments: number }
export interface FeedbackArticle {
  dateKey: string; url: string; title: string; ups: number; downs: number;
  reasons: { reason: string; count: number }[];
  comments: string[];
}

/** 기간(방송일 기준)의 사람별·기사별 집계. 사람은 의견 → 사유 → 참여 기사 수 순으로 세운다(버튼만 많이 누른 사람보다 의견을 앞에). */
export async function feedbackStats(from: string, to: string): Promise<{ people: FeedbackPerson[]; articles: FeedbackArticle[] }> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { gte: `${from}|`, lt: `${to}|~` } },
    select: { value: true },
  });
  const people = new Map<string, FeedbackPerson>();
  const articles = new Map<string, FeedbackArticle & { byReason: Map<string, number> }>();
  for (const f of parse(rows)) {
    const p = people.get(f.email) ?? { email: f.email, name: f.name, department: f.department, articles: 0, ups: 0, downs: 0, reasons: 0, comments: 0 };
    p.articles++;
    if (f.vote === 'up') p.ups++; else p.downs++;
    if (f.reason) p.reasons++;
    if (f.comment) p.comments++;
    people.set(f.email, p);

    const k = `${f.dateKey}|${f.url}`;
    const a = articles.get(k) ?? { dateKey: f.dateKey, url: f.url, title: f.title, ups: 0, downs: 0, reasons: [], comments: [] as string[], byReason: new Map<string, number>() };
    if (f.vote === 'up') a.ups++; else a.downs++;
    if (f.reason) a.byReason.set(f.reason, (a.byReason.get(f.reason) ?? 0) + 1);
    if (f.comment) a.comments.push(f.comment);
    articles.set(k, a);
  }
  return {
    people: [...people.values()].sort((x, y) => y.comments - x.comments || y.reasons - x.reasons || y.articles - x.articles),
    articles: [...articles.values()]
      .map(({ byReason, ...a }) => ({ ...a, reasons: [...byReason].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count) }))
      .sort((x, y) => y.downs - x.downs || y.dateKey.localeCompare(x.dateKey)),
  };
}
