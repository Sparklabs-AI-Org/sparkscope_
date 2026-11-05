/**
 * 브리핑 섹션과 영상 색(2026-11-05 은빛) — 스파크랩 로고 불꽃의 네 색을 눈에 띄는 순서(핑크 → 주황 → 초록 → 파랑)로 쓴다.
 * 섹션이 일곱 개라 주황·초록·파랑은 밝은 톤을 하나씩 더해, 위 칸일수록 강한 색이 가게 했다.
 */
import type { BriefingHeadline } from '../sparkscope/briefing';

export type Section = 'S' | 'P' | 'E' | 'O' | 'R' | 'A' | 'T';

export function sectionOf(h: Pick<BriefingHeadline, 'label'> & { kind?: BriefingHeadline['kind'] }): Section {
  if (/운영 사업/.test(h.label)) return 'R';
  if (/알럼나이/.test(h.label)) return 'E';
  if (/스파크랩/.test(h.label)) return 'S';
  if (/포트폴리오사 · (대만|글로벌)/.test(h.label)) return 'O';
  if (/포트폴리오/.test(h.label)) return 'P';
  if (/정책|지원사업|투자·펀드|업계 동향/.test(h.label)) return 'T';
  if (/AI|트렌드|해외/.test(h.label) || h.kind === 'trend' || h.kind === 'inter') return 'A';
  return 'T';
}

/** 섹션 색 — fill은 띠 색, ink는 그 위 글자색 */
export const SECTION_COLOR: Record<Section, { fill: string; ink: string }> = {
  S: { fill: '#F80054', ink: '#FFFFFF' },
  P: { fill: '#FF6A00', ink: '#FFFFFF' },
  E: { fill: '#FFA64D', ink: '#1A1A1A' },
  O: { fill: '#22BB00', ink: '#FFFFFF' },
  R: { fill: '#86DB73', ink: '#1A1A1A' },
  T: { fill: '#0000BB', ink: '#FFFFFF' },
  A: { fill: '#6F8CFF', ink: '#1A1A1A' },
};
