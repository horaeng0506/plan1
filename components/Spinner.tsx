/**
 * Inline SVG spinner — 버튼 안 busy 표시 (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #16).
 *
 * Tailwind animate-spin · currentColor 로 부모 텍스트 색 따라감.
 * RTL 영향 없음 (회전 방향 ltr/rtl 동일).
 */
export function Spinner({size = 14}: {size?: number}) {
  return (
    <svg
      className="inline-block animate-spin"
      style={{width: size, height: size}}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
