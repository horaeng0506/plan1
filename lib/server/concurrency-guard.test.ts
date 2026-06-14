import {describe, it, expect} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import {
  buildConcurrencyGuardSql,
  isConcurrencyConflict,
  CONCURRENCY_SQLSTATE
} from './concurrency-guard';

const dialect = new PgDialect();
function render(sqlObj: ReturnType<typeof buildConcurrencyGuardSql>) {
  return dialect.sqlToQuery(sqlObj);
}

describe('buildConcurrencyGuardSql', () => {
  it('empty snapshot → count=0 guard via 1/0, no IN clause, no param coercion', () => {
    const q = render(buildConcurrencyGuardSql('user-1', []));
    expect(q.sql.toLowerCase()).toContain('case when');
    expect(q.sql.toLowerCase()).toContain('count(*)');
    expect(q.sql.replace(/\s+/g, ' ').toLowerCase()).toContain('1 / (case'); // 1/(CASE..) divisor
    expect(q.sql.toUpperCase()).not.toContain(' IN (');
    // No '::int' param cast (the bind-time coercion bug we removed).
    expect(q.sql.toLowerCase()).not.toContain('::int');
    // params: [userId] only (sentinel param removed).
    expect(q.params).toContain('user-1');
    expect(q.params).toHaveLength(1);
  });

  it('non-empty snapshot → row-value IN clause + cardinality compares', () => {
    const q = render(
      buildConcurrencyGuardSql('user-1', [
        {id: 'sch-a', updatedAt: 1000},
        {id: 'sch-b', updatedAt: 2000}
      ])
    );
    expect(q.sql.toUpperCase()).toContain(' IN (');
    expect(q.sql.toLowerCase()).toContain('count(*)');
    expect(q.sql.toLowerCase()).not.toContain('::int');
    // userId bound twice (total + matched subqueries)
    expect(q.params.filter(p => p === 'user-1')).toHaveLength(2);
    // snapshot ids present
    expect(q.params).toContain('sch-a');
    expect(q.params).toContain('sch-b');
    // updatedAt bound as Date params (timestamptz)
    const dates = q.params.filter(p => p instanceof Date) as Date[];
    expect(dates.map(d => d.getTime()).sort()).toEqual([1000, 2000]);
    // cardinality n=2 bound (appears for total and matched compares)
    expect(q.params.filter(p => p === 2)).toHaveLength(2);
  });

  it('single-row snapshot renders one tuple', () => {
    const q = render(buildConcurrencyGuardSql('u', [{id: 'x', updatedAt: 42}]));
    expect(q.sql.toUpperCase()).toContain(' IN (');
    expect(q.params).toContain('x');
    expect((q.params.find(p => p instanceof Date) as Date).getTime()).toBe(42);
  });
});

describe('isConcurrencyConflict', () => {
  it('error with SQLSTATE 22012 code → true (realistic NeonDbError division_by_zero)', () => {
    const err = Object.assign(new Error('division by zero'), {code: CONCURRENCY_SQLSTATE});
    expect(isConcurrencyConflict(err)).toBe(true);
  });

  it('error message "division by zero" without code → true (driver fallback)', () => {
    expect(isConcurrencyConflict(new Error('division by zero'))).toBe(true);
  });

  it('unrelated Error → false', () => {
    expect(isConcurrencyConflict(new Error('connection reset'))).toBe(false);
  });

  it('error with different SQLSTATE → false', () => {
    expect(isConcurrencyConflict(Object.assign(new Error('boom'), {code: '23505'}))).toBe(false);
  });

  it('null / undefined → false', () => {
    expect(isConcurrencyConflict(null)).toBe(false);
    expect(isConcurrencyConflict(undefined)).toBe(false);
  });
});
