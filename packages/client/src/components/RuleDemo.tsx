// ルールの説明の見本を再生する部品（design-5 §4.1、§6.5、§6.6）。どの見本も同じやり方で再生する。
// 上から：状態の札の行 / 場のカード / 行（手札・捨て札）。表示の上に枠いっぱいのボタンを重ね、押すと次のコマへ進み、そこから数え直す（§6.8）。
// コマの切り替えはぱっと変わるだけ（フェードや移動の補間はしない）。カードは既存の Card（56×80）、札は Field と同じ部品。

import { useEffect, useState } from 'react';
import type { CardId } from '@chofugo/engine';
import { advanceDemo, demoBadgeProps, demoButtonLabel, demoShape, nextAdvanceAt, type DemoClock } from '../lib/help.ts';
import type { DemoFrame, DemoRow, RuleDemoData } from '../rule-demos.ts';
import { Card, CardBack } from './Card.tsx';
import { FieldStates } from './Field.tsx';
import { useReducedMotion } from './hooks.ts';
import s from './RuleDemo.module.css';

type Props = {
  data: RuleDemoData;
  /** 見本ページ用：このコマ（0から）で止める。自動では進まない（押すと進む）。 */
  fixedFrame?: number;
  /** 見本ページ用：「視差効果を減らす」の扱いを固定する。 */
  reducedMotion?: boolean;
};

function RowView({ row }: { row: DemoRow | undefined }) {
  // 行がないコマでも、行の場所（見出しとカード1枚ぶん）を空けておく（§6.5）
  const mark = new Set<CardId>(row?.mark ?? []);
  return (
    <div className={s.row}>
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
    // 時刻は状態を更新する関数の外で取って渡す（§6.8）
    const t = setTimeout(
      () => {
        const now = Date.now();
        setClock((c) => advanceDemo(c, count, now));
      },
      Math.max(0, nextAdvanceAt(clock, count) - Date.now()),
    );
    return () => clearTimeout(t);
  }, [auto, clock, count]);

  const frame: DemoFrame | undefined = data[clock.frame];
  if (frame === undefined) return null;
  const shape = demoShape(data);
  const rows = frame.rows ?? [];
  return (
    <div className={s.demo}>
      {/* 表示（場・札・行）はふつうの div。その上に枠いっぱいの押せる部品を兄弟として重ねる（ボタンの中に div を入れない、§6.8）。
          読み上げはボタンの名前にまとめるので、表示の側は読み上げから隠す */}
      <div className={s.stage}>
        <div className={`f win ${s.box}`} aria-hidden="true">
          {shape.badges && (
            <div className={s.badges}>
              <FieldStates {...demoBadgeProps(frame.badges ?? [])} />
            </div>
          )}
          <div className={s.field}>
            {frame.field.map((c) => (
              <Card key={c} id={c} />
            ))}
          </div>
          {Array.from({ length: shape.rows }, (_, i) => (
            <RowView key={i} row={rows[i]} />
          ))}
        </div>
        <button
          type="button"
          className={s.hit}
          aria-label={demoButtonLabel(frame, clock.frame, count)}
          onClick={() => {
            const now = Date.now();
            setClock((c) => advanceDemo(c, count, now));
          }}
        />
      </div>
      <p className={s.note}>{frame.note}</p>
      <p className={`gold ${s.dots}`} aria-hidden="true">
        {data.map((_, i) => (i === clock.frame ? '■' : '□')).join('')}
      </p>
      {reduced && <p className={`mut ${s.hint}`}>押すと次へ</p>}
    </div>
  );
}
