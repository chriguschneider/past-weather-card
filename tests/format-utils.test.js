import { describe, it, expect } from 'vitest';
import { lightenColor, computeBlockSeparatorPositions } from '../src/format-utils.js';

describe('lightenColor', () => {
  it('reduces alpha of an rgba colour', () => {
    expect(lightenColor('rgba(132, 209, 253, 1.0)')).toBe('rgba(132, 209, 253, 0.450)');
  });

  it('handles rgb without alpha (treats alpha as 1)', () => {
    expect(lightenColor('rgb(132, 209, 253)')).toBe('rgba(132, 209, 253, 0.450)');
  });

  it('compounds an existing alpha', () => {
    expect(lightenColor('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.225)');
  });

  it('expands a 6-digit hex to rgba', () => {
    expect(lightenColor('#ff8000')).toBe('rgba(255, 128, 0, 0.450)');
  });

  it('expands a 3-digit hex to rgba', () => {
    expect(lightenColor('#f80')).toBe('rgba(255, 136, 0, 0.450)');
  });

  it('honours a custom factor', () => {
    expect(lightenColor('rgba(255, 0, 0, 1.0)', 0.2)).toBe('rgba(255, 0, 0, 0.200)');
  });

  it('returns the input unchanged for unknown formats', () => {
    expect(lightenColor('hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
    expect(lightenColor('red')).toBe('red');
    expect(lightenColor('inherit')).toBe('inherit');
  });

  it('passes through nullish / non-string inputs without throwing', () => {
    expect(lightenColor(null)).toBe(null);
    expect(lightenColor(undefined)).toBe(undefined);
    expect(lightenColor(123)).toBe(123);
    expect(lightenColor('')).toBe('');
  });
});

describe('computeBlockSeparatorPositions', () => {
  it('returns no positions when there are fewer than 2 ticks', () => {
    expect(computeBlockSeparatorPositions(1, 0, 1)).toEqual([]);
    expect(computeBlockSeparatorPositions(0, 0, 0)).toEqual([]);
  });

  it('frames the doubled-today column when both blocks present', () => {
    // station 0..6 (7 cols), forecast 7..13 (7 cols). Today = 6 / 7.
    expect(computeBlockSeparatorPositions(7, 7, 14)).toEqual([
      [5, 6], // before station-today
      [7, 8], // after forecast-today
    ]);
  });

  it('emits only the right line when there is just one station column', () => {
    // station=1, forecast=7 — no left framing because no col before today.
    expect(computeBlockSeparatorPositions(1, 7, 8)).toEqual([
      [1, 2],
    ]);
  });

  it('emits only the left line when forecast-today is the rightmost tick', () => {
    expect(computeBlockSeparatorPositions(7, 1, 8)).toEqual([
      [5, 6],
    ]);
  });

  it('station-only: line before today (rightmost)', () => {
    expect(computeBlockSeparatorPositions(7, 0, 7)).toEqual([
      [5, 6],
    ]);
  });

  it('forecast-only: line after today (leftmost)', () => {
    expect(computeBlockSeparatorPositions(0, 7, 7)).toEqual([
      [0, 1],
    ]);
  });

  it('returns no positions when both counts are zero', () => {
    expect(computeBlockSeparatorPositions(0, 0, 5)).toEqual([]);
  });

  it('handles non-finite ticksLength defensively', () => {
    expect(computeBlockSeparatorPositions(7, 7, NaN)).toEqual([]);
    expect(computeBlockSeparatorPositions(7, 7, undefined)).toEqual([]);
  });
});
