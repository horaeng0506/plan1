/**
 * fire-and-forget mutation 핸들러용 공통 .catch 래퍼.
 *
 * void promise() 패턴은 rejection 을 unhandled 로 만들어 toast/UI 피드백 누락 유발.
 * Stage 3e logic-critic Medium #3 대응. Stage 4 (4채널 디자인) 에서 toast 컴포넌트 도입 시
 * console.error 분기를 toast 호출로 교체.
 */
export function runMutation<T>(
  promise: Promise<T>,
  context?: string
): void {
  promise.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[mutation${context ? ` · ${context}` : ''}]`, msg);
    // TODO(Stage 4): toast.error(msg)
  });
}
