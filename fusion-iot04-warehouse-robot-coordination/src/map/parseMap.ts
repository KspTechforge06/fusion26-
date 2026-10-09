import { readFileSync } from 'node:fs';
import type { MapCell, ParsedMap } from './types.js';

const SUPPORTED_CELLS = new Set<MapCell>(['.', '@', 'T']);

export class MapParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MapParseError';
  }
}

function fail(sourceName: string, message: string): never {
  throw new MapParseError(`${sourceName}: ${message}`);
}

function requiredLine(lines: string[], index: number, sourceName: string, label: string): string {
  const line = lines[index];
  if (line === undefined) {
    fail(sourceName, `missing ${label} line at line ${index + 1}`);
  }
  return line;
}

function parseDimension(line: string, label: 'height' | 'width', sourceName: string, lineNumber: number): number {
  const match = new RegExp(`^${label} ([0-9]+)$`).exec(line);
  if (match === null) {
    fail(sourceName, `malformed ${label} header at line ${lineNumber}: expected "${label} N"`);
  }
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(sourceName, `invalid ${label} at line ${lineNumber}: must be a positive safe integer`);
  }
  return value;
}

export function parseMapText(text: string, sourceName = '<input>'): ParsedMap {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const lines = normalized.split('\n');

  if (requiredLine(lines, 0, sourceName, 'type') !== 'type octile') {
    fail(sourceName, 'invalid type header at line 1: expected "type octile"');
  }

  const height = parseDimension(requiredLine(lines, 1, sourceName, 'height'), 'height', sourceName, 2);
  const width = parseDimension(requiredLine(lines, 2, sourceName, 'width'), 'width', sourceName, 3);
  if (height > Number.MAX_SAFE_INTEGER / width) {
    fail(sourceName, `map dimensions overflow safe storage at lines 2-3: ${height} x ${width}`);
  }
  if (requiredLine(lines, 3, sourceName, 'map marker') !== 'map') {
    fail(sourceName, 'invalid map marker at line 4: expected "map"');
  }

  const gridStart = 4;
  const gridEnd = gridStart + height;
  if (lines.length < gridEnd) {
    fail(sourceName, `truncated grid: expected ${height} rows, found ${Math.max(0, lines.length - gridStart)}`);
  }
  if (lines.length > gridEnd) {
    fail(sourceName, `unexpected extra grid row at line ${gridEnd + 1}`);
  }

  const rows: MapCell[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const lineNumber = gridStart + rowIndex + 1;
    const row = lines[gridStart + rowIndex];
    if (row === undefined) {
      fail(sourceName, `missing grid row ${rowIndex} at line ${lineNumber}`);
    }
    if (row.length !== width) {
      fail(sourceName, `incorrect row width at line ${lineNumber}: expected ${width}, found ${row.length}`);
    }
    const cells: MapCell[] = [];
    for (let column = 0; column < row.length; column += 1) {
      const symbol = row[column];
      if (symbol === undefined || !SUPPORTED_CELLS.has(symbol as MapCell)) {
        fail(sourceName, `unsupported grid symbol at line ${lineNumber}, column ${column + 1}: ${JSON.stringify(symbol)}`);
      }
      cells.push(symbol as MapCell);
    }
    rows.push(cells);
  }

  return {
    sourceName,
    width,
    height,
    rows,
  };
}

export function parseMapFile(filePath: string): ParsedMap {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(filePath, `could not read map file: ${detail}`);
  }
  return parseMapText(text, filePath);
}
