// Cobertura dirigida de préstamos con garantía, promesas y contratación (perfil2c-rescue-loans).
// Opt-in del tooling: sin `rescue` el perfil completo no cambia. No inventa estado: los préstamos
// son `loanSeeds` entre hogares que existen, con el grano que ya tienen, y lo demás son planes
// legales del personaje (`hire`, `speak` con promesa) por el mismo `Life.turn` que usa el jugador.
import type { AgentId, HolderRef } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import type { Life, LifeOptions } from "../../game/index.ts";
import { type ActionPlan, ENTITY, PERSON, type ReadonlyWorldTruth } from "../../sim/index.ts";

type Seeds = NonNullable<LifeOptions["loanSeeds"]>;

/** Hogares con alguien vivo, en orden de id (misma regla que `householdsOf`, sin importar internos). */
export function livingHouseholds(truth: ReadonlyWorldTruth): string[] {
  const homes = new Set<string>();
  for (const id of truth.ids(PERSON)) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const home = truth.get(PERSON, id)?.household;
    if (home !== undefined) homes.add(home);
  }
  return [...homes].sort();
}

/**
 * Un préstamo de grano que el deudor no puede devolver con interés: el más rico presta una cuarta
 * parte de su grano al más pobre, a interés 300 % y 20 días, con una prenda de grano que el deudor
 * ya tiene y el tercero más rico de fiador. Vence en mora: ejecución de la prenda, fiador, subrogación
 * y servidumbre. Todo sale de saldos reales del libro mayor; null si no hay tres hogares con grano.
 */
export function rescueLoanSeeds(life: Pick<Life, "world">): Seeds | null {
  const { truth, ledger } = life.world;
  const grain = (home: string) =>
    ledger
      .holdings(holderAccount(home as unknown as HolderRef))
      .filter((h) => String(h.unit) === "good:grain")
      .reduce((sum, h) => sum + h.amount, 0);
  const ranked = livingHouseholds(truth)
    .map((home) => ({ home, grain: grain(home) }))
    .filter((h) => h.grain > 0)
    .sort((a, b) => b.grain - a.grain || a.home.localeCompare(b.home));
  const lender = ranked[0];
  const guarantor = ranked[1];
  const borrower = ranked[ranked.length - 1];
  if (ranked.length < 3 || !lender || !guarantor || !borrower) return null;
  const principal = Math.floor(lender.grain / 4);
  const pledged = Math.max(1, Math.floor(borrower.grain / 2));
  return [
    {
      id: "rescue-1",
      lender: lender.home,
      borrower: borrower.home,
      good: "grain",
      principal,
      rate: 3,
      startDay: 1,
      termDays: 20,
      collateral: [
        {
          ref: "lot:rescue-1",
          believedValue: pledged,
          trueValue: pledged,
          heldBy: borrower.home,
          lot: { unit: "good:grain", amount: pledged },
        },
      ],
      guarantors: [{ household: guarantor.home, share: 0.5 }],
    },
  ];
}

const plan = (
  actor: AgentId,
  verb: string,
  args: Extract<ActionPlan["root"], { kind: "do" }>["args"],
): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb, args, manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

/**
 * Los turnos dirigidos del personaje con quienes comparten su casa: contratar (se reintenta con
 * otro conviviente si el oficio sale torpe, que es una falla con forma, no un error) y prometer
 * grano (se reintenta si el oyente entendió mal la cantidad: sin gramos entendidos no hay promesa).
 * Devuelve los planes ejecutados, para el reporte de reproducción.
 */
export function runRescueTurns(life: Life, maxTries = 6): ActionPlan[] {
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const mates = w.truth
    .ids(PERSON)
    .filter(
      (id) =>
        id !== me &&
        w.truth.get(PERSON, id)?.household === home &&
        w.truth.get(ENTITY, id)?.endedAt === undefined,
    )
    .sort() as AgentId[];
  const done: ActionPlan[] = [];
  let seq = 1;
  const attempt = (
    make: (who: AgentId) => ActionPlan,
    ok: (events: readonly { data: unknown; kind: string }[]) => boolean,
  ) => {
    for (const who of mates.slice(0, maxTries)) {
      const p = make(who);
      const report = life.turn(p, seq++);
      done.push(p);
      if (!life.alive) return;
      if (ok(report.events)) return;
    }
  };
  const effectOf = (e: { data: unknown }) =>
    (e.data as { failure?: unknown; effect?: { pledge?: { grams?: number | null } } } | null) ?? {};
  attempt(
    (who) =>
      plan(me, "hire", [
        { role: "who", entity: who },
        { role: "what", text: "ayudar con la cosecha" },
      ]),
    (events) => events.some((e) => e.kind === "action.hire" && effectOf(e).failure == null),
  );
  if (!life.alive) return done;
  attempt(
    (who) =>
      plan(me, "speak", [
        { role: "to", entity: who },
        { role: "content", text: "Te prometo 2 kilos de grano" },
      ]),
    (events) => events.some((e) => (effectOf(e).effect?.pledge?.grams ?? 0) > 0),
  );
  return done;
}

export const RESCUE_PROCESSES = ["life.loans", "life.pledge", "life.hire"] as const;
