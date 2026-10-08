// El appraisal de la vida (npc-psychology §3, Fase 2): lo que les pasa a los vecinos los marca según
// quiénes son. Al cerrar cada paso, quien peleó interpreta la pelea con su temperamento y sus
// esquemas, y la casa y la sangre de quien murió lo viven como pérdida; cada estímulo pasa por
// `form` y mueve los esquemas citando el evento. Quien lo vive lo sabe por haber estado ahí o por
// ser de la casa del muerto: los NPC todavía no perciben a distancia (Fase 3).
//
// También lleva los hábitos: cada acción registrada los refuerza (`sim/mind/habits.ts`).
// También mueve las relaciones (`RELATIONS`) de quienes pelearon, remataron o perdonaron, y de
// quienes se dieron, comerciaron, se curaron, se fiaron, se devolvieron o no se pagaron.

import type { AgentId, Event, PlanetClock } from "../../core/index.ts";
import {
  applyDeltas,
  appraiseFight,
  appraiseHardship,
  appraiseLoss,
  appraiseRearing,
  type BondDef,
  contactGain,
  type Deltas,
  type DimensionDef,
  defaultDeltas,
  ENTITY,
  fightDeltas,
  finishDeltas,
  form,
  giveDeltas,
  HABITS,
  type HabitDef,
  habitsFed,
  INNATE,
  lendDeltas,
  MIND,
  type Mind,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relations,
  reinforceAll,
  relationship,
  repaidDeltas,
  type SchemaDef,
  type StageDef,
  type StateChange,
  setComponent,
  spareDeltas,
  stageAt,
  TALK_FAMILIARITY,
  tendDeltas,
  tradeDeltas,
} from "../../sim/index.ts";

import { creditRows } from "./credit.ts";

export const APPRAISE_PROCESS = "life.appraise";

export interface AppraiseOptions {
  readonly clock: PlanetClock;
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly habits: readonly HabitDef[];
}

/** Cercanía (0-1) de `from` hacia `to` leída de la relación: cariño, trato y dependencia. */
export function closeness(rel: ReturnType<typeof relationship>): number {
  const d = rel.dims;
  const x = 0.5 * Math.max(0, d.affection) + 0.3 * d.familiarity + 0.2 * d.dependency;
  return Math.min(1, Math.max(0, x));
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

export function appraiseProcess(o: AppraiseOptions): ProcessDef {
  return {
    id: APPRAISE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [MIND.name, INNATE.name, PERSON.name, ENTITY.name, RELATIONS.name, HABITS.name],
    writes: [MIND.name, HABITS.name, RELATIONS.name],
    run(ctx) {
      const truth = ctx.truth;
      const minds = new Map<AgentId, Mind>();
      const habits = new Map<AgentId, ReturnType<typeof reinforceAll>["habits"]>();
      const apply = (id: AgentId, e: Event, items: ReturnType<typeof appraiseLoss>) => {
        const person = truth.get(PERSON, id);
        const innate = truth.get(INNATE, id);
        const mind = minds.get(id) ?? truth.get(MIND, id);
        if (!person || !innate || !mind || items.length === 0) return;
        const stage = stageAt(o.stages, (e.tick - person.born) / o.clock.year);
        let next = mind;
        for (const a of items) {
          next = form(next, a.stimulus, { schemas: o.schemas, stage, innate, event: e.id }).mind;
        }
        minds.set(id, next);
      };
      const rels = new Map<AgentId, Relations>();
      const rel = (from: AgentId, to: AgentId, e: Event) =>
        relationship(rels.get(from) ?? truth.get(RELATIONS, from), to, e.tick, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: (s) => truth.get(MIND, from)?.schemas[s]?.strength ?? 0,
        });
      // Lo que `from` siente por `to` cambia por `deltas`; cita el evento. Quien no tenía fila la abre.
      const move = (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => {
        if (!alive(truth, from) || !truth.get(PERSON, from)) return;
        const base = rels.get(from) ??
          truth.get(RELATIONS, from) ?? { toward: {}, originEventId: e.id };
        const next = applyDeltas(rel(from, to, e), deltas, e.id);
        rels.set(from, { ...base, toward: { ...base.toward, [to]: { ...next, updated: e.tick } } });
      };
      for (const e of ctx.recent) {
        const fed = habitsFed(o.habits, e.kind);
        const doer = e.actors[0] as AgentId | undefined;
        if (fed.length > 0 && doer && alive(truth, doer) && truth.get(PERSON, doer)) {
          const r = reinforceAll(habits.get(doer) ?? truth.get(HABITS, doer), fed, e.tick, e.id);
          habits.set(doer, r.habits);
          // Un hábito que se asienta deja su marca, una sola vez, como un evento vivido.
          for (const def of r.settled) {
            if (def.stimulus) apply(doer, e, [{ stimulus: def.stimulus, blame: null }]);
          }
        }
        if (e.kind === "action.speak") talked(e, truth, rel, move);
        const lent = lentIn(e);
        if (lent) {
          move(lent.creditor, lent.debtor, e, lendDeltas("lender"));
          move(lent.debtor, lent.creditor, e, lendDeltas("borrower"));
        }
        if (e.kind === "combat.fight" || e.kind === "combat.finish") {
          fightAppraisals(e, truth, apply, rel, move);
        } else if (e.kind === "combat.spare") {
          const [sparer, spared] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (sparer && spared) {
            move(spared, sparer, e, spareDeltas("spared"));
            move(sparer, spared, e, spareDeltas("sparer"));
          }
        } else if (
          e.kind === "action.give" ||
          e.kind === "action.trade" ||
          e.kind === "action.tend"
        ) {
          dealings(e, truth, move);
        } else if (e.kind === "household.repaid") {
          const [debtor, creditor] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (debtor && creditor) {
            move(creditor, debtor, e, repaidDeltas("creditor"));
            move(debtor, creditor, e, repaidDeltas("debtor"));
          }
        } else if (e.kind === "law.default") {
          const [debtor, creditor] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (debtor && creditor) {
            const empty = { schemas: {}, formative: [], originEventId: e.id };
            move(
              creditor,
              debtor,
              e,
              defaultDeltas("creditor", truth.get(MIND, creditor) ?? empty),
            );
            move(debtor, creditor, e, defaultDeltas("debtor", empty));
          }
        } else if (e.kind === "mind.hardship") {
          const id = e.actors[0] as AgentId | undefined;
          const ratio = (e.data as { fatRatio?: number } | null)?.fatRatio;
          const mind = id ? truth.get(MIND, id) : undefined;
          if (id && mind && ratio !== undefined && alive(truth, id)) {
            apply(id, e, appraiseHardship(ratio, minds.get(id) ?? mind));
          }
        } else if (e.kind === "family.rearing") {
          const [id, by] = e.actors as [AgentId | undefined, AgentId | undefined];
          const data = (e.data ?? {}) as { care?: number; harsh?: number };
          const mind = id ? truth.get(MIND, id) : undefined;
          const innate = id ? truth.get(INNATE, id) : undefined;
          if (id && mind && innate && alive(truth, id)) {
            const facts = { caregiver: by ?? null, care: data.care ?? 0, harsh: data.harsh ?? 0 };
            apply(id, e, appraiseRearing(facts, minds.get(id) ?? mind, innate));
          }
        } else if (e.kind === "body.died") {
          const dead = e.actors[0] as AgentId | undefined;
          const home = dead ? truth.get(PERSON, dead)?.household : undefined;
          if (!dead || home === undefined) continue;
          for (const id of truth.ids(PERSON) as AgentId[]) {
            if (id === dead || !alive(truth, id) || truth.get(PERSON, id)?.household !== home) {
              continue;
            }
            const r = rel(id, dead, e);
            if (r.bonds.length === 0) continue;
            apply(id, e, appraiseLoss(closeness(r)));
          }
        }
      }
      const changes: StateChange[] = [
        ...[...minds].map(([id, m]) => setComponent(MIND, id, m)),
        ...[...habits].map(([id, h]) => setComponent(HABITS, id, h)),
        ...[...rels].map(([id, r]) => setComponent(RELATIONS, id, r)),
      ];
      return changes.length === 0 ? {} : { changes };
    },
  };
}

interface FightData {
  readonly outcomes?: Readonly<Record<string, string>>;
  readonly hits?: readonly { by?: string; to?: string; severity?: number }[];
}

function fightAppraisals(
  e: Event,
  truth: ReadonlyWorldTruth,
  apply: (id: AgentId, e: Event, items: ReturnType<typeof appraiseLoss>) => void,
  rel: (from: AgentId, to: AgentId, e: Event) => ReturnType<typeof relationship>,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const [first, second] = e.actors as [AgentId | undefined, AgentId | undefined];
  if (!first || !second) return;
  const data = (e.data ?? {}) as FightData;
  const worstOn = (id: AgentId) =>
    Math.max(0, ...(data.hits ?? []).filter((h) => h.to === id).map((h) => h.severity ?? 0));
  // Un remate (`combat.finish`) no trae el desenlace: el golpeado no está de pie.
  const standing = (id: AgentId) =>
    e.kind === "combat.fight" ? (data.outcomes?.[id] ?? "standing") === "standing" : id === first;
  const pairs: [AgentId, AgentId, "aggressor" | "victim"][] = [
    [first, second, "aggressor"],
    [second, first, "victim"],
  ];
  for (const [me, foe, role] of pairs) {
    if (!alive(truth, me)) continue;
    const r = rel(me, foe, e);
    const facts = {
      role,
      foe,
      worst: role === "victim" ? worstOn(me) : worstOn(foe),
      standing: standing(me),
      kin: r.bonds.length > 0,
    } as const;
    const mind = truth.get(MIND, me) ?? { schemas: {}, formative: [], originEventId: e.id };
    const innate = truth.get(INNATE, me) ?? {};
    apply(me, e, appraiseFight(facts, mind, innate));
    // Un remate no es una pelea: el que se rindió y lo golpearon lo vive como traición.
    move(
      me,
      foe,
      e,
      e.kind === "combat.finish" && role === "victim"
        ? finishDeltas()
        : fightDeltas(facts, mind, innate),
    );
  }
}

/** Una charla entregada: ambos se conocen un poco más, cada quien según lo que ya se conocía. */
function talked(
  e: Event,
  truth: ReadonlyWorldTruth,
  rel: (from: AgentId, to: AgentId, e: Event) => ReturnType<typeof relationship>,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const [a, b] = e.actors as [AgentId | undefined, AgentId | undefined];
  const eff = (e.data as { effect?: { kind?: string; delivered?: boolean } } | null)?.effect;
  if (!a || !b || a === b || eff?.kind !== "speak" || eff.delivered === false) return;
  if (!alive(truth, a) || !alive(truth, b)) return;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const gain = contactGain(TALK_FAMILIARITY, rel(from, to, e).dims.familiarity);
    if (gain > 0) move(from, to, e, { familiarity: gain });
  }
}

/** Un fiado concedido, de palabra (`action.speak`) o por el hogar (`household.borrowed`). */
function lentIn(e: Event): { creditor: AgentId; debtor: AgentId } | null {
  if (e.kind !== "action.speak" && e.kind !== "household.borrowed") return null;
  if (!(e.data as { credit?: unknown } | null)?.credit) return null;
  const [creditor, debtor] = e.actors as [AgentId | undefined, AgentId | undefined];
  return creditor && debtor ? { creditor, debtor } : null;
}

interface DealingData {
  readonly effect?: {
    readonly kind?: string;
    readonly to?: string;
    readonly with?: string;
    readonly target?: string;
    readonly good?: string | null;
    readonly grams?: number;
    readonly deal?: boolean;
    readonly edge?: number;
    readonly done?: boolean;
    readonly care?: number;
  };
}

/** Dar, comerciar y curar: lo que cada parte siente por la otra según lo que pasó de verdad. */
function dealings(
  e: Event,
  truth: ReadonlyWorldTruth,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const actor = e.actors[0] as AgentId | undefined;
  const eff = (e.data as DealingData | null)?.effect;
  if (!actor || !eff) return;
  if (eff.kind === "give" && eff.to && eff.good && (eff.grams ?? 0) > 0) {
    const to = eff.to as AgentId;
    // Era una devolución si el que da le debía (o le debió) algo de eso al que recibe.
    const repayment = creditRows(truth).some(
      (r) => r.credit.debtor === actor && r.credit.creditor === to && r.credit.unit === eff.good,
    );
    move(to, actor, e, giveDeltas("receiver", eff.grams ?? 0, repayment));
    move(actor, to, e, giveDeltas("giver", eff.grams ?? 0, repayment));
  } else if (
    eff.kind === "trade" &&
    eff.deal &&
    eff.with &&
    (eff as { direction?: string | null }).direction != null
  ) {
    const other = eff.with as AgentId;
    move(actor, other, e, tradeDeltas("actor", eff.edge ?? 0));
    move(other, actor, e, tradeDeltas("other", eff.edge ?? 0));
  } else if (eff.kind === "tend" && eff.done && eff.target && eff.target !== actor) {
    const cared = eff.target as AgentId;
    move(cared, actor, e, tendDeltas("cared", eff.care ?? 0));
    move(actor, cared, e, tendDeltas("carer", eff.care ?? 0));
  }
}
