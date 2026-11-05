/**
 * 데일리 브리핑 대본 — 헤드라인 스냅샷(briefing.ts)을 2~3분 분량의 한국어 낭독 대본으로.
 *
 * 인사·마무리는 고정 문구다. AI가 매번 다르게 쓰면 "오늘은 어떤 인사로 시작하나"가 흔들리고,
 * 날짜·요일을 틀릴 수도 있다. AI는 기사별 2~3문장만 쓴다.
 *
 * 사실은 제목·요약에 있는 것만 쓴다 — 음성은 되돌려 확인하기 어려워서, 틀린 숫자 하나가
 * 글보다 더 오래 남는다.
 */
import { sectionOf, type Section } from './sections';
import OpenAI from 'openai';
import type { BriefingHeadline, BriefingSnapshot } from '../sparkscope/briefing';
import { articleExcerpt, cjkTitleMatch } from './article-text';
import { prisma } from '@/lib/prisma';

/**
 * 해외 트렌드 카드의 원문 제목 — 카드 제목은 한국어 번역본이라 일본어·영어 원문 본문과 낱말이 겹치지 않아
 * 맞는 본문도 "다른 기사"로 버렸다(2026-10-26 ITmedia PHP 기사). 본문 찾기·대조는 원문 제목으로 한다.
 */
async function interOriginalTitle(url: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ title: string }[]>`select title from "InterNews" where url = ${url} limit 1`.catch(() => []);
  return rows[0]?.title ?? null;
}

/** 대본을 못 썼을 때 읽을 문장 — 해외 트렌드 카드의 요약 칸은 분류 라벨("AI버티컬 × 연구성과")이라 읽지 않는다. */
function fallbackText(h: BriefingHeadline): string {
  return h.kind === 'inter' ? `${h.title}.` : `${h.title}. ${h.summary}`;
}

const MODEL = 'gpt-4.1';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScriptSegment {
  kind: 'intro' | 'item' | 'outro';
  text: string;
  /** item일 때 스냅샷 헤드라인 순번(0부터) */
  index?: number;
  /** item일 때 화면용 브리핑 헤드라인·글용 한 줄 요약(데일리만 — frame.withHeadline) */
  headline?: string;
  brief?: string;
  points?: { label: string; text: string }[];
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-30" → "9월 30일 수요일" */
export function spokenDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 ${wd}요일`;
}

/** "2026-10-22" → "2026년 10월 22일" */
export function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/**
 * 섹션 전환 멘트 — "첫 번째 소식입니다" 순번 대신, 섹션이 바뀌는 첫 기사에만 붙인다(2026-10-07 소윤, 3분 개편안).
 * 섹션은 헤드라인 라벨로 정한다: 스파크랩 · 국내 포트폴리오 · 해외 포트폴리오(대만·글로벌) · AI · 스타트업계.
 */
// 2026-11-04 우선순위 개편(은빛): 스파크랩 → 국내 포폴 → 알럼나이 → 해외 포폴 → 운영 사업 → 스타트업 업계 동향 → AI.
// 투자·펀드·정책·지원사업·AC·VC 소식은 모두 「스타트업 업계 동향」 한 섹션으로 소개한다.
const SECTION_LEAD: Record<Section, [string, string]> = {
  // [맨 처음일 때, 중간에 바뀔 때]
  S: ['먼저 스파크랩 소식입니다.', '스파크랩 소식입니다.'],
  P: ['먼저 포트폴리오 소식입니다.', '포트폴리오 소식입니다.'],
  E: ['먼저 알럼나이 소식입니다.', '알럼나이 소식입니다.'],
  O: ['먼저 글로벌 포트폴리오 소식입니다.', '글로벌 포트폴리오 소식입니다.'],
  R: ['먼저 스파크랩 운영 사업 소식입니다.', '스파크랩 운영 사업 소식입니다.'],
  A: ['먼저 AI 쪽 소식입니다.', 'AI 쪽 소식입니다.'],
  T: ['먼저 스타트업 업계 동향입니다.', '스타트업 업계 동향입니다.'],
};
/** "~부터 전해드리겠습니다"에 쓰는 이름 */
const SECTION_NAME: Record<Section, string> = {
  S: '스파크랩 소식', P: '포트폴리오 소식', E: '알럼나이 소식', O: '글로벌 포트폴리오 소식', R: '운영 사업 소식',
  A: '해외 AI 트렌드', T: '스타트업 업계 동향',
};
/** 소식이 없으면 안내하는 칸(2026-11-04 은빛: 우선순위 0~4). */
const ANNOUNCED: [Section, string][] = [['S', '스파크랩'], ['P', '국내 포트폴리오'], ['E', '알럼나이'], ['O', '글로벌 포트폴리오'], ['R', '운영 사업']];

/**
 * 오늘 소식 안내 — 인사 바로 뒤에 무엇이 없고 무엇부터 하는지 한 문장으로 밝힌다(2026-11-02 소윤, 11-04 0~4번 칸으로 확대).
 * 다 있으면 안내하지 않는다(평소처럼 "먼저 스파크랩 소식입니다"로 시작).
 */
export function lineupNote(heads: BriefingHeadline[]): string {
  const secs = heads.map(sectionOf);
  const missing = ANNOUNCED.filter(([s]) => !secs.includes(s)).map(([, name]) => name);
  const first = secs[0];
  if (missing.length === 0 || !first) return '';
  return `오늘은 ${missing.join(', ')} 소식이 없어, ${SECTION_NAME[first]}부터 전해드리겠습니다.`;
}
// 스파크랩과 국내 포트폴리오는 이어서 한 덩어리로 듣기 좋아서, 스파크랩 다음 국내 포폴은 "이어서 포트폴리오 소식입니다".

/**
 * 말투·구성 기준 — 2026-10-07 「3분 개편안」(소윤). 9/30 수정본 예시를 대체한다.
 * 요점: 상투적인 마무리("주목할 만합니다") 대신 "그래서 누구에게 무엇이 달라지나", 기사마다 숫자,
 * 기사마다 4단 구조(팩트·숫자 → 맥락 → 우리 시각 → 변수). 10-07 소윤 결정으로 등급 없이 전부 핵심 길이(약 250~330자).
 * 예시는 개편안 샘플에서 사실 확인이 필요한 부분을 뺀 것 — 내용이 아니라 구조를 참고하게 한다.
 */
const STYLE_EXAMPLE = `오픈AI가 새 모델을 공개했는데, 성능은 상위 모델 수준이면서 가격은 기존 모델의 절반입니다. 같은 주 앤트로픽도 더 낮은 가격의 새 모델을 내놨습니다. 두 회사가 같은 시기에 가격을 내렸다는 건 경쟁의 축이 성능에서 가격으로 옮겨가고 있다는 신호입니다. AI를 쓰는 포트폴리오사 입장에선 API 원가가 줄어 마진이 개선될 여지가 생기고, 반대로 모델 위에 기능만 얇게 얹은 서비스는 차별화 압박이 커집니다. 다만 가격 인하가 일시적 프로모션인지, 다른 업체까지 번질지가 변수입니다.`;

const SYSTEM = `당신은 VC 스파크랩의 데일리 브리핑 작가입니다. 청자는 투자심사역과 파트너입니다.
기사마다 소리 내어 읽을 대본을 씁니다. 인사·마무리·섹션 전환 멘트(\"먼저 포트폴리오 소식입니다\" 등)는 따로 붙이니 쓰지 마세요.

[구성] 모든 기사를 같은 깊이로, 기사마다 약 170~220자(2~3문장)로 씁니다(2026-10-16 — 영상은 4~5분 유지, 핵심만).
 ① 팩트+숫자(누가, 무엇을, 얼마에) → ② 맥락(왜 지금인가, 배경·규모) → ③ 우리 시각(포트폴리오사·투자 테제·스타트업 생태계에
 어떤 의미인지, 대상을 구체적으로) → ④ 변수(앞으로 지켜볼 것)
 - 본문 발췌에서 숫자·배경·일정을 최대한 끌어와 채웁니다. 재료가 정말 부족하면 짧아져도 되지만 지어내지는 마세요.

 - 우리 포트폴리오사 이름을 기사에 없는데 끌어와 연결하지 마세요(기사 주인공이 포트폴리오사일 때만 그 이름을 씁니다).
 - 지원사업 공고 순위 정리 글("K-Startup 주간 창업공고 TOP 10", "정부지원사업 TOP 100")은 기사가 아니라 순위표입니다.
   집계 기준(어디서, 어느 주) 한 마디 + 상위 2~3개 공고 이름과 주관 기관(마감일이 있으면 마감일)을 짧게 소개하고 끝냅니다.
   ③ 해석·④ 변수는 쓰지 않습니다. 공고 이름은 괄호·기호를 빼고 말하듯 줄여 읽습니다(2026-10-28 소윤: 위클리 고정 2칸).

[필수]
 - 숫자(금액·지분·가격·비율·기간·규모)는 원문에 있으면 반드시 넣습니다.
 - 날짜는 원문 표현 그대로 씁니다. 원문에 월이 없으면("지난 30일", "6일") 월을 붙이지 말고 그대로 쓰세요 — "지난 30일"을 "6월 30일"로 바꾼 사고가 있었습니다(2026-10-08). 요일·연도도 원문에 있을 때만 씁니다.
 - 제목·요약·본문 발췌에 있는 사실만 씁니다. 숫자·이름·날짜·평가·원인을 지어내지 마세요. 본문 발췌가 없으면 제목·요약 범위 안에서만 씁니다.
 - 해석에는 반드시 "누구에게"를 밝힙니다(예: "포트폴리오사 입장에선 ~", "~라는 점에서 ○○에게 유리합니다").
 - 연관된 기사가 있으면 "앞 소식과 이어서 보면 ~" 식으로 한 문장 연결합니다.

[금지]
 - "주목할 만합니다", "주목됩니다", "의미가 있습니다", "기대됩니다", "~할 전망입니다"로 끝나는 해석 문장
 - 대상 없는 일반론("AI 활용 기회가 확장된다" 등)
 - 홍보성·과장·감탄 표현, 괄호·기호(귀로 듣는 대본)
 - "우리"라는 말 — 포트폴리오사는 "포트폴리오사 ○○"라고 부릅니다.

[톤] 전문적이지만 사람이 말하듯 자연스럽게. "~했습니다"로 모든 문장이 끝나지 않게 종결 표현을 섞습니다.

[표기] 고유명사는 공식 한글 표기(티맥스소프트, 앤트로픽, 오픈AI, 오퍼스). 영문 약어는 처음 나올 때 풀어 씁니다.
제목의 약칭 한자는 풀어서 씁니다(日증시 → 일본 증시, 美中 → 미국과 중국).

아래는 예시입니다(첫 번째 길이가 기준). 내용이 아니라 구조·길이·해석 방식을 참고하세요.
${STYLE_EXAMPLE}

JSON으로만 답하세요: {"items":[{"index":0,"text":"..."}]}`;

// 해외 트렌드 카드의 "연결된 포트폴리오사"(내부 매칭)는 넘기지 않는다 — 영상·페이지는 로그인 없이 열리는데,
// 초안에서 "포트폴리오사 센스톤, 옥타코 등…"처럼 내부 매칭이 대본에 그대로 나왔다(2026-10-07, CLAUDE.md 공개 규칙).
function describe(h: BriefingHeadline, i: number, body: string): string {
  // 해외 트렌드(inter) 카드의 summary는 "AI버티컬 × 연구성과" 같은 분류 라벨이다 — 요약으로 주면 회사 이름으로 읽는다(2026-10-22).
  const sum = h.kind === 'inter' ? `(분류 라벨, 사실 아님·회사 이름 아님) ${h.summary}` : h.summary;
  return `[${h.label}] 제목: ${h.title} / 요약: ${sum} / 출처: ${h.source}${body ? `\n   본문 발췌: ${body}` : ''}`;
}

/**
 * 상투구 검사 — 금지 규칙을 줘도 "의미가 있습니다", "주목할 필요가 있습니다"가 남았다(2026-10-07 초안).
 * 걸린 기사만 한 번 더 고쳐 쓰게 한다. 실패하면 원래 문장 그대로.
 */
const CLICHE = /(주목할 만합니다|주목됩니다|주목할 필요가 있습니다|의미가 있습니다|의미가 큽니다|기대됩니다|전망입니다|참고할 만합니다|시사점을 줍니다)/;
async function rewriteCliches(byIndex: Map<number, string>, heads: BriefingHeadline[]): Promise<void> {
  const bad = [...byIndex.entries()].filter(([, t]) => CLICHE.test(t));
  if (bad.length === 0) return;
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '브리핑 대본에서 상투적인 해석 문장("주목할 만합니다", "의미가 있습니다", "기대됩니다", "~할 전망입니다", "참고할 만합니다" 등)만 고칩니다. 그 문장을 "누구에게 무엇이 달라지는지"(예: "포트폴리오사 입장에선 ~", "다만 ~가 변수입니다")로 바꾸고, 나머지 문장·사실·숫자는 그대로 둡니다. 새 사실을 만들지 마세요. JSON으로만: {"items":[{"index":0,"text":"..."}]}' },
        { role: 'user', content: bad.map(([i, t]) => `${i}. ${t}`).join('\n') },
      ],
    });
    const fixed = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').items ?? []) as { index: number; text: string }[];
    // 모델이 준 번호를 믿지 않는다 — 고쳐 쓴 문장이 그 번호의 기사 이야기일 때만 적용한다.
    // 2026-10-13 사고: 번호가 한 칸 어긋난 고쳐 쓰기가 다른 기사 대본을 덮어 써서 밀림·중복이 생겼다.
    for (const f of fixed) {
      const h = heads[f.index];
      if (byIndex.has(f.index) && h && f.text?.trim() && aboutHeadline(f.text, h)) byIndex.set(f.index, f.text.trim());
    }
  } catch (e) {
    console.warn('[script] 상투구 고쳐 쓰기 실패(원문 유지):', e);
  }
}

/**
 * 대본(또는 원문 본문)이 그 헤드라인 이야기인가.
 * 2026-10-13 사고: 제목 낱말 하나가 전체 글에 우연히 들어 있다는 이유로 다른 기사 대본이 통과했다.
 * 그래서 앞부분(150자)에 제목의 낱말 중 하나가 **반드시** 나와야 한다.
 * 제목 앞쪽 낱말만 보면 "부산영화제·무대서·소개된"처럼 일반 낱말뿐인 제목에서 정상 본문까지 버린다
 * (2026-10-13 비마이프렌즈 — 원문이 맞는데 제목만 읽는 대본이 됐다). 그래서 제목 전체 낱말을 본다.
 */
export function aboutHeadline(text: string, h: BriefingHeadline, window = 150): boolean {
  const cjk = cjkTitleMatch(text.slice(0, Math.max(window, 600)), h.title);
  if (cjk !== null) return cjk;
  const words = h.title.replace(/\[[^\]]*\]/g, ' ').replace(/[^0-9a-zA-Z가-힣\s]/g, ' ').split(/\s+/)
    .filter(w => (/[가-힣]/.test(w) ? w.length >= 2 : w.length >= 3));
  if (words.length === 0) return true;
  const stem = (w: string) => w.replace(/(은|는|이|가|을|를|의|에|와|과|로|도)$/, '');
  // 낱말 하나만 맞으면 통과하던 것을 고쳤다(2026-10-20: "성과·고객" 같은 일반 낱말 하나 때문에
  // 엔비디아 내용을 쓴 대본이 스파크클로 기사 칸에 통과했다). 고유 낱말이 둘 이상 맞아야 한다.
  const head = text.slice(0, window).toLowerCase();
  const hits = words.filter(w => head.includes(stem(w).toLowerCase())).length;
  if (hits >= Math.min(2, words.length)) return true;
  // 제목 맨 앞 고유 낱말(주어 — 보통 회사명, 3자 이상)이 있으면 하나로도 통과. 사실만 쓰는 대본은 "해법 나오나·주목" 같은
  // 제목 수사를 쓰지 않아 회사명 하나만 겹친다(2026-10-26 위클리 루센트블록이 제목만 읽힘). 일반 낱말 하나로 다른 기사가
  // 통과하던 10-20 사고("성과·고객")는 그 낱말이 제목 맨 앞 주어가 아니라 여전히 막힌다.
  const subject = stem(words[0]);
  return subject.length >= 3 && head.includes(subject.toLowerCase());
}

/** 인사·마무리 문구 — 데일리가 기본, 뉴스데스크(newsdesk.ts)는 자기 문구를 넘긴다. */
export interface ScriptFrame {
  intro?: string;
  outro?: string;
  /** true면 기사마다 화면용 헤드라인(30자 안팎)과 글용 한 줄 요약도 함께 쓴다(데일리) */
  withHeadline?: boolean;
  /** 기사당 글자 수 범위(withHeadline일 때) — 벗어나면 한 번 다시 쓴다. 없으면 데일리 기준 */
  chars?: { min: number; max: number; target: string };
  /** 기사별 길이 지시를 바꿀 때(위클리 — 8개 전체 3분 30초~4분, 최대 5분, 2026-10-08 소윤) */
  length?: string;
}

const HEADLINE_ASK = `
[추가로 쓸 것] 더벨 데일리 브리핑 형식으로 정리합니다. JSON을 {"items":[{"index":0,"text":"대본","headline":"...","lead":"...","points":[{"label":"...","text":"..."}]}]} 형태로 답하세요.
 - headline: 기사 제목처럼 쉼표로 끊는 짧은 헤드라인, 20~32자(예: "롯데손보, 신한EZ손보 합병 전망, 규모의 경제로", "넥센서, 300억 프리IPO 착수"). 핵심 숫자가 있으면 넣고, 따옴표·마침표는 쓰지 않습니다. 기사에 없는 사실은 쓰지 않습니다.
 - lead: 기사 핵심을 담은 한 문장 요약(60~100자). "~했다", "~이다"로 끝나는 평서문, 주체·사건·핵심 숫자를 담습니다.
 - points: 사실 2~3개. label은 "투자 규모", "추진 배경", "향후 일정"처럼 4~10자 명사구, text는 한 문장(40~90자) 사실로 숫자·일정·상대방을 구체적으로 씁니다. 원문에 있는 것만, 해석·전망은 쓰지 않습니다.`;

/** 헤드라인 정리 — 따옴표·마침표 제거, 너무 짧거나 길면 버린다(화면은 원문 제목으로 대신한다). */
function cleanLine(t: string | undefined, min: number, max: number): string | undefined {
  const v = (t ?? '').replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, '').replace(/\s+/g, ' ');
  return v.length >= min && v.length <= max ? v : undefined;
}

/** 합니다체 → 평서형(~했다). 더벨 데일리 브리핑의 글 형식에 맞춘다 — 헤드라인 아래 리드·사실 문장용. */
export function toPlainStyle(text: string): string {
  return text
    .replace(/아닙니다/g, '아니다')
    .replace(/입니다/g, '이다')
    .replace(/습니다/g, '다')
    .replace(/([가-힣])니다/g, (m, ch: string) => {
      const code = ch.charCodeAt(0) - 0xac00;
      return code % 28 === 17 ? `${String.fromCharCode(0xac00 + code - 17 + 4)}다` : m; // 합→한, 됩→된
    });
}

/**
 * 원문 대조 — 대본·헤드라인·리드·사실 문장에 원문(제목·요약·본문 발췌)에 없는 이름·숫자·날짜·사실이 있으면 찾아낸다.
 * 2026-10-22 사고: "영국·미국 연구진" 기사 헤드라인에 없는 회사("AI버티컬")가 들어갔다. 실패하면 검수를 건너뛴다(발행을 막지 않는다).
 */
async function findUngrounded(h: BriefingHeadline, body: string, narration: string, extra?: { headline?: string; brief?: string; points?: { label: string; text: string }[] }): Promise<string[]> {
  try {
    const written = [narration, extra?.headline, extra?.brief, ...(extra?.points ?? []).map(p => `${p.label}: ${p.text}`)].filter(Boolean).join('\n');
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '원문 대조 검수자입니다. [작성물]에 [원문]에 없는 이름(회사·기관·인물·제품)이나 숫자·날짜·사실이 있으면 모두 찾아내세요. [원문]의 제목·요약·출처·본문 발췌에 나오는 모든 표현은 원문에 있는 것입니다(출처 매체 이름 포함). 표현을 바꿔 쓴 것, 원문에서 직접 알 수 있는 것도 허용합니다. 확실히 근거가 없는 고유명사·숫자·날짜만 지적하고, 의심만 되면 지적하지 마세요. 다만 "분류 라벨"로 표시된 말은 사실이 아니므로 그것을 회사나 기관 이름처럼 쓴 것은 지적하세요. JSON으로만: {"bad":["문제 표현", ...]} — 문제가 없으면 빈 배열.' },
        { role: 'user', content: `[원문]\n제목: ${h.title}\n요약: ${h.kind === 'inter' ? `(분류 라벨, 사실 아님·회사 이름 아님) ${h.summary}` : h.summary}\n출처: ${h.source}\n${body ? `본문 발췌: ${body}` : ''}\n\n[작성물]\n${written}` },
      ],
    });
    const bad = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').bad ?? []) as unknown[];
    // 원문에 글자 그대로 있는 표현은 검수 모델이 잘못 지적한 것이다(2026-10-22: 제목에 있는 "Flutterwave"를 지적).
    const norm = (t: string) => t.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
    const src = norm(`${h.title} ${h.summary} ${h.source} ${body}`);
    return bad.map(String).filter(b => b && !src.includes(norm(b))).slice(0, 6);
  } catch (e) {
    console.warn('[script] 원문 대조 실패(건너뜀):', e);
    return [];
  }
}

/**
 * 데일리 길이·문체 지시 — 기사당 한 문장(2026-11-02 대표님 미팅·11-04 은빛 결정: "지난주 것은 너무 길다, 한두 줄").
 * 아주 중요한 기사만 두 문장까지. 영상 전체는 5분 이내(build.ts MAX_VIDEO_SECONDS).
 * 더벨 데일리 브리핑 최근 10건 분석: 누가·무엇을·얼마를 먼저 말하고, 맥락은 한 구절, 상투적 전망 문장 없음.
 */
/** 데일리 기사당 글자 수 — 이보다 짧으면(본문 재료가 있을 때) 길게, 길면 짧게 한 번 더 쓴다. 두 문장(최대 140자)까지 허용. */
const DAILY_CHARS = { min: 45, max: 140, target: '60~90' };

export const DAILY_LENGTH = `위의 구성·길이·해석 지시는 모두 무시하고, 더벨 데일리 브리핑처럼 씁니다. 기사마다 한 문장, 약 60~90자(읽는 데 약 8~10초)가 원칙입니다.
 한 문장에 누가·무엇을·얼마(금액·지분·규모 같은 숫자)를 담는 핵심 사실을 말합니다.
 두 번째 문장은 기사가 아주 중요해서(스파크랩·포트폴리오사의 투자 유치·엑싯·대형 계약, 업계 판도를 바꾸는 발표) 꼭 필요한 일정·조건이 빠지면 안 될 때만 씁니다. 그때도 두 문장, 140자를 넘기지 않습니다.
 기사가 밝힌 목적이나 업계 관측("~를 위한 방안으로 관측됩니다")은 써도 되지만, 없는 사실을 지어내지는 않습니다.
 우리 쪽 해석은 쓰지 않습니다 — "포트폴리오사 입장에선", "의미가 있다", "시사한다", "지켜볼 변수" 같은 문장은 넣지 마세요.
 예시: 신한금융이 손해보험 부문 규모를 키우기 위해 롯데손해보험과 신한EZ손해보험의 합병을 추진합니다.`;

/**
 * 우리 포트폴리오사 기사가 "에이티넘인베스트먼트 투자사 올거나이즈가…"처럼 다른 투자사 소속으로 시작하지 않게 한다(2026-11-05 은빛).
 * 지시로 막고, AI가 어겨도 앞머리를 지운다. 투자 유치 기사의 "○○벤처스가 투자했다"는 사실 설명이라 건드리지 않는다.
 */
const OUR_COMPANY_RULE = '\n[표현] 이 회사는 스파크랩 포트폴리오사입니다. 대본·헤드라인·리드 어디에도 "○○인베스트먼트 투자사", "○○ 포트폴리오"처럼 다른 투자사 소속으로 소개하지 말고 회사 이름으로 바로 시작하세요.';
const OTHER_INVESTOR_PREFIX = /(?:^|(?<=\s))(?!스파크랩)\S*(?:인베스트먼트|인베|벤처스|벤처투자|벤처파트너스|파트너스|캐피탈|창업투자|자산운용)\S*\s+(?:투자사|투자기업|투자 기업|피투자사|피투자기업|포트폴리오사|포트폴리오)\s+/g;
export const dropOtherInvestor = (text: string) => text.replace(OTHER_INVESTOR_PREFIX, '');
const isOurCompany = (h: BriefingHeadline) => ['P', 'E', 'O'].includes(sectionOf(h));

/** 위클리는 2026-11-04 폐지 — 지난 위클리 스냅샷을 다시 만들 때(newsdesk.ts)만 쓰인다. */
export const WEEKLY_LENGTH = DAILY_LENGTH;

export async function writeBriefingScript(snapshot: BriefingSnapshot, frame?: ScriptFrame): Promise<ScriptSegment[]> {
  const heads = snapshot.headlines;
  // 숫자·맥락 재료 — 원문 본문 앞부분(article-text.ts). 못 읽으면 제목·요약만.
  // 본문이 제목과 다른 기사이면(원문 주소가 엉뚱한 페이지로 풀린 경우) 버리고 제목·요약만 쓴다.
  const bodies = await Promise.all(heads.map(async h => {
    const matchTitle = (h.kind === 'inter' && (await interOriginalTitle(h.url))) || h.title;
    const b = await articleExcerpt(h.url, matchTitle);
    // 본문은 앞에 기자명·날짜·사진 설명이 붙는 일이 많아 150자 안에서만 보면 맞는 본문도 버린다 — 앞 600자에서 본다.
    if (b && !aboutHeadline(b, { ...h, title: matchTitle }, 600)) {
      console.warn(`[script] 원문이 제목과 다름 — 본문 버림: ${h.title.slice(0, 30)}`);
      return '';
    }
    return b;
  }));
  // 기사 하나씩 따로 쓴다 — 한 번에 8개를 쓰게 했더니 순번이 밀려 4번 화면에 8번 기사 대본이 붙었다(2026-10-07 초안).
  // 다른 기사 목록은 주지 않는다 — 번호 붙은 목록을 같이 줬더니 "4. 원소프트다임…"처럼 엉뚱한 기사를 썼다(10-08 방송 사고).
  // 쓴 대본에 그 기사의 핵심 낱말이 없으면 한 번 더 쓰고, 그래도 아니면 제목·요약으로 대신한다.
  const extras = new Map<number, { headline?: string; brief?: string; points?: { label: string; text: string }[] }>();
  const writeOne = async (h: BriefingHeadline, i: number, feedback = ''): Promise<string> => {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `이 기사 하나만 씁니다. 다른 기사 내용을 섞지 마세요.${frame?.length ? `\n[길이] ${frame.length}` : ''}${frame?.withHeadline ? HEADLINE_ASK : ''}${isOurCompany(h) ? OUR_COMPANY_RULE : ''}${feedback}\n${describe(h, i, bodies[i])}` },
      ],
    });
    type Item = { text: string; headline?: string; lead?: string; brief?: string; points?: { label?: string; text?: string }[] };
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as Item & { items?: Item[] };
    const first = parsed.items?.[0] ?? parsed;
    const points = (first.points ?? [])
      .map(pt => ({ label: cleanLine(pt.label, 2, 14) ?? '', text: toPlainStyle(cleanLine(pt.text, 10, 130) ?? '') }))
      .filter(pt => pt.label && pt.text)
      .slice(0, 3);
    const clean = (t: string) => (isOurCompany(h) ? dropOtherInvestor(t) : t);
    const headline = cleanLine(first.headline, 6, 48);
    extras.set(i, {
      headline: headline && clean(headline),
      brief: clean(toPlainStyle(cleanLine(first.lead ?? first.brief, 15, 140) ?? '')) || undefined,
      points: points.length >= 1 ? points.map(pt => ({ ...pt, text: clean(pt.text) })) : undefined,
    });
    return clean((first.text ?? '').trim().replace(/^\s*\d+\s*[.)]\s*/, ''));
  };
  const texts = await Promise.all(heads.map(async (h, i) => {
    let feedback = '';
    const range = frame?.chars ?? DAILY_CHARS;
    // 길이만 어긋난 첫 대본 — 다시 쓴 것이 실패하면 이걸 쓴다.
    let firstGood: { text: string; extra?: ReturnType<typeof extras.get> } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const t = await writeOne(h, i, feedback);
        if (t && aboutHeadline(t, h)) {
          if (!frame?.withHeadline) return t;
          // 데일리는 헤드라인·리드·사실까지 원문과 대조한다 — 없는 이름·숫자가 있으면 한 번 더 쓴다.
          const bad = await findUngrounded(h, bodies[i], t, extras.get(i));
          // 글자 수가 범위를 벗어나면 한 번 더 쓴다 — 지시를 자주 어겨 영상 길이가 목표에서 벗어났다(2026-10-22·23).
          // 짧을 때는 본문 재료가 있을 때만 늘린다(재료 없이 늘리면 지어낸다).
          if (bad.length === 0 && attempt === 0 && ((t.length < range.min && bodies[i]) || t.length > range.max)) {
            const short = t.length < range.min;
            console.warn(`[script] ${i}번 대본이 ${t.length}자로 ${short ? '짧음' : '김'} — ${range.target}자로 다시 씀`);
            firstGood = { text: t, extra: extras.get(i) };
            feedback = short
              ? `\n[수정 요청] 직전 대본이 ${t.length}자로 너무 짧았습니다. 본문 발췌에 있는 일정·규모·상대방·목적을 더 담아 ${range.target}자로 다시 쓰세요. 없는 사실은 쓰지 마세요.`
              : `\n[수정 요청] 직전 대본이 ${t.length}자로 너무 깁니다. 핵심 사실만 남겨 ${range.target}자로 줄여 다시 쓰세요.`;
            continue;
          }
          if (bad.length === 0) return t;
          console.warn(`[script] ${i}번 원문에 없는 표현 — 다시 씀(${attempt + 1}/2): ${bad.join(' / ').slice(0, 120)}`);
          feedback = `\n[수정 요청] 직전 작성물에 원문에 없는 표현이 있었습니다: ${bad.join(', ')}. 이런 이름·숫자·사실은 쓰지 말고, 이름을 모르면 원문 표현(예: "연구진")을 그대로 쓰세요.`;
          continue;
        }
        console.warn(`[script] ${i}번 대본이 제목과 안 맞음 — 다시 씀(${attempt + 1}/2)`);
      } catch (e) {
        console.warn(`[script] ${i}번 대본 실패:`, e);
      }
    }
    if (firstGood) { // 길이를 맞춰 다시 쓴 것이 실패하면 처음의 정상 대본을 쓴다
      if (firstGood.extra) extras.set(i, firstGood.extra);
      return firstGood.text;
    }
    extras.delete(i); // 끝내 못 맞춘 칸은 헤드라인·요약을 쓰지 않고 원문 제목·요약으로 대신한다
    return '';
  }));
  const byIndex = new Map(texts.map((t, i) => [i, t] as [number, string]).filter(([, t]) => t));
  if (!frame?.withHeadline) await rewriteCliches(byIndex, heads); // 데일리는 해석 없이 사실만 — 상투구를 "누구에게" 해석으로 고쳐 쓰지 않는다

  const note = lineupNote(heads);
  // 인사 없이 바로 본론(2026-11-05 은빛) — 소식 없음 안내가 있을 때만 맨 앞에 말한다.
  const intro = [frame?.intro, note].filter(Boolean).join(' ');
  const segments: ScriptSegment[] = intro ? [{ kind: 'intro', text: intro }] : [];
  // 안내 문장이 이미 "○○부터 전해드리겠습니다"라고 했으면 첫 섹션의 "먼저 ○○ 소식입니다"는 붙이지 않는다.
  let prev: Section | null = note && heads[0] ? sectionOf(heads[0]) : null;
  const usedStarts = new Set<string>();
  heads.forEach((h, i) => {
    // AI가 빠뜨린 항목은 요약으로라도 채운다 — 화면엔 있는데 말이 없는 슬라이드가 생기지 않게.
    const fallback = isOurCompany(h) ? dropOtherInvestor(fallbackText(h)) : fallbackText(h);
    let body = byIndex.get(i) || fallback;
    // 같은 문장으로 시작하는 대본이 두 칸에 들어가면 뒤 칸은 제목·요약으로 대신한다(2026-10-13 대조에서 발견).
    if (usedStarts.has(body.slice(0, 80))) body = fallback;
    usedStarts.add(body.slice(0, 80));
    const sec = sectionOf(h);
    const lead = sec === prev ? '' : prev === 'S' && sec === 'P' ? '이어서 포트폴리오 소식입니다.' : SECTION_LEAD[sec][prev ? 1 : 0];
    prev = sec;
    // 화면 헤드라인을 못 받은 칸은 원문 제목이 나간다 — 그때도 다른 투자사 앞머리는 뗀다.
    const title = isOurCompany(h) ? dropOtherInvestor(h.title) : h.title;
    segments.push({
      kind: 'item', index: i, text: lead ? `${lead} ${body}` : body,
      ...(frame?.withHeadline ? { ...(title !== h.title ? { headline: title } : {}), ...extras.get(i) } : {}),
    });
  });
  segments.push({
    kind: 'outro',
    text: frame?.outro ?? '오늘 준비한 브리핑은 여기까지입니다. 더 자세한 내용은 스파크스코프 대시보드에서 확인해 주세요!',
  });
  return segments;
}

/**
 * 영상을 만들기 전 최종 대조 — 화면 제목과 말이 같은 기사를 가리키는지, 같은 기사가 두 번 나가지 않는지 본다.
 * 어긋나는 칸이 하나라도 있으면 문제 목록을 돌려준다(build.ts가 발행을 멈춘다).
 */
export function checkAlignment(segments: ScriptSegment[], headlines: BriefingHeadline[]): string[] {
  const problems: string[] = [];
  const seen = new Map<number, number>();
  const texts = new Map<string, number>();
  for (const s of segments) {
    if (s.kind !== 'item') continue;
    const i = s.index!;
    seen.set(i, (seen.get(i) ?? 0) + 1);
    const h = headlines[i];
    if (!h || !aboutHeadline(s.text, h)) problems.push(`${i}번 칸 대본이 제목과 다른 기사: ${h?.title.slice(0, 30) ?? '(없음)'}`);
    const key = s.text.slice(0, 80);
    if (texts.has(key)) problems.push(`${i}번 칸 대본이 ${texts.get(key)}번 칸과 같은 문장으로 시작`);
    else texts.set(key, i);
  }
  headlines.forEach((h, i) => {
    if ((seen.get(i) ?? 0) !== 1) problems.push(`${i}번 기사(${h.title.slice(0, 30)})의 대본이 ${seen.get(i) ?? 0}개`);
  });
  return problems;
}
