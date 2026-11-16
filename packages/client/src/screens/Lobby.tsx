// ロビー（design-client §4.3）。ホストだけが設定を操作できる。ホスト以外には同じ表示を操作できない形で見せる。

import { Fragment, useState } from 'react';
import { DAIFUGO_MODE_DEFAULT_RULES, type GameCount, type RuleId } from '@chofugo/engine';
import { Logo } from '../components/Logo.tsx';
import { seatName } from '../lib/seats.ts';
import { ARROW_GLYPHS } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { LOBBY_RULE_ORDER, RULES_TEXT } from '../rules-text.ts';
import { InviteLink } from './InviteLink.tsx';
import type { ScreenProps } from './types.ts';
import s from './Lobby.module.css';

const COUNTS: { value: GameCount; label: string }[] = [
  { value: 5, label: '5ゲーム' },
  { value: 10, label: '10ゲーム' },
  { value: null, label: '無制限' },
];

export function Lobby({ state, snap, api, initialOpen }: ScreenProps & { initialOpen?: RuleId }) {
  const [open, setOpen] = useState<RuleId | null>(initialOpen ?? null);
  const host = state.isHost;
  const cfg = state.room.config;
  const canAct = host && snap.ready && snap.pending === null;
  const hostSeat = state.room.host;

  const setConfig = (rules: RuleId[], gameCount: GameCount) => {
    // 並びは engine の一覧の順にそろえる
    const ordered = LOBBY_RULE_ORDER.filter((r) => rules.includes(r));
    api.send({ type: 'setConfig', rules: ordered, gameCount }, 'config');
  };
  const toggle = (id: RuleId) => {
    const on = cfg.rules.includes(id);
    setConfig(on ? cfg.rules.filter((r) => r !== id) : [...cfg.rules, id], cfg.gameCount);
  };

  const pairs: RuleId[][] = [];
  for (let i = 0; i < LOBBY_RULE_ORDER.length; i += 2) pairs.push(LOBBY_RULE_ORDER.slice(i, i + 2));

  return (
    <div className={s.page}>
    <div className={s.lobby}>
      <Logo />

      <section className={`f win ${s.box}`}>
        <h2 className={s.h}>招待リンク</h2>
        <InviteLink roomId={state.room.roomId} />
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
          <h2 className={s.h}>ルール</h2>
          {host && (
            <button type="button" className={s.reset} disabled={!canAct} onClick={() => setConfig([...DAIFUGO_MODE_DEFAULT_RULES], cfg.gameCount)}>
              おすすめ設定に戻す
            </button>
          )}
        </div>
        <div className={s.rules}>
          {pairs.map((pair, i) => (
            <Fragment key={i}>
              {pair.map((id) => {
                const on = cfg.rules.includes(id);
                const t = RULES_TEXT[id]!;
                return (
                  <div key={id} className={`${s.tg} ${on ? '' : 'mut'}`}>
                    <button type="button" className={s.ruleName} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                      {t.name}
                    </button>
                    {host ? (
                      <button
                        type="button"
                        className={s.swBtn}
                        role="switch"
                        aria-checked={on}
                        aria-label={`${t.name}`}
                        disabled={!canAct}
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
              {open !== null && pair.includes(open) && <p className={s.desc}>{RULES_TEXT[open]!.text}</p>}
            </Fragment>
          ))}
        </div>
      </section>

      <section className={`f win ${s.box}`}>
        <h2 className={s.h}>ゲーム数</h2>
        <div className={s.seg} role="radiogroup" aria-label="ゲーム数">
          {COUNTS.map((c) => {
            const on = cfg.gameCount === c.value;
            const face = <span className={`f ${on ? 'plate' : 'plate2'} ${s.segFace}`}>{c.label}</span>;
            return host ? (
              <button key={c.label} type="button" role="radio" aria-checked={on} className={s.segBtn} disabled={!canAct} onClick={() => setConfig(cfg.rules, c.value)}>
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
      <div className={s.footer}>
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
    </div>
  );
}
