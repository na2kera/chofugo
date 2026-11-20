// 招待リンクの QR コード（ロビーの「QR」、client-assumptions S 節）。ルールの説明（Help）と同じ形で、ロビーの上に重ねる。
// 中身は QR・1行・「閉じる」の3つだけ（見出しと URL の文字は出さない）。3つはパネルの中で上下の中央に寄せる
// （つなぎ直しの帯（画面の上端から 44px）が出ても、QR の上が隠れないように）。
// 点の大きさは、パネルの中身の領域の実際の幅と高さから決める（8・6・4px）。まわりの余白はちょうど4点ぶん。
// フォーカスと Escape は Help・メニューと同じ（特別な処理を足さない、design-5 §6.4）。

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { qrRows, qrUnit } from '../lib/qr.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import m from './Menu.module.css';
import s from './InviteQr.module.css';

/** QR のほかに縦に要るぶん：1行の文字（16）・「閉じる」（44）・間隔2つ（16×2）・つなぎ直しの帯（44）。CSS と合わせる。 */
const OTHER_HEIGHT = 16 + 44 + 16 * 2 + 44;

type Props = { url: string; onClose: () => void };

export function InviteQr({ url, onClose }: Props) {
  const rows = useMemo(() => qrRows(url), [url]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);

  // 中身を入れる要素（大きさが点の大きさに左右されない）を測る。最初の描画の前に1回測り、そのあとは大きさの変化に追従する。
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el === null) return;
    const measure = () => setAvail({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const unit = avail === null ? 4 : qrUnit(rows.length, avail.w, avail.h - OTHER_HEIGHT);
  return (
    <div className={m.overlay} role="dialog" aria-modal="true" aria-label="招待の QR コード">
      <div className={`f win ${m.panel}`}>
        <div ref={bodyRef} className={s.body}>
          <div className={s.qr} style={{ padding: unit * 4 }}>
            <Pixel rows={rows} unit={unit} color="var(--ink)" />
          </div>
          <p className={s.text}>カメラで読みとると 参加できます</p>
          <button type="button" className={m.close} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
