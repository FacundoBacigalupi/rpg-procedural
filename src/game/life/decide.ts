// La decisión de los NPC (npc-psychology §7, Fase 3): cada hora, cada uno puntúa sus candidatas
// —las del catálogo desde lo que cree (`verbCandidates`) y las sociales desde sus relaciones—
// con las necesidades de su cuerpo, sus valores con el sesgo de su cultura y la etapa de su vida,
// y elige con softmax (`decideByUtility`, `rng.fork("decision", npc, tick)`). Lo elegido queda en
// `life.decision` y, si cambió el verbo o el objetivo, como evento `npc.decided` con su causa.
// El personaje del jugador no pasa por acá. Todavía no mueve el cuerpo: la rutina (`life.routine`)
// sigue siendo quien actúa; que la decisión se vuelva plan es el ítem siguiente.

import type { AgentId, EntityRef, PlaceRef, PlanetClock, Tick } from "../../core/index.ts";
import {
  type ActionCatalog,
  BELIEFS,
  type BeliefView,
  BODY_STATE,
  type BodyPlanDef,
  type BondDef,
  beliefConfidenceAt,
  believed,
  type Candidate,
  capabilitiesOf,
  type DimensionDef,
  decideByUtility,
  drivesFor,
  ENTITY,
  INNATE,
  LOCATION,
  MIND,
  PERSON,
  PLACE,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  type SchemaDef,
  SELF_IMAGES,
  SKILL_STATE,
  type SkillCatalog,
  type StageDef,
  seedSelfImage,
  setComponent,
  socialCandidates,
  stageAt,
  standardize,
  type Trait,
  table,
  temperOf,
  type ValueDef,
  valueBias,
  verbCandidates,
  villageCulture,
} from "../../sim/index.ts";

export const DECIDE_PROCESS = "life.decide";
export const DECIDED_EVENT = "npc.decided";

/** Lo último que eligió un NPC. */
export interface Decision {
  readonly at: Tick;
  readonly id: string;
  readonly verb: string;
  readonly target?: string;
  readonly utility: number;
  readonly options: number;
}

export const NPC_DECISION = table<Decision>("life.decision");

/** A cuántas personas considera como mucho (las que más conoce). */
export const MAX_KNOWN = 12;
/** Cuánta necesidad creída se le supone a quien no se sabe cómo está (sin calibrar). */
export const ASSUMED_NEED = 0.2;

export interface DecideOptions {
  readonly clock: PlanetClock;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly values: readonly ValueDef[];
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;

export function decideProcess(o: DecideOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: DECIDE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      BODY_STATE.name,
      PERSON.name,
      ENTITY.name,
      INNATE.name,
      MIND.name,
      RELATIONS.name,
      BELIEFS.name,
      LOCATION.name,
      PLACE.name,
      SELF_IMAGES.name,
      SKILL_STATE.name,
      NPC_DECISION.name,
      "culture.community",
    ],
    writes: [NPC_DECISION.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player) return {};
      const person = truth.get(PERSON, me);
      const body = truth.get(BODY_STATE, me);
      const mind = truth.get(MIND, me);
      const innate = truth.get(INNATE, me);
      if (!person || !body || !mind || !innate) return {};
      if (truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      if (body.death || body.consciousness === "unconscious") return {};
      const plan = plans.get(body.plan);
      if (!plan) throw new RangeError(`plan corporal desconocido: ${body.plan}`);

      const now = ctx.now;
      const age = (now - person.born) / o.clock.year;
      const culture = villageCulture(truth);
      const drives = drivesFor({
        plan,
        body,
        valueDefs: o.values,
        schemaDefs: o.schemas,
        mind,
        innate,
        bias: valueBias(culture?.prevalence["values.bias"]?.params ?? {}),
        stage: stageAt(o.stages, age),
      });

      // A quién conoce: relaciones, la casa y lo que cree que vive, los que más conoce primero.
      const rels = truth.get(RELATIONS, me);
      const beliefs = truth.get(BELIEFS, me);
      const relCtx = {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s: string) => mind.schemas[s]?.strength ?? 0,
      };
      const known = new Set<AgentId>(Object.keys(rels?.toward ?? {}) as AgentId[]);
      for (const b of beliefs?.items ?? []) {
        if (b.prop.attr === "alive" && b.value === true) known.add(b.prop.subject);
      }
      for (const id of truth.ids(ENTITY)) {
        if (!id.startsWith("agent:") || id === me) continue;
        if (truth.get(PERSON, id as AgentId)?.household === person.household) {
          known.add(id as AgentId);
        }
      }
      known.delete(me);
      const people = [...known]
        .filter((id) => {
          if (truth.get(ENTITY, id)?.endedAt === undefined) return true;
          // Murió y no lo sabe: sigue contando como vivo para él.
          const alive = believed(beliefs, id, "alive");
          return alive?.value === true && beliefConfidenceAt(alive, now) > 0.2;
        })
        .map((id) => ({ id, rel: relationship(rels, id, now, relCtx) }))
        .sort((a, b) => b.rel.dims.familiarity - a.rel.dims.familiarity || (a.id < b.id ? -1 : 1))
        .slice(0, MAX_KNOWN);
      const housemates = new Set(
        people
          .filter((p) => truth.get(PERSON, p.id)?.household === person.household)
          .map((p) => p.id),
      );

      const here = truth.get(LOCATION, me)?.hex ?? 0;
      const caps = capabilitiesOf(plan, body);
      const images = truth.get(SELF_IMAGES, me);
      const skills = truth.get(SKILL_STATE, me);
      const view: BeliefView = {
        hex: here,
        risk: {
          id: me as unknown as EntityRef,
          z: standardize(innate, o.traits, person.sex),
          scene: { light: 1, terrain: 0.1, placeKinds: [] },
        },
        capability: (cap) => Math.round(caps[cap] * 10) / 10,
        skill: (id) => {
          const def = o.skills.skill(id);
          const state = skills?.[id];
          const image =
            images?.[id] ?? (def && state ? seedSelfImage(def, state, {}, now) : undefined);
          return image?.estimate;
        },
        hexOf: (ref) => {
          const id = ref as unknown as AgentId;
          const b = believed(beliefs, id, "at");
          if (b && typeof b.value === "object") return b.value.hex;
          // Sin creencia, solo los de su casa se dan por ubicados donde la verdad los pone.
          if (housemates.has(id)) return truth.get(LOCATION, id)?.hex ?? null;
          return people.some((p) => p.id === id) ? null : undefined;
        },
        hexesOf: () => undefined,
        placeKindsAt: (hex) =>
          truth.ids(PLACE).flatMap((id) => {
            const p = truth.get(PLACE, id);
            return p?.hexes.includes(hex) ? [p.kind] : [];
          }),
        holds: (holder) => (holder === "self" ? true : undefined),
        nameOf: () => "alguien",
      };

      const candidates: Candidate[] = verbCandidates({
        catalog: o.catalog,
        view,
        persons: people.map((p) => p.id as unknown as EntityRef),
        places: [],
      });
      for (const p of people) {
        const confidence = (() => {
          const alive = believed(beliefs, p.id, "alive");
          return alive ? beliefConfidenceAt(alive, now) : 0.3;
        })();
        candidates.push(
          ...socialCandidates({
            target: p.id,
            dims: p.rel.dims,
            bonds: p.rel.bonds,
            belief: { need: ASSUMED_NEED, threat: Math.max(0, p.rel.dims.fear), confidence },
            means: { surplus: Math.max(0, 1 - (drives.needs.hunger ?? 0) * 2) },
          }),
        );
      }
      if (candidates.length === 0) return {};

      const choice = decideByUtility(
        candidates,
        drives,
        innate,
        temperOf(innate),
        ctx.rng.fork("decision", me, now),
      );
      if (!choice) return {};
      const c = choice.candidate;
      const decision: Decision = {
        at: now,
        id: c.id,
        verb: c.verb,
        ...(c.target === undefined ? {} : { target: c.target }),
        utility: r(choice.utility),
        options: candidates.length,
      };
      const prev = truth.get(NPC_DECISION, me);
      const changed = !prev || prev.verb !== c.verb || prev.target !== c.target;
      return {
        changes: [setComponent(NPC_DECISION, me, decision)],
        ...(changed
          ? {
              events: [
                {
                  kind: DECIDED_EVENT,
                  actors: [me],
                  place: o.placeOf(truth, me),
                  data: {
                    choice: c.id,
                    verb: c.verb,
                    ...(c.target === undefined ? {} : { target: c.target }),
                    utility: decision.utility,
                    options: candidates.length,
                    ...(prev ? { was: prev.id } : {}),
                  },
                  emissions: {},
                  causes: [{ kind: "state", entity: me, key: "utility" } as const],
                },
              ],
            }
          : {}),
      };
    },
  };
}
