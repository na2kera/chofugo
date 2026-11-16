// Origin の確認（design §4.5）。Worker の実行環境に依存しない関数だけを置く（単体テストのため）。

/**
 * - Origin が付いていれば、scheme・ホスト・ポートを含めて自分のサイト（リクエストの origin）と一致するときだけ通す。
 * - Origin が付いていなければ通す（ブラウザ以外は付けないことがある。別の条件として server-assumptions.md C5 に記録）。
 */
export function originAllowed(origin: string | null, requestUrl: URL): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}
