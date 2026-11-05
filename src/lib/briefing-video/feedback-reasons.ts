/** 👎 사유 — 브리핑 페이지 버튼과 저장 API가 같이 쓴다. 나중에 기사 선정 AI에 넘길 기준이라 기사 선정 관점으로 나눴다. */
export const FEEDBACK_REASONS = [
  '왜 그런지는 모르겠는데 별로임',
  '우리 회사·업계와 관련이 적어요',
  '지난 호에 이미 나왔던 소식',
  '너무 사소한 뉴스',
  '내용이 틀렸거나 기사와 달라요',
  '기타',
] as const;

export type FeedbackVote = 'up' | 'down';
