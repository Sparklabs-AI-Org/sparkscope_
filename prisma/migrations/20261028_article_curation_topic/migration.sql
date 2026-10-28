-- 깡프로·데모데이 큐레이션 기사의 세부 분류(policy-classify.ts) — 정책·지원사업 / 투자·펀드 탭을 이 기준으로 묶는다(2026-10-28).
-- 정책: grant(지원사업 공고) · policy(정책·제도) · ecosystem(창업 생태계·통계)
-- 투자: round(투자 유치) · fund(펀드 결성·출자) · market(시장 동향·분석). 일반 수집 기사는 null.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "curationTopic" TEXT;
