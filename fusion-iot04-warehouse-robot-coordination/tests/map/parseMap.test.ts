import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapParseError, parseMapText, parseMapFile } from '../../src/map/parseMap.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapFiles = readdirSync(projectRoot)
  .filter((fileName) => fileName.endsWith('.map'))
  .sort();

const validMap = [
  'type octile',
  'height 3',
  'width 4',
  'map',
  '.@T.',
  '....',
  '@...',
].join('\n');

function expectParseError(input: string, message: RegExp): void {
  expect(() => parseMapText(input, 'fixture.map')).toThrowError(MapParseError);
  expect(() => parseMapText(input, 'fixture.map')).toThrowError(message);
}

describe('parseMapText', () => {
  it('parses a valid small map and preserves dimensions and symbols', () => {
    const parsed = parseMapText(validMap, 'small.map');

    expect(parsed).toMatchObject({ sourceName: 'small.map', height: 3, width: 4 });
    expect(parsed.rows).toEqual([
      ['.', '@', 'T', '.'],
      ['.', '.', '.', '.'],
      ['@', '.', '.', '.'],
    ]);
  });

  it('parses maps with different dimensions and a terminal newline', () => {
    const parsed = parseMapText(['type octile', 'height 1', 'width 2', 'map', '..', ''].join('\n'));
    expect(parsed.height).toBe(1);
    expect(parsed.width).toBe(2);
    expect(parsed.rows).toEqual([['.', '.']]);
  });

  it('accepts positive dimensions with leading zeros', () => {
    const parsed = parseMapText(['type octile', 'height 003', 'width 0002', 'map', '..', '..', '..'].join('\n'));
    expect(parsed.height).toBe(3);
    expect(parsed.width).toBe(2);
  });

  it('rejects a missing or invalid type header', () => {
    expectParseError(validMap.replace('type octile', 'type'), /invalid type header/);
    expectParseError(validMap.replace('type octile', 'height 3'), /invalid type header/);
  });

  it('rejects missing or malformed dimensions', () => {
    expectParseError(validMap.replace('height 3', 'height'), /malformed height header/);
    expectParseError(validMap.replace('width 4', 'width nope'), /malformed width header/);
    expectParseError(validMap.replace('height 3', 'height 0'), /invalid height/);
    expectParseError(validMap.replace('width 4', 'width -1'), /malformed width header/);
    expectParseError(validMap.replace('height 3', 'height 1.5'), /malformed height header/);
    expectParseError(validMap.replace('width 4', 'width +4'), /malformed width header/);
    expectParseError(validMap.replace('height 3', `height ${'9'.repeat(400)}`), /invalid height/);
  });

  it('rejects dimensions whose product cannot be represented safely', () => {
    expectParseError(
      validMap.replace('height 3', 'height 9007199254740991').replace('width 4', 'width 2'),
      /dimensions overflow/,
    );
  });

  it('rejects a missing map marker', () => {
    expectParseError(validMap.replace('\nmap\n', '\nnot-map\n'), /invalid map marker/);
  });

  it('rejects truncated grids and incorrect row widths', () => {
    expectParseError(validMap.split('\n').slice(0, -1).join('\n'), /truncated grid/);
    expectParseError(validMap.replace('.@T.', '.@'), /incorrect row width/);
  });

  it('rejects unsupported symbols and extra grid rows', () => {
    expectParseError(validMap.replace('.@T.', '.?T.'), /unsupported grid symbol.*column 2/);
    expectParseError(`${validMap}\n....`, /unexpected extra grid row/);
  });

  it('parses every repository map without modifying the source files', () => {
    expect(mapFiles).toHaveLength(33);
    for (const fileName of mapFiles) {
      const filePath = join(projectRoot, fileName);
      const source = readFileSync(filePath, 'utf8');
      const parsed = parseMapFile(filePath);
      expect(parsed.sourceName).toBe(filePath);
      expect(parsed.height).toBeGreaterThan(0);
      expect(parsed.width).toBeGreaterThan(0);
      expect(parsed.rows).toHaveLength(parsed.height);
      expect(source).toBe(readFileSync(filePath, 'utf8'));
    }
  });
});
