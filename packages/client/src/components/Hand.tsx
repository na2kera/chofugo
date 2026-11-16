// 手札（design-client §4.5、§7.4）。8枚以下は1段、9枚以上は2段。ずれは 30px 以上。
// 重なったカードの押せる範囲は見えている部分（後ろのカードほど手前に描く）。

import type { CardId } from '@chofugo/engine';
import { handLayout, ROW_STEP } from '../lib/layout.ts';
import { Card, type CardLook } from './Card.tsx';
import { useWidth } from './hooks.ts';
import s from './Hand.module.css';

type Props = {
  cards: readonly CardId[];
  lookOf: (id: CardId) => CardLook;
  receivedOf?: (id: CardId) => boolean;
  onPress?: (id: CardId) => void;
  /** 固定の幅（見本ページ用）。 */
};

/** 上にずれる分と、受け取った印の分の余白。 */
const TOP_ROOM = 24;

export function Hand({ cards, lookOf, receivedOf, onPress }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const lay = handLayout(cards.length, width);
  return (
    <div ref={ref} className={s.hand} style={{ height: lay.height + TOP_ROOM + 4 }} role="group" aria-label={`手札 ${cards.length}枚`}>
      {lay.rows.map((row, r) =>
        row.map((idx, j) => {
          const id = cards[idx]!;
          const look = lookOf(id);
          const label = look === 'sel' ? '選択中' : look === 'dim' ? '出せない' : undefined;
          return (
            <Card
              key={id}
              id={id}
              look={look}
              received={receivedOf?.(id) ?? false}
              {...(onPress ? { onPress: () => onPress(id) } : {})}
              {...(label !== undefined ? { extraLabel: label } : {})}
              className={s.pos}
              style={{ left: (lay.starts[r] ?? 0) + j * lay.step, top: TOP_ROOM + r * ROW_STEP }}
            />
          );
        }),
      )}
    </div>
  );
}
