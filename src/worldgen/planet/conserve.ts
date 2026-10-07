// Repartos que conservan (causality §5): un total entero se divide por pesos con el método del
// resto mayor, así la suma de las partes es exactamente el total. Lo usan la esencia del nivel 0
// (el presupuesto del planeta entre celdas) y el nivel 1 (lo de una celda entre sus hijas).

/** Reparte `total` (entero ≥ 0) en partes enteras proporcionales a `weights`. Empate: índice menor. */
export function apportion(total: number, weights: ArrayLike<number>): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError(`total inválido: ${total}`);
  const n = weights.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i] as number;
    if (!(w >= 0 && Number.isFinite(w))) throw new RangeError(`peso inválido: ${w}`);
    sum += w;
  }
  const out = new Array<number>(n).fill(0);
  if (total === 0) return out;
  if (!(sum > 0)) throw new RangeError("todos los pesos son 0");
  const rest: { i: number; r: number }[] = [];
  let given = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * (weights[i] as number)) / sum;
    const base = Math.min(Math.floor(exact), total - given);
    out[i] = base;
    given += base;
    rest.push({ i, r: exact - base });
  }
  rest.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; given < total; k = (k + 1) % n) {
    const { i } = rest[k] as { i: number; r: number };
    if ((weights[i] as number) === 0) continue;
    out[i] = (out[i] as number) + 1;
    given++;
  }
  return out;
}
