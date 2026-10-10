// Reestructuración y ejecución de garantías (contracts §5, §13; economy §8): lo que se hace con un
// compromiso cuyo deudor cayó (ver `contagion.ts`). Reestructurar es renegociar: el acreedor da
// plazo y/o quita a cambio de algo y el compromiso viejo queda `settled` con uno nuevo que lo
// tiene de `parent`. Ejecutar es que el acreedor cobre de la garantía (colateral) hasta cubrir
// lo debido, sin llevarse más de lo que vale ni más de lo que se debe: lo que sale del colateral
// es lo que entra al saldo. Todo puro, sin RNG ni reloj; no toca ningún estado.

import { type Commitment, type CommitmentObligation, commitmentOwed } from "./commitment.ts";

const EPS = 1e-9;

export interface RestructureTerms {
  readonly day: number;
  readonly newId: string;
  /** Días que se alarga el vencimiento de lo que falta. */
  readonly extendDays: number;
  /** Fracción (0-1) del saldo que el acreedor perdona. */
  readonly forgive?: number;
  /** Lo que el deudor da a cambio (trabajo, prenda, aval...); queda en la historia. */
  readonly inReturn: string;
  readonly originEventId: string;
}

export interface RestructureOutcome {
  /** El compromiso viejo, cerrado como `settled`. */
  readonly old: Commitment;
  /** El nuevo, con el saldo recortado y los plazos corridos. */
  readonly next: Commitment;
  /** Cuánto se perdonó en total (en la unidad de las obligaciones). */
  readonly forgiven: number;
}

/** Renegocia: corre el plazo de lo pendiente y perdona una fracción; conserva el resto. */
export function restructure(c: Commitment, t: RestructureTerms): RestructureOutcome | null {
  if (c.status !== "active" && c.status !== "defaulted") return null;
  const cut = Math.min(1, Math.max(0, t.forgive ?? 0));
  let forgiven = 0;
  const obligations: CommitmentObligation[] = [];
  for (const o of c.obligations) {
    const owed = Math.max(0, o.duty.qty - o.performed);
    if (o.state === "fulfilled" || owed <= 0) {
      obligations.push(o);
      continue;
    }
    const drop = owed * cut;
    forgiven += drop;
    obligations.push({
      ...o,
      duty: { ...o.duty, qty: o.duty.qty - drop },
      dueDay: Math.max(o.dueDay, t.day) + Math.max(0, t.extendDays),
      state: o.performed > 0 ? "partial" : "pending",
    });
  }
  const endDay = Math.max(c.term.endDay, ...obligations.map((o) => o.dueDay));
  const next: Commitment = {
    ...c,
    id: t.newId,
    obligations,
    status: "active",
    term: { startDay: t.day, endDay },
    parent: c.id,
    originEventId: t.originEventId,
    history: [...c.history, `restructure:${t.day}:${t.inReturn}`],
  };
  return {
    old: { ...c, status: "settled", history: [...c.history, `restructured:${t.newId}`] },
    next,
    forgiven,
  };
}

export interface SeizeLine {
  readonly ref: string;
  /** Lo que se llevó de este colateral (en la unidad de la deuda). */
  readonly taken: number;
  /** Lo que queda de su valor (para devolverlo al deudor). */
  readonly left: number;
}

export interface SeizeOutcome {
  readonly commitment: Commitment;
  readonly lines: readonly SeizeLine[];
  readonly taken: number;
  /** Lo que sigue debiéndose tras ejecutar. */
  readonly remaining: number;
}

/**
 * El acreedor ejecuta los colaterales (en orden de la lista de garantías) hasta cubrir lo debido.
 * `values` da el valor de cada `ref` en la unidad de la deuda (lo ausente vale 0). Lo tomado se
 * abona a las obligaciones por orden de vencimiento; `taken` nunca pasa de lo debido ni de lo que
 * valen los colaterales. Los colaterales agotados salen de las garantías.
 */
export function seize(c: Commitment, values: ReadonlyMap<string, number>): SeizeOutcome {
  const owedBefore = commitmentOwed(c);
  let need = owedBefore;
  const lines: SeizeLine[] = [];
  const spent = new Set<string>();
  if (c.status === "active" || c.status === "defaulted") {
    for (const g of c.guarantees) {
      if (g.kind !== "collateral" || need <= EPS) continue;
      const value = Math.max(0, values.get(g.ref) ?? 0);
      if (value <= EPS) continue;
      const take = Math.min(value, need);
      need -= take;
      lines.push({ ref: g.ref, taken: take, left: value - take });
      if (value - take <= EPS) spent.add(g.ref);
    }
  }
  const taken = lines.reduce((s, l) => s + l.taken, 0);
  let credit = taken;
  const order = [...c.obligations].sort((a, b) => a.dueDay - b.dueDay);
  const paid = new Map<string, number>();
  for (const o of order) {
    const owed = Math.max(0, o.duty.qty - o.performed);
    const pay = Math.min(owed, credit);
    credit -= pay;
    paid.set(o.id, pay);
  }
  const obligations = c.obligations.map((o) => {
    const pay = paid.get(o.id) ?? 0;
    if (pay <= 0) return o;
    const performed = o.performed + pay;
    const done = performed >= o.duty.qty - EPS;
    return { ...o, performed, state: done ? ("fulfilled" as const) : ("partial" as const) };
  });
  const remaining = Math.max(0, owedBefore - taken);
  const status = taken <= 0 ? c.status : remaining <= EPS ? "fulfilled" : "defaulted";
  return {
    commitment: {
      ...c,
      obligations,
      status,
      guarantees: c.guarantees.filter((g) => g.kind !== "collateral" || !spent.has(g.ref)),
      history: taken > 0 ? [...c.history, `seized:${taken}`] : c.history,
    },
    lines,
    taken,
    remaining,
  };
}
