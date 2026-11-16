// JSON にできる値の深いコピー（structuredClone は lib の型に無いため手で書く）。

export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deepClone(x)) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out as T;
}
