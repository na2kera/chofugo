// 階段（decisions §6.8）。認識そのものは hand.ts にあり、このモジュールは形を有効にするだけ。

import type { RuleModule } from './types.ts';

export const runs: RuleModule = {
  id: 'runs',
  shapes: ['run'],
};
