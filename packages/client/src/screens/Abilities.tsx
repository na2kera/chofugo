// 特権の画面の部品（design-3 §4.2、§4.3、§6.2、§6.3、§6.7）。
// 選択の一覧（場の枠の位置）、手番の特権のボタンの並び、選択の枠（透視・強奪・独裁・革命・強制流し）。
// 見た目は既存の枠（f win / f dim / f hot）とボタン（btn / btn2）だけで作る。

import { ALL_ABILITY_IDS, type AbilityId, type CardId, type MyAwaiting, type Rank, type SeatId } from '@chofugo/engine';
import { ABILITY_TEXT } from '../abilities-text.ts';
import { abilityBarFrame, banButtons, draftRowState, PANEL_PROMPT, SKIP_ON_LABEL, type AbilityButton, type AbilityPanel } from '../lib/abilities.ts';
import { rankKey } from '../lib/cards.ts';
import s from './Abilities.module.css';

type SelectMine = Extract<MyAwaiting, { kind: 'abilitySelect' }>;
type TurnMine = Extract<MyAwaiting, { kind: 'turn' }>;

/** 特権の選択の一覧（選ぶ人だけ）。表示はサーバーに保存された draft だけ（§6.2）。 */
export function AbilitySelectList({ mine, disabled, onToggle }: { mine: SelectMine; disabled: boolean; onToggle: (id: AbilityId) => void }) {
  return (
    <div className={`f win ${s.box}`} role="group" aria-label="特権の選択">
      <ul className={s.list}>
        {ALL_ABILITY_IDS.map((id) => {
          const st = draftRowState(mine, id);
          const t = ABILITY_TEXT[id];
          return (
            <li key={id}>
              <button
                type="button"
                className={`f ${st === 'sel' ? 'hot' : 'dim'} ${s.row} ${st === 'full' ? s.full : ''}`}
                aria-pressed={st === 'sel'}
                disabled={disabled || st === 'full'}
                onClick={() => onToggle(id)}
              >
                <span className={st === 'sel' ? 'hi' : undefined}>{t.name}</span>
                <span className={s.desc}>{t.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 手番の特権のボタンの並び（自分の番で、未使用の特権があるときだけ。§4.3）。 */
export function AbilityBar({
  buttons,
  open,
  skipOn,
  disabled,
  onPress,
}: {
  buttons: AbilityButton[];
  open: AbilityPanel | null;
  skipOn: boolean;
  disabled: boolean;
  onPress: (id: AbilityId) => void;
}) {
  if (buttons.length === 0) return null;
  return (
    <div className={s.bar} style={{ gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))` }} role="group" aria-label="特権">
      {buttons.map((b) => {
        const on = b.id === 'skip' ? skipOn : open === b.id;
        const frame = abilityBarFrame(b.id, on);
        return (
          <button
            key={b.id}
            type="button"
            className={`f ${frame} ${s.barBtn}${frame === 'btn' ? ` ${s.skipOn}` : ''}`}
            aria-pressed={on}
            disabled={disabled || !b.usable}
            onClick={() => onPress(b.id)}
          >
            {b.id === 'skip' && on ? SKIP_ON_LABEL : ABILITY_TEXT[b.id].name}
          </button>
        );
      })}
    </div>
  );
}

export type UseArgs = { ability: AbilityPanel; target?: SeatId; rank?: Rank };

/** 選択の枠（場の枠の位置。「やめる」で閉じる。§4.3）。 */
export function AbilityPanelBox({
  panel,
  mine,
  nameOf,
  stealCard,
  disabled,
  onUse,
  onClose,
}: {
  panel: AbilityPanel;
  mine: TurnMine;
  nameOf: (seat: SeatId) => string;
  stealCard: CardId | null;
  disabled: boolean;
  onUse: (a: UseArgs) => void;
  onClose: () => void;
}) {
  const u = mine.abilities.find((x) => x.id === panel);
  const close = (
    <button type="button" className={`f btn2 ${s.btn}`} onClick={onClose}>
      やめる
    </button>
  );
  let body: React.ReactNode;
  if (panel === 'peek' || panel === 'steal') {
    const targets = u?.targets ?? [];
    body = (
      <div className={s.targets}>
        {targets.map((t) => (
          <button
            key={t}
            type="button"
            className={`f btn ${s.btn} ${s.name}`}
            disabled={disabled || (panel === 'steal' && stealCard === null)}
            onClick={() => onUse({ ability: panel, target: t })}
          >
            {nameOf(t)}
          </button>
        ))}
        {close}
      </div>
    );
  } else if (panel === 'ban') {
    body = (
      <>
        <div className={s.ranks}>
          {banButtons(u?.ranks).map((r) => (
            <button key={r.rank} type="button" className={`f btn2 ${s.rank}`} disabled={disabled || !r.usable} onClick={() => onUse({ ability: 'ban', rank: r.rank })}>
              {rankKey(r.rank)}
            </button>
          ))}
        </div>
        <div className={s.one}>{close}</div>
      </>
    );
  } else {
    body = (
      <div className={s.two}>
        {close}
        <button type="button" className={`f btn ${s.btn}`} disabled={disabled} onClick={() => onUse({ ability: panel })}>
          使う
        </button>
      </div>
    );
  }
  return (
    <div className={`f win ${s.panel}`} role="group" aria-label={ABILITY_TEXT[panel].name}>
      <p className={s.prompt}>{PANEL_PROMPT[panel]}</p>
      {body}
    </div>
  );
}
