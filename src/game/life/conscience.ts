// La culpa en el juego (law §15, npc-psychology §11): quien lastimó, robó o dejó de pagar lo sabe,
// lo haya visto alguien o no. `life.appraise` anota el hecho propio (`OWN_DEEDS`) y abre la
// condición de culpa (pesadilla y ánimo); este proceso diario pesa la culpa con `guiltOf` y decide
// con `respondToGuilt` qué hace con ella (evitar a la víctima, querer reparar, confesar si le
// preguntan, desviar), y lo deja en `AMENDS` con un evento que cita el hecho. Quien contesta una
// acusación o un interrogatorio lee esa decisión. El personaje del jugador pasa por lo mismo: la
// culpa sale de lo que hizo y de cómo es, no de un menú.

import type { AgentId, Event, PlaceRef, Tick } from "../../core/index.ts";
import {
  AMENDS,
  type Amends,
  BODY_STATE,
  type BondDef,
  COMMUNITY_RELIGION,
  type Conscience,
  clampTemper,
  type DimensionDef,
  ENTITY,
  type EventDraft,
  heaviestGuilt,
  INNATE,
  KNOWN_DEEDS,
  MIND,
  OWN_DEEDS,
  type OwnDeed,
  PERSON,
  type ProcessDef,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  relationship,
  respondToGuilt,
  type SchemaDef,
  type StateChange,
  sanctionWeight,
  setComponent,
  standardize,
  type Trait,
  type ValueDef,
  valuesOf,
  villageReligion,
} from "../../sim/index.ts";
import { offenseOf } from "./deeds.ts";

export const CONSCIENCE_PROCESS = "life.conscience";
export const REMORSE_EVENT = "mind.remorse";

export interface ConscienceOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly traits: readonly Trait[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Valores y esquemas: sin ellos la conciencia solo sale del temperamento. */
  readonly values?: readonly ValueDef[];
  readonly schemas?: readonly SchemaDef[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Cuánto de los valores de alguien es moral (justicia y tradición) en el reparto promedio. */
const MORAL_VALUE_BASE = 0.2;
/** Cuánto mueve el peso moral que justicia + tradición pasen o no del promedio. */
const VALUE_MORAL_WEIGHT = 0.5;
/** Cuánto suma la sanción creída del tabú de la religión que alcanza al bien robado. */
const TABOO_MORAL_WEIGHT = 0.4;

/**
 * El peso moral de un hecho para quien lo hizo (npc-psychology §11): el temperamento, sus valores
 * (justicia y tradición, ya con el sesgo de su cultura en el reparto) y la sanción creída del tabú
 * de su religión sobre el bien tomado. Puro.
 */
export function moralWeightOf(parts: {
  readonly warmth: number;
  readonly willpower: number;
  /** Justicia + tradición del reparto normalizado de valores (0-1); null si no se conoce. */
  readonly moralShare: number | null;
  /** Penalidad del tabú creída (0-1), 0 si no hay tabú. */
  readonly taboo: number;
}): number {
  const temper = 0.2 * clampTemper(parts.warmth) + 0.15 * clampTemper(parts.willpower);
  const values =
    parts.moralShare === null ? 0 : VALUE_MORAL_WEIGHT * (parts.moralShare - MORAL_VALUE_BASE);
  return clamp01(0.5 + temper + values + TABOO_MORAL_WEIGHT * parts.taboo);
}

/** Daño de un hecho propio cuando el evento no lo mide (constantes sin calibrar). */
const HARM = { theft: 0.4, default: 0.3 } as const;
/** Cuánto de la excusa le da el rencor que ya le tenía a la víctima. */
const GRUDGE_EXCUSE = 0.6;

/** El bien de un robo (la primera unidad agarrada), si el evento es una toma. */
function goodOf(e: Event): { good: string } | Record<string, never> {
  const got = (e.data as { effect?: { kind?: string; got?: readonly { unit?: string }[] } } | null)
    ?.effect;
  const unit = got?.kind === "take" ? got.got?.[0]?.unit : undefined;
  return unit ? { good: unit } : {};
}

/** Un hecho propio en `e`, de quien lo hizo: null si el evento no es un delito. */
export function ownDeedOf(
  truth: ReadonlyWorldTruth,
  e: Event,
): { by: AgentId; deed: OwnDeed; fatal: boolean } | null {
  const off = offenseOf(e);
  if (!off) return null;
  // Lo que se toma dentro de la casa es de la familia, no un robo (igual que la aldea).
  const home = (id: AgentId) => truth.get(PERSON, id)?.household;
  if (off.kind === "theft" && home(off.by) === home(off.victim)) return null;
  let harm: number =
    off.kind === "assault" ? 0.3 : HARM[off.kind === "theft" ? "theft" : "default"];
  let fatal = false;
  if (off.kind === "assault") {
    const data = (e.data ?? {}) as {
      outcomes?: Readonly<Record<string, string>>;
      hits?: readonly { to?: string; severity?: number }[];
    };
    const worst = Math.max(
      0,
      ...(data.hits ?? []).filter((h) => h.to === off.victim).map((h) => h.severity ?? 0),
    );
    harm = Math.max(0.3, worst);
    fatal =
      e.kind === "combat.fight"
        ? data.outcomes?.[off.victim] === "dead"
        : truth.get(BODY_STATE, off.victim)?.death != null;
    if (fatal) harm = 1;
  }
  return {
    by: off.by,
    deed: { kind: off.kind, victim: off.victim, at: e.tick, event: e.id, harm, ...goodOf(e) },
    fatal,
  };
}

function moralShareOf(
  truth: ReadonlyWorldTruth,
  o: Pick<ConscienceOptions, "values" | "schemas">,
  by: AgentId,
  innate: Parameters<typeof valuesOf>[3] | undefined,
): number | null {
  const mind = truth.get(MIND, by);
  if (!o.values || o.values.length === 0 || !mind || !innate) return null;
  const v = valuesOf(o.values, o.schemas ?? [], mind, innate);
  return (v["justice"] ?? 0) + (v["tradition"] ?? 0);
}

/** La conciencia de `by` ante `d` hoy: de quién es, cuánto quería a la víctima y cuánto teme que se sepa. */
export function conscienceOf(
  truth: ReadonlyWorldTruth,
  o: Pick<ConscienceOptions, "dims" | "bonds" | "traits" | "values" | "schemas">,
  by: AgentId,
  d: OwnDeed,
  now: Tick,
  fearOfExposure = 0,
): Conscience {
  const innate = truth.get(INNATE, by);
  const z = innate ? standardize(innate, o.traits, truth.get(PERSON, by)?.sex ?? "female") : {};
  const rel = relationship(truth.get(RELATIONS, by), d.victim, now, {
    dims: o.dims,
    bonds: o.bonds,
    schemaStrength: (s) => truth.get(MIND, by)?.schemas[s]?.strength ?? 0,
  });
  return {
    // Misma cercanía que `closeness` de appraise (cariño, trato y dependencia), sin el ciclo.
    bondToVictim: clamp01(
      0.5 * Math.max(0, rel.dims.affection) +
        0.3 * rel.dims.familiarity +
        0.2 * rel.dims.dependency,
    ),
    moralWeight: moralWeightOf({
      warmth: z["warmth"] ?? 0,
      willpower: z["willpower"] ?? 0,
      moralShare: moralShareOf(truth, o, by, innate),
      taboo: d.good
        ? sanctionWeight(truth.get(RELIGIOUS_IDENTITY, by), villageReligion(truth), d.good).penalty
        : 0,
    }),
    justification: clamp01(GRUDGE_EXCUSE * rel.dims.resentment),
    fearOfExposure: clamp01(fearOfExposure),
  };
}

/** Miedo a que se sepa: la fracción de la aldea que ya sabe quién fue (0-1). */
export function exposureOf(truth: ReadonlyWorldTruth, by: AgentId, event: string): number {
  const ids = truth.ids(KNOWN_DEEDS);
  if (ids.length === 0) return 0;
  let aware = 0;
  for (const id of ids) {
    if (id === by) continue;
    if (truth.get(KNOWN_DEEDS, id)?.deeds.some((x) => x.event === event && x.by === by)) aware++;
  }
  return clamp01(aware / 3);
}

/** Se puede reparar si es un robo o una deuda y la víctima sigue viva. */
function canRepair(truth: ReadonlyWorldTruth, d: OwnDeed): boolean {
  return (
    (d.kind === "theft" || d.kind === "default") &&
    truth.get(ENTITY, d.victim)?.endedAt === undefined
  );
}

export function conscienceProcess(o: ConscienceOptions): ProcessDef {
  return {
    id: CONSCIENCE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      OWN_DEEDS.name,
      KNOWN_DEEDS.name,
      RELATIONS.name,
      MIND.name,
      INNATE.name,
      PERSON.name,
      ENTITY.name,
      COMMUNITY_RELIGION.name,
      RELIGIOUS_IDENTITY.name,
    ],
    writes: [AMENDS.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const raw of truth.ids(OWN_DEEDS)) {
        const me = raw as AgentId;
        if (truth.get(ENTITY, me)?.endedAt !== undefined || !truth.get(PERSON, me)) continue;
        const own = truth.get(OWN_DEEDS, me);
        const worst = heaviestGuilt(
          own,
          (d) => conscienceOf(truth, o, me, d, ctx.now, exposureOf(truth, me, d.event)),
          ctx.now,
        );
        if (!worst) continue;
        const before = truth.get(AMENDS, me);
        const d = worst.deed;
        const response = respondToGuilt(
          worst.guilt,
          conscienceOf(truth, o, me, d, ctx.now, exposureOf(truth, me, d.event)),
          canRepair(truth, d),
          ctx.rng.fork("conscience", me, d.event, Math.floor(ctx.now / 86_400)),
        );
        const prev = before?.byDeed[d.event]?.response;
        const next: Amends = {
          byDeed: {
            ...(before?.byDeed ?? {}),
            [d.event]: { response, guilt: Math.round(worst.guilt * 1000) / 1000, decided: ctx.now },
          },
        };
        changes.push(setComponent(AMENDS, me, next));
        if (response !== prev && response !== "none") {
          events.push({
            kind: REMORSE_EVENT,
            actors: [me, d.victim],
            place: o.placeOf(truth, me),
            data: { response, guilt: worst.guilt, deed: d.event, kind: d.kind },
            emissions: {},
            causes: [{ kind: "event", event: d.event }],
          });
        }
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
