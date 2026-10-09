import { describe, expect, it } from 'vitest';
import { parseMapText } from '../../src/map/parseMap.js';
import { findPath } from '../../src/map/astar.js';
import type { Coordinate } from '../../src/map/types.js';

const openMap = parseMapText([
  'type octile',
  'height 3',
  'width 5',
  'map',
  '.....',
  '.@.@.',
  '.....',
].join('\n'), 'open.map');

const blockedMap = parseMapText([
  'type octile',
  'height 3',
  'width 3',
  'map',
  '@.@',
  '@.@',
  '@.@',
].join('\n'), 'blocked.map');

describe('A* single-robot pathfinding', () => {
  it('finds direct path when no obstacles in way', () => {
    const res = findPath(openMap, { row: 0, column: 0 }, { row: 0, column: 4 });
    expect(res.kind).toBe('path');
    if (res.kind === 'path') {
      expect(res.path.length).toBeGreaterThanOrEqual(2);
      expect(res.path[0]).toEqual({ row: 0, column: 0 });
      expect(res.path[res.path.length - 1]).toEqual({ row: 0, column: 4 });
      for (let i = 0; i < res.path.length - 1; i++) {
        const a = res.path[i];
        const b = res.path[i + 1];
        const dr = b.row - a.row;
        const dc = b.column - a.column;
        expect(Math.abs(dr) + Math.abs(dc)).toBe(1);
      }
    }
  });

  it('routes around an obstacle', () => {
    const res = findPath(openMap, { row: 0, column: 0 }, { row: 2, column: 4 });
    expect(res.kind).toBe('path');
    if (res.kind === 'path') {
      expect(res.path[0]).toEqual({ row: 0, column: 0 });
      expect(res.path[res.path.length - 1]).toEqual({ row: 2, column: 4 });
    }
  });

  it('returns path for start equal to goal', () => {
    const res = findPath(openMap, { row: 1, column: 2 }, { row: 1, column: 2 });
    expect(res.kind).toBe('path');
    if (res.kind === 'path') {
      expect(res.path).toEqual([{ row: 1, column: 2 }]);
    }
  });

  it('rejects out-of-bounds start', () => {
    const res = findPath(openMap, { row: 10, column: 0 }, { row: 0, column: 0 });
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.reason).toContain('out of bounds');
  });

  it('rejects out-of-bounds goal', () => {
    const res = findPath(openMap, { row: 0, column: 0 }, { row: -1, column: 2 });
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.reason).toContain('out of bounds');
  });

  it('rejects blocked start', () => {
    const res = findPath(openMap, { row: 1, column: 1 }, { row: 0, column: 4 });
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.reason).toContain('blocked');
  });

  it('rejects blocked goal', () => {
    const res = findPath(openMap, { row: 0, column: 0 }, { row: 1, column: 1 });
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.reason).toContain('blocked');
  });

  it('reports no route when start and goal are separated by obstacles', () => {
    // Start in center of open cell but goal fully enclosed by walls (unreachable)
    const wallMap = parseMapText([
      'type octile', 'height 5', 'width 5', 'map',
      '@@@@@',
      '@.@.@',
      '@.@.@',
      '@.@.@',
      '@@@@@',
    ].join('\n'), 'wall.map');
    const res = findPath(wallMap, { row: 1, column: 1 }, { row: 3, column: 3 });
    expect(res.kind).toBe('no-route');
  });

  it('returns deterministic results for identical inputs', () => {
    const r1 = findPath(openMap, { row: 0, column: 0 }, { row: 2, column: 4 });
    const r2 = findPath(openMap, { row: 0, column: 0 }, { row: 2, column: 4 });
    expect(r1.kind).toBe('path');
    expect(r2.kind).toBe('path');
    if (r1.kind === 'path' && r2.kind === 'path') {
      expect(r1.path).toEqual(r2.path);
    }
  });

  it('path stays in bounds and traverses only free cells', () => {
    const res = findPath(openMap, { row: 0, column: 0 }, { row: 2, column: 2 });
    expect(res.kind).toBe('path');
    if (res.kind === 'path') {
      const path = res.path;
      for (const c of path) {
        expect(c.row >= 0 && c.row < openMap.height).toBe(true);
        expect(c.column >= 0 && c.column < openMap.width).toBe(true);
        expect(openMap.rows[c.row][c.column]).toBe('.');
      }
    }
  });

  it('rejects non-integer coordinates', () => {
    const bad = { row: 0.5, column: 0 } as unknown as Coordinate;
    const res = findPath(openMap, bad, { row: 0, column: 1 });
    expect(res.kind).toBe('invalid');
  });
});
