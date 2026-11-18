// ルールの説明の見本を再生する部品（design-5 §4.1、§6.5、§6.6）。どの見本も同じやり方で再生する。
// 上から：状態の札の行 / 場のカード / 行（手札・捨て札）。枠はボタンで、押すと次のコマへ進み、そこから数え直す。
// コマの切り替えはぱっと変わるだけ（フェードや移動の補間はしない）。カードは既存の Card（56×80）、札は Field と同じ部品。

import { useEffect, useState } from 'react';
import type { CardId } from '@chofugo/engine';
import { advanceDemo, demoShape, nextAdvanceAt, type DemoClock } from '../lib/help.ts';
import type { DemoBadge, DemoFrame, DemoRow, RuleDemoData } from '../rule-demos.ts';
import { Card, CardBack } from './Card.tsx';
import { FieldStates, type FieldStatesProps } from './Field.tsx';
import { useReducedMotion } from './hooks.ts';
import s from './RuleDemo.module.css';

type Props = {
  data: RuleDemoData;
  /** 見本ページ用：このコマ（0から）で止める。自動では進まない（押すと進む）。 */
  fixedFrame?: number;
  /** 見本ページ用：「視差効果を減らす」の扱いを固定する。 */
  reducedMotion?: boolean;
};

function badgeProps(badges: DemoBadge[]): FieldStatesProps {
  const p: FieldStatesProps = { revolution: false, tempReverse: false, suitLock: null, seqLock: null, colorLock: null, orderReversed: false, ban: null, call: null };
  for (const b of badges) {
    if (b.kind === 'revolution') p.revolution = true;
    else if (b.kind === 'tempReverse') p.tempReverse = true;
    else if (b.kind === 'orderReverse') p.orderReversed = true;
    else if (b.kind === 'suitLock') p.suitLock = b.suits;
    else if (b.kind === 'seqLock') p.seqLock = b.suits;
    else if (b.kind === 'colorLock') p.colorLock = b.color;
    else if (b.kind === 'ban') p.ban = b.rank;
    else p.call = b.ranks;
  }
  return p;
}

function RowView({ row }: { row: DemoRow | undefined }) {
  // 行がないコマでも、行の場所（見出しとカード1枚ぶん）を空けておく（§6.5）
  const mark = new Set<CardId>(row?.mark ?? []);
  return (
    <div className={s.row} aria-hidden={row === undefined ? 'true' : undefined}>
      <span className={`mut ${s.label}`}>{row?.label ?? ''}</span>
      <span className={s.cards}>
        {(row?.cards ?? []).map((c, i) =>
          c === 'back' ? <CardBack key={`b${i}`} size="card" /> : <Card key={c} id={c} received={mark.has(c)} />,
        )}
      </span>
    </div>
  );
}

export function RuleDemo({ data, fixedFrame, reducedMotion }: Props) {
  const osReduced = useReducedMotion();
  const reduced = reducedMotion ?? osReduced;
  const count = data.length;
  const [clock, setClock] = useState<DemoClock>(() => ({ frame: Math.min(fixedFrame ?? 0, Math.max(count - 1, 0)), since: Date.now() }));
  // 自動で進めるのは、コマを固定していなくて、「視差効果を減らす」でないときだけ
  const auto = fixedFrame === undefined && !reduced && count > 1;
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => setClock((c) => advanceDemo(c, count, Date.now())), Math.max(0, nextAdvanceAt(clock, count) - Date.now()));
    return () => clearTimeout(t);
  }, [auto, clock, count]);

  const frame: DemoFrame | undefined = data[clock.frame];
  if (frame === undefined) return null;
  const shape = demoShape(data);
  const rows = frame.rows ?? [];
  return (
    <div className={s.demo}>
      <button
        type="button"
        className={`f win ${s.box}`}
        aria-label={`見本 ${clock.frame + 1}／${count}コマ目。押すと次へ`}
        onClick={() => setClock((c) => advanceDemo(c, count, Date.now()))}
      >
        {shape.badges && (
          <span className={s.badges}>
            <FieldStates {...badgeProps(frame.badges ?? [])} />
          </span>
        )}
        <span className={s.field}>
          {frame.field.map((c) => (
            <Card key={c} id={c} />
          ))}
        </span>
        {Array.from({ length: shape.rows }, (_, i) => (
          <RowView key={i} row={rows[i]} />
        ))}
      </button>
      <p className={s.note}>{frame.note}</p>
      <p className={`gold ${s.dots}`} aria-hidden="true">
        {data.map((_, i) => (i === clock.frame ? '■' : '□')).join('')}
      </p>
      {reduced && <p className={`mut ${s.hint}`}>押すと次へ</p>}
    </div>
  );
}
