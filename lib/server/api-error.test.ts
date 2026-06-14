import {describe, it, expect} from 'vitest';
import {ApiError, isUniqueViolation} from './api-error';

describe('ApiError', () => {
  it('carries code + status + default message', () => {
    const e = new ApiError('category_name_exists', 409);
    expect(e.code).toBe('category_name_exists');
    expect(e.status).toBe(409);
    expect(e.message).toBe('category_name_exists');
    expect(e).toBeInstanceOf(Error);
  });

  it('uses provided message', () => {
    const e = new ApiError('x', 400, 'bad thing');
    expect(e.message).toBe('bad thing');
  });
});

describe('isUniqueViolation', () => {
  it('SQLSTATE 23505 → true', () => {
    expect(isUniqueViolation(Object.assign(new Error('dup'), {code: '23505'}))).toBe(true);
  });

  it('message "duplicate key value" → true (driver fallback)', () => {
    expect(
      isUniqueViolation(new Error('duplicate key value violates unique constraint "..."'))
    ).toBe(true);
  });

  it('unrelated error → false', () => {
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('x'), {code: '23503'}))).toBe(false);
  });

  it('null → false', () => {
    expect(isUniqueViolation(null)).toBe(false);
  });
});
