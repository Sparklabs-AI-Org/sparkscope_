-- 기사 본문 저장 (2026-10-17). 멱등: 여러 번 돌려도 안전.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "bodyText" TEXT;
