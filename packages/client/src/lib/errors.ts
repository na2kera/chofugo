// サーバーが操作を拒否したときの1行（§4.8）。英語のエラー文はそのまま出さない。

import type { ErrorMessage } from '@chofugo/server/protocol';

export function errorText(e: Pick<ErrorMessage, 'code' | 'engineError'>): string {
  switch (e.code) {
    case 'actionRejected':
      switch (e.engineError) {
        case 'staleAwait':
        case 'notYourAwait':
        case 'wrongAwaitKind':
        case 'wrongPhase':
          return '行き違いになった。いまの状態に合わせた';
        case 'illegalPlay':
        case 'invalidCombination':
        case 'cardNotInHand':
          return 'その手は出せない';
        case 'cannotPass':
          return 'いまはパスできない';
        case 'confirmFoulRequired':
          return '反則上がりの確認が必要';
        case 'ambiguousShape':
          return '組か階段かを選んでください';
        case 'invalidExchange':
          return 'そのカードは渡せない';
        case 'invalidChoice':
          return 'そのカードは選べない';
        case 'invalidAbility':
          return 'その特権は使えない';
        case 'abilityNotUsable':
          return 'いまは その特権を使えない';
        case 'cannotSkip':
          return 'この手には スキップを付けられません';
        default:
          return 'その操作はできなかった';
      }
    case 'staleMatch':
    case 'wrongPhase':
      return '行き違いになった。いまの状態に合わせた';
    case 'notHost':
      return 'ホストだけができる操作です';
    case 'invalidConfig':
      return 'その設定にはできない';
    case 'notJoined':
      return 'まだ参加していません';
    case 'roomFull':
      return '満員で入れません';
    case 'cannotJoin':
      return '試合の途中なので入れません';
    default:
      return 'その操作はできなかった';
  }
}
