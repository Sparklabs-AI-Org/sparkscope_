/**
 * 본문 첫머리 미리보기 — 정책·투자 큐레이션 기사(본문을 매체 페이지에서 통째로 읽어 온다)의 한두 줄.
 * 매체 페이지의 머리 안내문이 본문 앞에 붙어 오는 경우가 있어("가 가 기사의 본문 내용은 이 글자크기로 변경됩니다",
 * "HOME 대체투자 … URL 복사 … AI로 요약"), 그런 표지가 앞쪽에 있으면 마지막 표지 뒤부터 쓴다(2026-10-28).
 */
const JUNK = /글자\s?크기로\s?변경됩니다\.?|URL\s?복사|기사\s?공유|카카오톡|페이스북|트위터|구독하기|AI로\s?요약|close|입력\s?\d{4}[.\-]\d{1,2}[.\-]\d{1,2}(\s?\d{1,2}:\d{2}(:\d{2})?)?|\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?|\[[^\]]{0,80}\]|AI를\s?이용해\s?생성한\s?요약본[^.]*\.\s?(기사\s?본문과\s?함께\s?읽어\s?주세요\.?)?|(그래픽|사진|자료)\s?=\s?[가-힣]{2,4}(\s?기자)?/g;
const HEAD = 400;

export function cleanSnippet(body: string | null | undefined, max = 120): string | null {
  if (!body) return null;
  let text = body.replace(/\s+/g, ' ').trim();
  const head = text.slice(0, HEAD);
  let cut = 0;
  for (const m of head.matchAll(JUNK)) cut = (m.index ?? 0) + m[0].length;
  text = text.slice(cut).replace(/^[\s·|:>\-]+/, '').trim();
  return text.length >= 20 ? text.slice(0, max) : null;
}
