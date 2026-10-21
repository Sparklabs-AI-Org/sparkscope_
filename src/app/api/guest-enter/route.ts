// 포트폴리오사 게스트 입장/퇴장 — 로그인 화면의 '포트폴리오사' 버튼.
//   GET /api/guest-enter        → 게스트 쿠키를 심고 대시보드(공개 화면)로
//   GET /api/guest-enter?off=1  → 쿠키를 지우고 로그인 화면으로
// 무엇을 보여 줄지는 authz.ts getSessionUser 가 정한다(PORTFOLIO 등급 = 공개 화면).
import { NextRequest, NextResponse } from 'next/server';
import { GUEST_COOKIE } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('off') === '1') {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete(GUEST_COOKIE);
    return res;
  }
  const res = NextResponse.redirect(new URL('/dashboard', req.url));
  res.cookies.set(GUEST_COOKIE, '1', {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
