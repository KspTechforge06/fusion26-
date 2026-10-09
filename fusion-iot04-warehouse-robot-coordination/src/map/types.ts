export type Coordinate = Readonly<{
  row: number;
  column: number;
}>;

export type MapCell = '.' | '@' | 'T';

export type ParsedMap = Readonly<{
  sourceName: string;
  width: number;
  height: number;
  rows: ReadonlyArray<ReadonlyArray<MapCell>>;
}>;
