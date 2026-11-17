// 選択の待ちのうち、場の枠の位置に枠を出すもの（design-4 §4.2）。
// 闇市は強奪の枠と同じ形（相手の名前のボタンを縦に並べる）、Q ボンバーは独裁の枠と同じ形（数字のボタンを7列）。
// 見た目は特権の選択の枠（Abilities.module.css）と同じクラスを使う。選んでいるボタンは金の塗り（f btn。「N枚を出す」と同じ枠）、選んでいないボタンは金の線の枠（f btn2）。
// 「使わない」「宣言しない」と送るボタンは、ほかの選択と同じく画面の下のボタンの欄に出す。

import type { CallRank, SeatId } from '@chofugo/engine';
import { CALL_RANKS, callLabel, callPrompt, pickFrame, TRADE_PROMPT, tradeTargetCount } from '../lib/choice.ts';
import s from './Abilities.module.css';

/** 闇市：相手を選ぶ枠。ボタンは名前と残り枚数。もう一度押すと外れる。 */
export function TradePanel({
  targets,
  handCounts,
  target,
  nameOf,
  disabled,
  onTarget,
}: {
  targets: readonly SeatId[];
  handCounts: readonly number[];
  target: SeatId | null;
  nameOf: (seat: SeatId) => string;
  disabled: boolean;
  onTarget: (seat: SeatId | null) => void;
}) {
  return (
    <div className={`f win ${s.panel}`} role="group" aria-label="闇市">
      <p className={s.prompt}>{TRADE_PROMPT}</p>
      <div className={s.targets}>
        {targets.map((t) => {
          const on = target === t;
          const frame = pickFrame(on);
          return (
            <button
              key={t}
              type="button"
              className={`f ${frame} ${s.btn} ${s.target}${frame === 'btn' ? ` ${s.picked}` : ''}`}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onTarget(on ? null : t)}
            >
              <span className={s.targetName}>{nameOf(t)}</span>
              <span className={s.targetCount}>{tradeTargetCount(handCounts[t] ?? 0)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Q ボンバー：数字を上限の個数まで選ぶ枠。3〜9 / 10〜2 の7列×2行と、JOKER の1行（client-assumptions J6）。 */
export function CallPanel({
  max,
  picked,
  disabled,
  onToggle,
}: {
  max: number;
  picked: readonly CallRank[];
  disabled: boolean;
  onToggle: (r: CallRank) => void;
}) {
  const btn = (r: CallRank, extra = '') => {
    const on = picked.includes(r);
    const frame = pickFrame(on);
    return (
      <button
        key={String(r)}
        type="button"
        className={`f ${frame} ${s.rank}${frame === 'btn' ? ` ${s.picked}` : ''} ${extra}`}
        aria-pressed={on}
        aria-label={r === 'joker' ? 'ジョーカー' : callLabel(r)}
        disabled={disabled}
        onClick={() => onToggle(r)}
      >
        {callLabel(r)}
      </button>
    );
  };
  const numbers = CALL_RANKS.filter((r) => r !== 'joker');
  return (
    <div className={`f win ${s.panel}`} role="group" aria-label="Q ボンバー">
      <p className={s.prompt}>{callPrompt(max)}</p>
      <div className={s.ranks}>{numbers.map((r) => btn(r))}</div>
      <div className={s.one}>{btn('joker')}</div>
    </div>
  );
}
