// ロビー（design-client §4.3、design-2 §4.1）。ホストだけが設定を操作できる。ホスト以外には同じ表示を操作できない形で見せる。
// ルールの枠のいちばん上にモードの切り替え（大富豪・カスタム・超富豪）。カスタムは「定番」8種・「応用」8種・「特殊」8種（design-4 §4.1）を同じ2列で並べる。
// 超富豪（design-3 §4.1）は24種すべて ON で固定。操作できない形で見せ、その上に1行「前の大富豪が 特権を使える」。
// 設定は送るだけで、正しい形に直すのはサーバー（モードで選べないルール・前提のないルールは外れて届く）。

import { Fragment, useState } from 'react';
import { ALL_RULE_IDS, CUSTOM_MODE_RULE_IDS, DAIFUGO_MODE_DEFAULT_RULES, RULE_MODULES, type GameCount, type RuleId } from '@chofugo/engine';
import type { GameMode } from '@chofugo/server/protocol';
import { Logo } from '../components/Logo.tsx';
import { seatName } from '../lib/seats.ts';
import { ARROW_GLYPHS } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { ADVANCED_RULE_ORDER, LOBBY_RULE_ORDER, RULES_TEXT, SPECIAL_RULE_ORDER } from '../rules-text.ts';
import { Help } from './Help.tsx';
import { InviteLink, inviteUrl } from './InviteLink.tsx';
import { InviteQr } from './InviteQr.tsx';
import type { ScreenProps } from './types.ts';
import s from './Lobby.module.css';

const MODES: { value: GameMode; label: string }[] = [
  { value: 'daifugo', label: '大富豪' },
  { value: 'custom', label: 'カスタム' },
  { value: 'chofugo', label: '超富豪' },
];

/** 前提のルールが OFF なので押せない（4止めは8切り、6戻しは J バックが前提）。 */
function missingRequirement(id: RuleId, rules: readonly RuleId[]): boolean {
  return (RULE_MODULES.find((m) => m.id === id)?.requires ?? []).some((r) => !rules.includes(r));
}

function pairsOf(order: readonly RuleId[]): RuleId[][] {
  const out: RuleId[][] = [];
  for (let i = 0; i < order.length; i += 2) out.push(order.slice(i, i + 2));
  return out;
}

const COUNTS: { value: GameCount; label: string }[] = [
  { value: 5, label: '5ゲーム' },
  { value: 10, label: '10ゲーム' },
  { value: null, label: '無制限' },
];

export function Lobby({ state, snap, api, initialOpen, initialHelp, initialQrOpen }: ScreenProps & { initialOpen?: RuleId; initialHelp?: boolean; initialQrOpen?: boolean }) {
  const [open, setOpen] = useState<RuleId | null>(initialOpen ?? null);
  // ルールの説明（design-5 §6.4）。ロビーの上に重ねる。試合が始まるとロビーごと外れて閉じる。切断・再接続の間はロビーが残るので閉じない。
  // 開いている間は、後ろ（ロビーの本体と下の帯）をキーボードでも操作できないようにする（§6.8。ロビーにメニューはない）
  const [helpOpen, setHelpOpen] = useState(initialHelp ?? false);
  // 招待の QR コード（client-assumptions S 節）。ホストかどうか・空席があるかどうかに関係なく、全員が開ける。後ろの扱いは説明と同じ
  const [qrOpen, setQrOpen] = useState(initialQrOpen ?? false);
  const covered = helpOpen || qrOpen;
  const host = state.isHost;
  const cfg = state.room.config;
  const canAct = host && snap.ready && snap.pending === null;
  const hostSeat = state.room.host;

  const mode = cfg.mode;
  const setConfig = (m: GameMode, rules: readonly RuleId[], gameCount: GameCount) => {
    // 並びは engine の一覧の順にそろえる
    const ordered = ALL_RULE_IDS.filter((r) => rules.includes(r));
    api.send({ type: 'setConfig', mode: m, rules: ordered, gameCount }, 'config');
  };
  const toggle = (id: RuleId) => {
    const on = cfg.rules.includes(id);
    setConfig(mode, on ? cfg.rules.filter((r) => r !== id) : [...cfg.rules, id], cfg.gameCount);
  };

  // 超富豪モードのルールは固定（ホストでも操作できない形で見せる）
  const editable = host && mode !== 'chofugo';
  const ruleGrid = (order: readonly RuleId[]) => (
    <div className={s.rules}>
      {pairsOf(order).map((pair, i) => (
        <Fragment key={i}>
          {pair.map((id) => {
            const on = cfg.rules.includes(id);
            const locked = missingRequirement(id, cfg.rules);
            const t = RULES_TEXT[id];
            return (
              <div key={id} className={`${s.tg} ${locked ? s.locked : on ? '' : 'mut'}`}>
                <button
                  type="button"
                  className={`${s.ruleName} ${t.lobbyLines ? s.twoLines : ''}`}
                  aria-expanded={open === id}
                  aria-label={t.lobbyLines ? t.name : undefined}
                  onClick={() => setOpen(open === id ? null : id)}
                >
                  {t.lobbyLines ? (
                    <>
                      {t.lobbyLines[0]}
                      <br />
                      {t.lobbyLines[1]}
                    </>
                  ) : (
                    t.name
                  )}
                </button>
                {editable ? (
                  <button
                    type="button"
                    className={s.swBtn}
                    role="switch"
                    aria-checked={on}
                    aria-label={`${t.name}`}
                    disabled={!canAct || locked}
                    onClick={() => toggle(id)}
                  >
                    <span className={`f ${on ? 'plate' : 'plate2'} ${s.sw}`}>{on ? 'ON' : 'OFF'}</span>
                  </button>
                ) : (
                  <span className={s.swBtn} aria-label={`${t.name} ${on ? 'ON' : 'OFF'}`}>
                    <span className={`f ${on ? 'plate' : 'plate2'} ${s.sw}`}>{on ? 'ON' : 'OFF'}</span>
                  </span>
                )}
              </div>
            );
          })}
          {open !== null && pair.includes(open) && <p className={s.desc}>{RULES_TEXT[open].text}</p>}
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className={s.page}>
    <div className={s.lobby} inert={covered}>
      <Logo />

      <section className={`f win ${s.box}`}>
        <h2 className={s.h}>招待リンク</h2>
        <InviteLink roomId={state.room.roomId} onShowQr={() => setQrOpen(true)} />
      </section>

      <section className={`f win ${s.box}`}>
        <h2 className={s.h}>参加者</h2>
        <ul className={s.seats}>
          {state.room.seats.map((x) => (
            <li key={x.seat} className={`${s.seat} ${x.kind === 'empty' ? 'mut' : ''}`}>
              {x.kind === 'empty' ? (
                <>
                  <span className={s.dot}>・</span>
                  <span>空席</span>
                </>
              ) : (
                <>
                  <span className={`gold ${s.arrow}`}>
                    <Pixel rows={ARROW_GLYPHS.right} unit={2} />
                  </span>
                  <span className={`${s.name} ${x.away ? 'mut' : ''}`}>
                    {seatName(state.room.seats, x.seat)}
                  </span>
                </>
              )}
              <span className={s.sp} />
              {x.seat === hostSeat && <span className="f plate">ホスト</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className={`f win ${s.box}`}>
        <div className={s.hrow}>
          {/* 見出し「ルール」と「？」を左にまとめる（design-5 §6.4） */}
          <div className={s.hleft}>
            <h2 className={s.h}>ルール</h2>
            <button type="button" className={s.help} aria-label="ルールの説明" onClick={() => setHelpOpen(true)}>
              ？
            </button>
          </div>
          {editable &&
            (mode === 'custom' ? (
              <button type="button" className={s.reset} disabled={!canAct} onClick={() => setConfig(mode, CUSTOM_MODE_RULE_IDS, cfg.gameCount)}>
                全部 ON
              </button>
            ) : (
              <button type="button" className={s.reset} disabled={!canAct} onClick={() => setConfig(mode, DAIFUGO_MODE_DEFAULT_RULES, cfg.gameCount)}>
                おすすめ設定に戻す
              </button>
            ))}
        </div>
        <div className={`${s.seg} ${s.modes}`} role="radiogroup" aria-label="モード">
          {MODES.map((m) => {
            const on = mode === m.value;
            const face = <span className={`f ${on ? 'plate' : 'plate2'} ${s.segFace}`}>{m.label}</span>;
            return host ? (
              <button key={m.value} type="button" role="radio" aria-checked={on} className={s.segBtn} disabled={!canAct} onClick={() => !on && setConfig(m.value, cfg.rules, cfg.gameCount)}>
                {face}
              </button>
            ) : (
              <span key={m.value} role="radio" aria-checked={on} aria-disabled="true" className={s.segBtn}>
                {face}
              </span>
            );
          })}
        </div>
        {mode === 'chofugo' && <p className={s.modeNote}>前の大富豪が 特権を使える</p>}
        {mode === 'custom' || mode === 'chofugo' ? (
          <>
            <h3 className={s.sub}>定番</h3>
            {ruleGrid(LOBBY_RULE_ORDER)}
            <h3 className={s.sub}>応用</h3>
            {ruleGrid(ADVANCED_RULE_ORDER)}
            <h3 className={s.sub}>特殊</h3>
            {ruleGrid(SPECIAL_RULE_ORDER)}
          </>
        ) : (
          ruleGrid(LOBBY_RULE_ORDER)
        )}
      </section>

      <section className={`f win ${s.box}`}>
        <h2 className={s.h}>ゲーム数</h2>
        <div className={s.seg} role="radiogroup" aria-label="ゲーム数">
          {COUNTS.map((c) => {
            const on = cfg.gameCount === c.value;
            const face = <span className={`f ${on ? 'plate' : 'plate2'} ${s.segFace}`}>{c.label}</span>;
            return host ? (
              <button key={c.label} type="button" role="radio" aria-checked={on} className={s.segBtn} disabled={!canAct} onClick={() => setConfig(mode, cfg.rules, c.value)}>
                {face}
              </button>
            ) : (
              <span key={c.label} role="radio" aria-checked={on} aria-disabled="true" className={s.segBtn}>
                {face}
              </span>
            );
          })}
        </div>
      </section>

    </div>
      {/* 下の帯：知らせの1行と、開始のボタン（ルールの欄が伸びても常に見える） */}
      <div className={s.footer} inert={covered}>
        {snap.notice !== null && (
          <p className={s.notice} role="status">
            {snap.notice}
          </p>
        )}
        {host ? (
          <button type="button" className="f btn" disabled={!canAct} onClick={() => api.send({ type: 'start' }, 'start')}>
            ゲームを始める
          </button>
        ) : (
          <p className={s.wait}>ホストが始めるのを待っています</p>
        )}
      </div>
      {helpOpen && <Help mode={mode} rules={cfg.rules} yourTurn={false} onClose={() => setHelpOpen(false)} />}
      {qrOpen && <InviteQr url={inviteUrl(state.room.roomId)} onClose={() => setQrOpen(false)} />}
    </div>
  );
}
