// Unit tests for the foundational utility helpers introduced in v1.1.
// Both helpers were inlined ≥ 6 times in main.js; lifting them out lets
// the tests live somewhere that doesn't need a Lit fixture or a JSDOM
// shadow root. Pure functions, plain Vitest.

import { describe, it, expect } from 'vitest';
import { safeQuery } from '../src/utils/safe-query.js';
import { parseNumericSafe } from '../src/utils/numeric.js';

describe('safeQuery', () => {
  it('returns null when root is null', () => {
    expect(safeQuery(null, '.anything')).toBeNull();
  });

  it('returns null when root is undefined', () => {
    expect(safeQuery(undefined, '.anything')).toBeNull();
  });

  it('returns null when root is the empty string', () => {
    // Falsy guard is intentional — a stringly-typed root is a programmer
    // error, but we'd rather return null than throw on the property
    // access of a non-DOM value.
    expect(safeQuery('', '.anything')).toBeNull();
  });

  it('delegates to root.querySelector when root is truthy', () => {
    const fakeMatch = { tagName: 'DIV' };
    const calls = [];
    const root = {
      querySelector(selector) {
        calls.push(selector);
        return fakeMatch;
      },
    };
    expect(safeQuery(root, '.target')).toBe(fakeMatch);
    expect(calls).toEqual(['.target']);
  });

  it('returns whatever querySelector returns (null pass-through)', () => {
    const root = { querySelector: () => null };
    expect(safeQuery(root, '#missing')).toBeNull();
  });
});

describe('parseNumericSafe', () => {
  it('returns null for null', () => {
    expect(parseNumericSafe(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseNumericSafe(undefined)).toBeNull();
  });

  it('returns null for the HA "unknown" sentinel', () => {
    expect(parseNumericSafe('unknown')).toBeNull();
  });

  it('returns null for the HA "unavailable" sentinel', () => {
    expect(parseNumericSafe('unavailable')).toBeNull();
  });

  it('returns null for the empty string', () => {
    expect(parseNumericSafe('')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseNumericSafe('not a number')).toBeNull();
  });

  it('parses a numeric string', () => {
    expect(parseNumericSafe('21.4')).toBe(21.4);
  });

  it('parses a leading-numeric string (parseFloat semantics)', () => {
    // HA occasionally formats with a unit suffix; parseFloat reads the
    // numeric prefix, which is the desired behaviour here.
    expect(parseNumericSafe('21.4 °C')).toBe(21.4);
  });

  it('passes through finite numbers', () => {
    expect(parseNumericSafe(0)).toBe(0);
    expect(parseNumericSafe(-3.14)).toBe(-3.14);
  });

  it('returns null for NaN', () => {
    expect(parseNumericSafe(NaN)).toBeNull();
  });

  it('returns null for Infinity / -Infinity', () => {
    expect(parseNumericSafe(Infinity)).toBeNull();
    expect(parseNumericSafe(-Infinity)).toBeNull();
  });
});
