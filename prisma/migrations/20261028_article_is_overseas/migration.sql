-- 깡프로·데모데이 큐레이션 기사 중 해외 소식 표시(policy-classify.ts). 대시보드 투자·펀드 탭은 국내 소식만 보여준다(2026-10-28).
-- 일반 수집 기사는 비워 둔다(null = 판정 안 함).
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "isOverseas" BOOLEAN;
