import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  object,
  str,
  int,
  bool,
  isoDate,
  url,
  oneOf,
  arrayOf,
  optional,
  nullable,
  parseOrThrow,
} from '../src/lib/validate.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

describe('scalar validators', () => {
  test('strings are trimmed and length-checked', () => {
    assert.equal(parseOrThrow(str(), '  hello  '), 'hello');
    assert.throws(() => parseOrThrow(str({ min: 3 }), 'ab'));
    assert.throws(() => parseOrThrow(str({ max: 2 }), 'abc'));
    assert.throws(() => parseOrThrow(str(), 42));
  });

  test('integers accept numeric strings but reject fractions', () => {
    assert.equal(parseOrThrow(int(), 7), 7);
    assert.equal(parseOrThrow(int(), '7'), 7);
    assert.throws(() => parseOrThrow(int(), 7.5));
    assert.throws(() => parseOrThrow(int({ min: 0, max: 100 }), 101));
  });

  test('booleans accept their string forms', () => {
    assert.equal(parseOrThrow(bool(), true), true);
    assert.equal(parseOrThrow(bool(), 'false'), false);
    assert.throws(() => parseOrThrow(bool(), 'maybe'));
  });

  test('dates must be real calendar days', () => {
    assert.equal(parseOrThrow(isoDate(), '2026-10-06'), '2026-10-06');
    assert.throws(() => parseOrThrow(isoDate(), '2026-02-31'));
  });

  test('urls must be http(s)', () => {
    assert.equal(parseOrThrow(url(), 'https://example.com/a'), 'https://example.com/a');
    assert.throws(() => parseOrThrow(url(), 'javascript:alert(1)'));
    assert.throws(() => parseOrThrow(url(), 'not a url'));
  });

  test('oneOf closes the vocabulary', () => {
    const priority = oneOf(['P0', 'P1'] as const);
    assert.equal(parseOrThrow(priority, 'P0'), 'P0');
    assert.throws(() => parseOrThrow(priority, 'P9'));
  });
});

describe('composite validators', () => {
  const schema = object({
    title: str({ max: 20 }),
    count: int({ min: 0 }),
    tags: optional(arrayOf(str())),
    note: optional(nullable(str())),
  });

  test('parses a valid object', () => {
    const parsed = parseOrThrow(schema, { title: 'hi', count: 2, tags: ['a'], note: null });
    assert.deepEqual(parsed, { title: 'hi', count: 2, tags: ['a'], note: null });
  });

  test('optional keys may be omitted entirely', () => {
    assert.deepEqual(parseOrThrow(schema, { title: 'hi', count: 0 }), { title: 'hi', count: 0 });
  });

  test('missing required keys are reported by path', () => {
    try {
      parseOrThrow(schema, { count: 1 });
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.VALIDATION);
      assert.ok(error.details.some((d) => d.path === 'title' && d.message === 'is required'));
    }
  });

  test('every failing field is reported, not just the first', () => {
    try {
      parseOrThrow(schema, { title: 123, count: 'abc' });
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.equal(error.details.length, 2);
    }
  });

  test('array element failures carry an index in the path', () => {
    try {
      parseOrThrow(schema, { title: 'hi', count: 1, tags: ['ok', 5] });
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.ok(error.details.some((d) => d.path === 'tags[1]'));
    }
  });

  test('non-objects are rejected', () => {
    assert.throws(() => parseOrThrow(schema, 'nope'));
    assert.throws(() => parseOrThrow(schema, [1, 2]));
    assert.throws(() => parseOrThrow(schema, null));
  });
});
