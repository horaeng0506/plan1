import {describe, it, expect} from 'vitest';
import {decideFlow, type TaskInput, type CategoryOwner} from './decideFlow';

const cats: CategoryOwner[] = [{id: 'cat-1'}, {id: 'cat-2'}];

describe('decideFlow (Critical C1)', () => {
  it('returns modal/no-category when categoryId is null', () => {
    const task: TaskInput = {categoryId: null, durationMin: 30};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-category'});
  });

  it('returns modal/no-category when categoryId is undefined', () => {
    const task: TaskInput = {categoryId: undefined, durationMin: 30};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-category'});
  });

  it('returns modal/no-category when categoryId is empty string', () => {
    const task: TaskInput = {categoryId: '', durationMin: 30};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-category'});
  });

  it('returns modal/no-duration when durationMin is null', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: null};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-duration'});
  });

  it('returns modal/no-duration when durationMin is undefined', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: undefined};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-duration'});
  });

  it('returns modal/no-duration when durationMin is 0', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: 0};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-duration'});
  });

  it('returns modal/no-duration when durationMin is negative', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: -10};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'no-duration'});
  });

  it('returns modal/stale-category when categoryId not in categories (empty list)', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: 30};
    expect(decideFlow(task, [])).toEqual({type: 'modal', reason: 'stale-category'});
  });

  it('returns modal/stale-category when categoryId not in categories (other ids)', () => {
    const task: TaskInput = {categoryId: 'cat-99', durationMin: 30};
    expect(decideFlow(task, cats)).toEqual({type: 'modal', reason: 'stale-category'});
  });

  it('returns atomic with categoryId and durationMin when valid', () => {
    const task: TaskInput = {categoryId: 'cat-1', durationMin: 45};
    expect(decideFlow(task, cats)).toEqual({type: 'atomic', categoryId: 'cat-1', durationMin: 45});
  });
});