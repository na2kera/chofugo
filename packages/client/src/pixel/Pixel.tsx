// 点の並び（# が塗る点）から SVG を描く（見本 docs/mock/look-pixel.html と同じやり方）。
// 大きさは「点の数 × unit」px の整数倍。shape-rendering: crispEdges でドットを崩さない（§7.11）。

import { memo } from 'react';

/** 横に続く点を1つの長方形にまとめた SVG の path。 */
export function rowsToPath(rows: readonly string[]): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === '#') end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}

export function rowsWidth(rows: readonly string[]): number {
  return rows.reduce((w, r) => Math.max(w, r.length), 0);
}

type Props = {
  rows: readonly string[];
  /** 1点の大きさ（px）。2 の倍数にする。 */
  unit: number;
  color?: string;
  className?: string;
};

export const Pixel = memo(function Pixel({ rows, unit, color = 'currentColor', className }: Props) {
  const w = rowsWidth(rows);
  const h = rows.length;
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width={w * unit}
      height={h * unit}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d={rowsToPath(rows)} fill={color} />
    </svg>
  );
});

/** 色つきの点の並び（文字ごとに色を決める）から SVG の data URI を作る。枠や模様に使う。 */
export function colorRowsDataUri(rows: readonly string[], colors: Record<string, string>): string {
  const w = rowsWidth(rows);
  const h = rows.length;
  let body = '';
  const byColor = new Map<string, string[]>();
  for (const [ch, color] of Object.entries(colors)) {
    const mask = rows.map((row) => [...row].map((c) => (c === ch ? '#' : '.')).join(''));
    const d = rowsToPath(mask);
    if (d !== '') byColor.set(color, [...(byColor.get(color) ?? []), d]);
  }
  for (const [color, ds] of byColor) body += `<path d="${ds.join('')}" fill="${color}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
