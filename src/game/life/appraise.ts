// El appraisal de la vida (npc-psychology §3, Fase 2): lo que les pasa a los vecinos los marca según
// quiénes son. Al cerrar cada paso, quien peleó interpreta la pelea con su temperamento y sus
// esquemas, y la casa y la sangre de quien murió lo viven como pérdida; cada estímulo pasa por
// `form` y mueve los esquemas citando el evento. Quien lo vive lo sabe por haber estado ahí o por
// ser de la casa del muerto: los NPC todavía no perciben a distancia (Fase 3).
//
// No interpreta todavía el hambre ni la crianza, ni escribe cambios de relación.

import type { AgentId, Event, PlanetClock } from "../../core/index.ts";
import {
  appraiseFight,
  appraiseHardship,
  appraiseLoss,
  appraiseRearing,
  type BondDef,
  type DimensionDef,
  ENTITY,
  form,
  INNATE,
  MIND,
  type Mind,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  type SchemaDef,
  type StageDef,
  type StateChange,
  setComponent,
  stageAt,
} from "../../sim/index.ts";

export const APPRAISE_PROCESS = "life.appraise";

export interface AppraiseOptions {
  readonly clock: PlanetClock;
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
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
    reads: [MIND.name, INNATE.name, PERSON.name, ENTITY.name, RELATIONS.name],
    writes: [MIND.name],
    run(ctx) {
      const truth = ctx.truth;
      const minds = new Map<AgentId, Mind>();
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
      const rel = (from: AgentId, to: AgentId, e: Event) =>
        relationship(truth.get(RELATIONS, from), to, e.tick, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: (s) => truth.get(MIND, from)?.schemas[s]?.strength ?? 0,
        });
      for (const e of ctx.recent) {
        if (e.kind === "combat.fight" || e.kind === "combat.finish") {
          fightAppraisals(e, truth, apply, rel);
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
      const changes: StateChange[] = [...minds].map(([id, m]) => setComponent(MIND, id, m));
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
    apply(
      me,
      e,
      appraiseFight(
        {
          role,
          foe,
          worst: role === "victim" ? worstOn(me) : worstOn(foe),
          standing: standing(me),
          kin: r.bonds.length > 0,
        },
        truth.get(MIND, me) ?? { schemas: {}, formative: [], originEventId: e.id },
        truth.get(INNATE, me) ?? {},
      ),
    );
  }
}
