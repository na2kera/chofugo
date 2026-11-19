// ルールの説明（「？」、design-5 §3、§6.4、§6.5）。メニューと同じ形で、いまの画面（対戦の画面・ロビー）の上に重ねる。
// 一覧：「定番」「応用」「特殊」「特権」の下に名前を2列で並べる（ロビーのルールの並びと同じ形）。この試合で使うものは明るく、使わないものは暗い。どれも押せる。
// 1つを開くと：名前と「戻る」（上に固定）／説明の文・見本・コマの説明（縦にスクロール）。見本はルール24種・特権6種のすべてにある。
// フォーカスと Escape はメニューと同じ（特別な処理を足さない、§6.4）。

import { useState } from 'react';
import type { RuleId } from '@chofugo/engine';
import type { GameMode } from '@chofugo/server/protocol';
import { RuleDemo } from '../components/RuleDemo.tsx';
import { demoOf, helpItemKey, helpSections, helpText, type HelpItem } from '../lib/help.ts';
import l from './Lobby.module.css';
import m from './Menu.module.css';
import s from './Help.module.css';

type Props = {
  mode: GameMode;
  rules: readonly RuleId[];
  /** 自分の操作の番か（いちばん上に「あなたの番です」を出す）。 */
  yourTurn: boolean;
  onClose: () => void;
  /** 見本ページ用：最初に開いている項目・止めるコマ・「視差効果を減らす」の扱い。 */
  initial?: HelpItem;
  fixedFrame?: number;
  reducedMotion?: boolean;
};

export function Help({ mode, rules, yourTurn, onClose, initial, fixedFrame, reducedMotion }: Props) {
  const [open, setOpen] = useState<HelpItem | null>(initial ?? null);
  const text = open === null ? null : helpText(open);
  const title = text === null ? 'ルールの説明' : text.name;
  return (
    <div className={m.overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`f win ${m.panel}`}>
        {yourTurn && (
          <p className={`hi ${s.turn}`} role="status">
            あなたの番です
          </p>
        )}
        <div className={m.head}>
          <h2 className={m.h}>{title}</h2>
          <button type="button" className={m.close} onClick={open === null ? onClose : () => setOpen(null)}>
            {open === null ? '閉じる' : '戻る'}
          </button>
        </div>

        {open === null ? (
          <div className={m.scroll}>
            {helpSections(mode, rules).map((sec) => (
              <section key={sec.title}>
                <h3 className={l.sub}>{sec.title}</h3>
                <div className={l.rules}>
                  {sec.entries.map((e) => (
                    // ロビーの行と同じ形（暗い文字は行に付け、名前のボタンが受け継ぐ）
                    <div key={helpItemKey(e.item)} className={`${l.tg} ${e.used ? '' : 'mut'}`}>
                      <button type="button" className={l.ruleName} onClick={() => setOpen(e.item)}>
                        {e.name}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={m.scroll}>
            <p className={`${l.desc} ${s.desc}`}>{text?.text}</p>
            <RuleDemo
              key={helpItemKey(open)}
              data={demoOf(open)}
              {...(fixedFrame !== undefined ? { fixedFrame } : {})}
              {...(reducedMotion !== undefined ? { reducedMotion } : {})}
            />
          </div>
        )}
      </div>
    </div>
  );
}
