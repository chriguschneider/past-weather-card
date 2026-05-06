// Unit tests for the lifecycle-cleanup registry. Pure JS — no Lit /
// DOM fixture needed.

import { describe, it, expect, vi } from 'vitest';
import { TeardownRegistry } from '../src/teardown-registry.js';

describe('TeardownRegistry', () => {
  it('starts empty', () => {
    const r = new TeardownRegistry();
    expect(r.size).toBe(0);
  });

  it('add() pushes a function and returns it', () => {
    const r = new TeardownRegistry();
    const fn = () => {};
    expect(r.add(fn)).toBe(fn);
    expect(r.size).toBe(1);
  });

  it('add() silently ignores non-function inputs', () => {
    const r = new TeardownRegistry();
    r.add(null);
    r.add(undefined);
    r.add(42);
    r.add('not a function');
    r.add({});
    expect(r.size).toBe(0);
  });

  it('drain() runs every registered fn', () => {
    const r = new TeardownRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    r.add(a); r.add(b); r.add(c);
    r.drain();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  });

  it('drain() runs fns in registration order', () => {
    const r = new TeardownRegistry();
    const order = [];
    r.add(() => order.push('first'));
    r.add(() => order.push('second'));
    r.add(() => order.push('third'));
    r.drain();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('drain() empties the registry', () => {
    const r = new TeardownRegistry();
    r.add(() => {});
    r.add(() => {});
    expect(r.size).toBe(2);
    r.drain();
    expect(r.size).toBe(0);
  });

  it('drain() is idempotent (second call is a no-op)', () => {
    const r = new TeardownRegistry();
    const fn = vi.fn();
    r.add(fn);
    r.drain();
    r.drain();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('drain() swallows per-fn errors and continues', () => {
    const r = new TeardownRegistry();
    const before = vi.fn();
    const after = vi.fn();
    r.add(before);
    r.add(() => { throw new Error('boom'); });
    r.add(after);
    // Quiet the console.error for the test run.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => r.drain()).not.toThrow();
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('registry is reusable after drain (push more, drain again)', () => {
    const r = new TeardownRegistry();
    const round1 = vi.fn();
    r.add(round1);
    r.drain();
    const round2 = vi.fn();
    r.add(round2);
    r.drain();
    expect(round1).toHaveBeenCalledOnce();
    expect(round2).toHaveBeenCalledOnce();
  });
});
