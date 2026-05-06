/**
 * Undo store — schedule add/edit/delete 후 5초 안 실행 취소.
 * (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #17 · Q-NEW8 a · Q-NEW9 a)
 *
 * 정책:
 *   - client only state (5초 안만 보존 · 페이지 reload 시 lost · 단순)
 *   - prevState 1건만 (cascade 자연 정합 — 5초 안 다른 mutation 시 1번째 entry 사라짐)
 *   - 새 mutation 시 자동 commit + 다음 entry arm
 *   - revert 시 자체 새 mutation 발생 — clearUndo() 후 호출 (무한 루프 차단)
 *
 * 디자인: useSyncExternalStore 패턴 (toast.ts 와 동일 결).
 *
 * Q-NEW10 b 정합: '지금' 시점은 Date.now() 호출 시각 (mount snapshot 아님).
 */

import {useSyncExternalStore} from 'react';
import type {Schedule} from './domain/types';

export type UndoEntry =
  | {type: 'add'; scheduleId: string; ts: number}
  | {type: 'edit'; scheduleId: string; prev: Schedule; ts: number}
  | {type: 'delete'; schedule: Schedule; ts: number};

const TTL_MS = 5000;

let pending: UndoEntry | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(l => l());
}

export function armUndo(entry: UndoEntry): void {
  if (timer !== null) clearTimeout(timer);
  pending = entry;
  timer = setTimeout(() => {
    pending = null;
    timer = null;
    notify();
  }, TTL_MS);
  notify();
}

export function clearUndo(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  notify();
}

export function subscribeUndo(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getUndoSnapshot(): UndoEntry | null {
  return pending;
}

export function getUndoServerSnapshot(): UndoEntry | null {
  return null;
}

export function useUndo(): UndoEntry | null {
  return useSyncExternalStore(subscribeUndo, getUndoSnapshot, getUndoServerSnapshot);
}

export const UNDO_TTL_MS = TTL_MS;
