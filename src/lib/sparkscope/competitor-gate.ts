/**
 * AC·VC 업계 동향 판정 — 투자·스타트업 업무에 쓸 기사만 남긴다(2026-10 설문: "일반 증권시장이나 해외 플랫폼
 * 뉴스가 섞여 있다", 강화 방향 문항에서도 기사 선정 정확도가 상위권).
 *
 * 키워드 규칙(relevance.ts isCompetitorNoise)만으로는 다 못 막았다 — 투자사 이름이 다른 뜻으로 쓰인 기사
 * ("스프링캠프" 야구, "액셀 밟자", "라이트스피드" 스타링크), 증권사 리포트·주가, 대기업 실적 기사가 계속 들어왔다.
 * 그래서 수집 단계에서 AC·VC 기사만 AI로 한 번 더 본다. 실패하면 전부 통과(수집을 막지 않는다).
 */
import OpenAI from 'openai';

// mini로 25개 참/거짓을 순서대로 받았더니 순서가 밀려 야구 기사가 통과하고 정상 기사가 빠졌다(시험) — 4.1에 '제외 번호'만 받는다.
const MODEL = 'gpt-4.1';
const BATCH = 20;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `스파크랩(액셀러레이터·VC) 투자팀이 읽는 'AC·VC 업계 동향' 섹션의 기사인지 판정합니다.
각 기사에는 그 기사가 걸린 투자사(키워드)가 붙어 있습니다.

통과(true):
- 그 투자사·AC·VC·창업 지원기관이 주체인 투자 집행, 펀드 결성·출자(LP), 엑시트·인수, 투자사 인사·전략
- 투자사가 투자한 스타트업의 투자 유치 소식(시리즈·금액·투자사가 드러나는 딜)
- 액셀러레이팅·데모데이·배치 선발·창업 지원 프로그램, 스타트업 지원 협약·해외 진출 지원
- 벤처투자·창업 지원 제도처럼 스타트업 투자 업무에 직접 영향을 주는 정책

제외(false):
- 주가·시황·종목 분석·증권사 리포트·배당·ETF·주식병합 같은 증권시장 기사
- 대기업·빅테크·플랫폼의 일반 실적·제품·서비스 기사
- 투자사 이름이 다른 뜻으로 쓰인 기사(야구 '스프링캠프', 자동차 '액셀', '빛의 속도' 등)
- 투자사가 잠깐 언급될 뿐 주제가 보안·통신·외교·통상·정치·일반 산업인 기사

제외할 기사의 번호만 고르세요. 애매하면 통과로 둡니다.
JSON으로만: {"drop":[번호,...]} — 제외할 것이 없으면 {"drop":[]}`;

export interface GateItem { title: string; matchedKeyword: string; body?: string | null }

export async function competitorRelevant(items: GateItem[]): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    try {
      const resp = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: chunk.map((a, n) => `${n}. [투자사: ${a.matchedKeyword}] ${a.title}${a.body ? ` — ${a.body.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n') },
        ],
      });
      const drop = new Set((JSON.parse(resp.choices[0]?.message?.content ?? '{}').drop ?? []) as number[]);
      out.push(...chunk.map((_, n) => !drop.has(n)));
    } catch (e) {
      console.warn('[competitor-gate] 판정 실패 — 이 묶음은 전부 통과:', e);
      out.push(...chunk.map(() => true));
    }
  }
  return out;
}
