import {describe, it, expect} from 'vitest';
import {insertBetweenList} from './insert-between';
import type {Schedule} from './types';

const NS = 60_000;
const T0 = 1_900_000_000_000; // 고정 base epoch (Date.now 비의존)

function sch(id: string, startMin: number, durMin: number, chained = true, status: Schedule['status'] = 'pending'): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-1',
    startAt: T0 + startMin * NS,
    durationMin: durMin,
    timerType: 'countup',
    status,
    chainedToPrev: chained,
    createdAt: T0,
    updatedAt: T0
  };
}

function newA2(durMin: number): Schedule {
  return sch('a2', 0, durMin); // startAt 은 insertBetweenList 가 재계산
}

function startMin(s: Schedule): number {
  return Math.round((s.startAt - T0) / NS);
}

describe('insertBetweenList', () => {
  it('정상: A(0~10) gap10 B(20~30) gap10 C(40~50) 에 A2(15분) 사이 삽입', () => {
    // A:0~10, B:20~30(chained), C:40~50(chained). gap = 10분.
    const list = [sch('A', 0, 10, false), sch('B', 20, 10), sch('C', 40, 10)];
    const result = insertBetweenList(list, newA2(15), 'B');
    expect(result).not.toBeNull();
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    // A2 는 기존 B 자리(20분)에 들어감 + chained
    expect(startMin(byId.a2)).toBe(20);
    expect(byId.a2.chainedToPrev).toBe(true);
    // delta = A2(15) + gap(10) = 25분. B:20→45, C:40→65.
    expect(startMin(byId.B)).toBe(45);
    expect(startMin(byId.C)).toBe(65);
    // A 는 안 밀림
    expect(startMin(byId.A)).toBe(0);
    // A–A2 갭 = A2.start - A.end = 20 - 10 = 10 (보존). A2–B 갭 = 45 - (20+15) = 10 (보존).
    expect(startMin(byId.a2) - (startMin(byId.A) + byId.A.durationMin)).toBe(10);
    expect(startMin(byId.B) - (startMin(byId.a2) + byId.a2.durationMin)).toBe(10);
  });

  it('gap 0 (딱 붙은 일정): A(0~10) B(10~20) 에 A2(5분) 삽입', () => {
    const list = [sch('A', 0, 10, false), sch('B', 10, 10)];
    const result = insertBetweenList(list, newA2(5), 'B');
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    expect(startMin(byId.a2)).toBe(10); // A.end + gap0
    // delta = 5 + 0 = 5. B:10→15.
    expect(startMin(byId.B)).toBe(15);
  });

  it('P1: B 가 첫 일정(앞에 active 없음) → null', () => {
    const list = [sch('B', 20, 10, false), sch('C', 40, 10)];
    expect(insertBetweenList(list, newA2(15), 'B')).toBeNull();
  });

  it('conflictId 없음 → null', () => {
    const list = [sch('A', 0, 10, false), sch('B', 20, 10)];
    expect(insertBetweenList(list, newA2(15), 'ZZZ')).toBeNull();
  });

  it('B 다음이 unchained 면 거기서 밀림 중단 (B 만 밀림)', () => {
    // A:0~10, B:20~30(chained), C:40~50(chained=false) → C 안 밀림.
    const list = [sch('A', 0, 10, false), sch('B', 20, 10), sch('C', 40, 10, false)];
    const result = insertBetweenList(list, newA2(15), 'B');
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    expect(startMin(byId.B)).toBe(45); // 밀림
    expect(startMin(byId.C)).toBe(40); // 안 밀림 (chain 끊김)
  });

  it('P2: B 시작에 2개 겹침(B,X) → 사이 삽입 시 둘 다 함께 밀림', () => {
    // A:0~10, B:20~30(chained), X:20~28(chained) — B·X 같은 시작 20(겹침).
    const list = [sch('A', 0, 10, false), sch('B', 20, 10), sch('X', 20, 8)];
    const result = insertBetweenList(list, newA2(15), 'B');
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    // gap = 20-10 = 10. A2.start = 20. delta = 15+10 = 25.
    expect(startMin(byId.a2)).toBe(20);
    expect(startMin(byId.B)).toBe(45);
    expect(startMin(byId.X)).toBe(45); // 겹친 그룹 함께 밀림
    expect(startMin(byId.A)).toBe(0); // A 안 밀림
  });

  it('P2 변종: 겹친 그룹(B,X) 이후 C 가 chained 면 C 도 밀림', () => {
    // A:0~10, B:20~30(chained), X:20~28(chained), C:40~50(chained)
    const list = [sch('A', 0, 10, false), sch('B', 20, 10), sch('X', 20, 8), sch('C', 40, 10)];
    const result = insertBetweenList(list, newA2(15), 'B');
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    // delta = 25. B:45, X:45, C:40→65.
    expect(startMin(byId.B)).toBe(45);
    expect(startMin(byId.X)).toBe(45);
    expect(startMin(byId.C)).toBe(65);
  });

  it('gap<0 (직전 A 가 conflictStart 넘어 끝나는 비정상 겹침) → null', () => {
    // A:0~30(30분), B:20~30 — A.end(30) > B.start(20), gap = 20-30 = -10 < 0.
    const list = [sch('A', 0, 30, false), sch('B', 20, 10)];
    expect(insertBetweenList(list, newA2(5), 'B')).toBeNull();
  });

  it('done 스케줄은 active 제외 — A 가 done 이면 그 앞을 A 로 인식', () => {
    // done A0(0~10), A(12~22 done? no) — A 직전이 done 이면 active 에서 빠짐.
    // done:0~10, A:20~30(active,chained=false), B:40~50(chained). A2→B 사이.
    const list = [
      sch('DONE', 0, 10, false, 'done'),
      sch('A', 20, 10, false),
      sch('B', 40, 10)
    ];
    const result = insertBetweenList(list, newA2(5), 'B');
    const byId = Object.fromEntries(result!.map(s => [s.id, s]));
    // active 직전 = A(20~30). gap = 40 - 30 = 10. A2.start = 30 + 10 = 40.
    expect(startMin(byId.a2)).toBe(40);
    // delta = 5 + 10 = 15. B:40→55.
    expect(startMin(byId.B)).toBe(55);
    // done 은 안 밀림
    expect(startMin(byId.DONE)).toBe(0);
  });
});
