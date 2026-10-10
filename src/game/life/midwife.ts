// Partera en los partos (body-health §6, family-lineage §3): cuando le llega la hora a una
// parturienta (`Labor`, de un embarazo que alguien sembró), su hogar decide si llamar a alguien con
// habilidad de curar según lo que CREE del riesgo (el riesgo sin ayuda que estima, más su
// precaución, contra un umbral) y elige a la partera por la fama que cree de cada una (prior 0,5).
// El parto lo resuelve `birthRisk`/`resolveBirth` con la habilidad real de la partera (0-1) y un
// `Rng` con clave (madre, hora): la partera baja las complicaciones y la muerte de la madre y del
// niño. Cobra `healerFee` con asiento al ledger si hay bolsa; si no, asiste igual. Deja una fila en
// `LABOR` (único escritor `life.labor`) y eventos con causas; si la madre muere, termina su entidad.
// Opt-in: sin `labors` el proceso no hace nada (sin filas, RNG ni eventos).

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  type BirthInputs,
  birthRisk,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  type PathogenDef,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  resolveBirth,
  SKILL_STATE,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import type { PathogenSeed } from "./exposure.ts";
import { healerFee, healingSkill } from "./medicine.ts";

export const LABOR_PROCESS = "life.labor";

/** Un embarazo a término: quién pare y cuándo; el resto son entradas de `birthRisk` con valores por defecto. */
export interface Labor {
  readonly mother: AgentId;
  /** Tick desde el que se pone de parto. */
  readonly dueAt: Tick;
  /** Partos previos (por defecto 1). */
  readonly parity?: number;
  /** 0-1: dificultad intrínseca (por defecto 0,2). */
  readonly difficulty?: number;
  /** 0-1 (por defecto 0,7). */
  readonly nutrition?: number;
  readonly health?: number;
  /** 0-1 (por defecto 0,5). */
  readonly hygiene?: number;
  readonly supplies?: number;
}

/** Lo que quedó del último parto de una madre. */
export interface LaborRow {
  readonly dueAt: Tick;
  readonly at: Tick;
  readonly midwife: AgentId | null;
  /** El hogar la llamó por lo que creía del riesgo. */
  readonly called: boolean;
  /** El riesgo de complicación que el hogar creía sin ayuda (creencia). */
  readonly believedRisk: number;
  readonly complication: boolean;
  readonly motherDied: boolean;
  readonly infantDied: boolean;
  readonly fever: boolean;
  readonly paid: number;
  readonly cause: string;
}

export const LABOR = table<LaborRow>("life.labor");

export interface LaborOptions {
  readonly clock: PlanetClock;
  readonly labors: readonly Labor[];
  /** Habilidad de `medicine` desde la que alguien puede asistir (por defecto 0,2). */
  readonly minSkill?: number;
  /** Riesgo de complicación creído desde el cual se llama a la partera (por defecto 0,12). */
  readonly callAbove?: number;
  /** Miedo del hogar: se suma al riesgo creído (por defecto 0). */
  readonly caution?: number;
  /** Opt-in: cobro de la partera con asiento (`healerFee`); la fama la cree la parturienta. */
  readonly fee?:
    | {
        readonly unit: LedgerUnit;
        readonly base: number;
        readonly renownOf: (
          truth: ReadonlyWorldTruth,
          mother: AgentId,
          healer: AgentId,
        ) => number | undefined;
      }
    | undefined;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function laborProcess(o: LaborOptions): ProcessDef {
  return {
    id: LABOR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SKILL_STATE.name,
      ENTITY.name,
      PERSON.name,
      LABOR.name,
      ...(o.fee ? ["law.mold_rumors"] : []),
    ],
    writes: [LABOR.name, ENTITY.name],
    run(ctx) {
      if (o.labors.length === 0) return {};
      const alive = (a: AgentId) =>
        ctx.truth.get(ENTITY, a as unknown as EntityRef)?.endedAt === undefined;
      const due = o.labors
        .filter((l) => l.dueAt <= ctx.now)
        .filter((l) => alive(l.mother))
        .filter(
          (l) => (ctx.truth.get(LABOR, l.mother as unknown as EntityRef)?.dueAt ?? -1) < l.dueAt,
        )
        .sort((a, b) => a.dueAt - b.dueAt || (a.mother < b.mother ? -1 : 1));
      if (due.length === 0) return {};

      const min = o.minSkill ?? 0.2;
      const pool: { agent: AgentId; skill: number }[] = [];
      for (const id of ctx.truth.ids(SKILL_STATE)) {
        const agent = id as AgentId;
        if (!alive(agent)) continue;
        const skill = healingSkill(ctx.truth.get(SKILL_STATE, id)?.["medicine"]);
        if (skill >= min) pool.push({ agent, skill });
      }
      pool.sort((a, b) => b.skill - a.skill || (a.agent < b.agent ? -1 : 1));

      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const busy = new Set<AgentId>();
      const reserved = new Map<string, number>();
      for (const l of due) {
        const id = l.mother as unknown as EntityRef;
        const person = ctx.truth.get(PERSON, id);
        const ageYears = person ? (ctx.now - person.born) / o.clock.year : 25;
        const inputs = {
          motherAgeYears: ageYears,
          nutrition: l.nutrition ?? 0.7,
          health: l.health ?? 0.7,
          parity: l.parity ?? 1,
          hygiene: l.hygiene ?? 0.5,
          supplies: l.supplies ?? 0.3,
          difficulty: l.difficulty ?? 0.2,
        };
        // Lo que el hogar cree: el riesgo sin ayuda que estima (más su miedo) contra el umbral.
        const believedRisk = round3(
          Math.min(1, birthRisk({ ...inputs, midwifeSkill: null }).complication + (o.caution ?? 0)),
        );
        const wants = believedRisk >= (o.callAbove ?? 0.12);
        const free = pool.filter((p) => p.agent !== l.mother && !busy.has(p.agent));
        const believed = (p: { agent: AgentId }) =>
          o.fee?.renownOf(ctx.truth, l.mother, p.agent) ?? 0.5;
        const pick = wants
          ? o.fee
            ? [...free].sort((a, b) => believed(b) - believed(a) || (a.agent < b.agent ? -1 : 1))[0]
            : free[0]
          : undefined;
        if (pick) busy.add(pick.agent);
        const midwifeSkill = pick ? pick.skill : null;
        const out = resolveBirth(
          birthRisk({ ...inputs, midwifeSkill } satisfies BirthInputs),
          ctx.rng.fork("labor", l.mother, l.dueAt),
        );
        const k = events.length;
        let paid = 0;
        if (pick && o.fee && ctx.ledger) {
          const owed = Math.round(healerFee(o.fee.base, pick.skill, believed(pick)));
          const acc = holderAccount(l.mother as unknown as HolderRef);
          const used = reserved.get(`${acc}|${o.fee.unit}`) ?? 0;
          if (owed > 0 && ctx.ledger.balance(acc, o.fee.unit) - used >= owed) {
            reserved.set(`${acc}|${o.fee.unit}`, used + owed);
            postings.push({
              event: draftEvent(k),
              transfers: [
                {
                  unit: o.fee.unit,
                  from: acc,
                  to: holderAccount(pick.agent as unknown as HolderRef),
                  amount: owed,
                },
              ],
            });
            paid = owed;
          }
        }
        events.push({
          kind: "body.labor",
          actors: pick ? [l.mother, pick.agent] : [l.mother],
          place: o.placeOf(ctx.truth, l.mother),
          data: {
            midwife: pick?.agent ?? null,
            called: pick !== undefined,
            believedRisk,
            complication: out.complication,
            motherDied: out.motherDied,
            infantDied: out.infantDied,
            fever: out.fever,
            ...(o.fee ? { paid } : {}),
          },
          emissions: { sight: 0.2, sound: 0.4 },
          causes: [{ kind: "state", entity: l.mother, key: "family.person" }],
        });
        if (out.motherDied) {
          events.push({
            kind: "body.died",
            actors: [l.mother],
            place: o.placeOf(ctx.truth, l.mother),
            data: { cause: "childbirth", midwife: pick?.agent ?? null },
            emissions: { sight: 0.5, sound: 0.3 },
            causes: [{ kind: "event", event: draftEvent(k) }],
          });
          const base = ctx.truth.get(ENTITY, id);
          if (base) changes.push(endEntity(base, draftEvent(events.length - 1), ctx.now));
        }
        changes.push(
          setComponent(LABOR, id, {
            dueAt: l.dueAt,
            at: ctx.now,
            midwife: pick?.agent ?? null,
            called: pick !== undefined,
            believedRisk,
            complication: out.complication,
            motherDied: out.motherDied,
            infantDied: out.infantDied,
            fever: out.fever,
            paid,
            cause: draftEvent(k),
          }),
        );
      }
      return { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}

/**
 * Fiebre puerperal como patógeno (body-health §6): no pasa entre personas (sin rutas), incuba
 * poco y mata más sin cuidado. Calibración abierta.
 */
export const PUERPERAL_FEVER: PathogenDef = {
  id: "puerperal_fever",
  routes: {},
  incubationHours: 36,
  courseHours: 240,
  contagiousFrom: 1,
  transmissibility: 0,
  lethality: 0.35,
  immunity: "none",
  immunityHours: 0,
};

/**
 * Semilla de infección para `life.exposure` (opt-in, vía `arrivals`): la primera madre cuyo parto
 * dejó `fever` (tirada ya hecha en `resolveBirth` según higiene y partera) y que sigue viva,
 * con el evento del parto como causa. Pura: sin RNG ni IO. `exposure` introduce un patógeno una
 * sola vez por definición, así que siembra el primer caso; los siguientes quedan abiertos.
 */
export function puerperalSeed(
  truth: ReadonlyWorldTruth,
  def: PathogenDef = PUERPERAL_FEVER,
): PathogenSeed | null {
  let best: { mother: AgentId; row: LaborRow } | null = null;
  for (const id of truth.ids(LABOR)) {
    const row = truth.get(LABOR, id);
    if (!row?.fever || row.motherDied) continue;
    const mother = id as unknown as AgentId;
    if (!best || row.at < best.row.at || (row.at === best.row.at && mother < best.mother)) {
      best = { mother, row };
    }
  }
  if (!best) return null;
  return {
    def,
    carrier: best.mother,
    from: best.row.at,
    source: "fiebre tras el parto",
    causes: [{ kind: "event", event: best.row.cause as never }],
  };
}
