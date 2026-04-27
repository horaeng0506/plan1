'use client';

/**
 * 모달 lazy chunk 로드 중 placeholder (Stage 4e).
 *
 * critic ui Major fix: next/dynamic({ssr:false}) 로 lazy 한 모달 3개가 사용자
 * 클릭 후 50-200ms chunk fetch 동안 빈 화면 → 더블클릭 race 유발. Terminal 톤
 * 정합 placeholder (border-line + panel + 헤더 1줄 + 본문 dashed line 3개).
 */

export function ModalSkeleton() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-none border border-line bg-panel p-6">
        <div className="mb-4 h-4 w-32 animate-pulse bg-line" />
        <div className="space-y-3">
          <div className="h-3 w-full border-b border-dashed border-line" />
          <div className="h-3 w-full border-b border-dashed border-line" />
          <div className="h-3 w-2/3 border-b border-dashed border-line" />
        </div>
        <div className="mt-6 text-xs font-mono text-muted">loading...</div>
      </div>
    </div>
  );
}
