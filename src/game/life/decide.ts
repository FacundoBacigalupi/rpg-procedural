// La decisión de los NPC (npc-psychology §7, Fase 3): cada día (cada hora en escena), cada uno puntúa sus candidatas
// —las del catálogo desde lo que cree (`verbCandidates`) y las sociales desde sus relaciones—
// con las necesidades de su cuerpo, sus valores con el sesgo de su cultura y la etapa de su vida,
// y elige con softmax (`decideByUtility`, `rng.fork("decision", npc, tick)`). Lo elegido queda en
// `life.decision` y, si cambió el verbo o el objetivo, como evento `npc.decided` con su causa.
// El personaje del jugador no pasa por acá. Todavía no mueve el cuerpo: la rutina (`life.routine`)
// sigue siendo quien actúa; que la decisión se vuelva plan es el ítem siguiente.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  type ActionCatalog,
  AMPUTATIONS,
  applyAcute,
  BELIEFS,
  type BeliefView,
  BODY_STATE,
  type BodyPlanDef,
  type BondDef,
  beliefConfidenceAt,
  believed,
  type Candidate,
  capabilitiesOf,
  closeness,
  coreGoals,
  DEFICIENCY_EFFECTS,
  type DimensionDef,
  decideByUtility,
  drivesFor,
  ENTITY,
  FROSTBITE,
  type Goal,
  type GoodDef,
  GROWTH_SEQUELAE,
  goalChanges,
  goalDrives,
  goodUnit,
  HABITS,
  type HabitDef,
  INNATE,
  kinWeight,
  LOCATION,
  layerDrives,
  longGoals,
  MEMORIES,
  MENTAL,
  MIND,
  mediumGoals,
  mergeCandidates,
  modifyCandidates,
  moodFrom,
  otherBeliefFrom,
  PERSON,
  PLACE,
  type ProcessDef,
  pantryTexts,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  reconcileGoals,
  relationship,
  revengeGoals,
  type SchemaDef,
  SELF_IMAGES,
  SKILL_STATE,
  type SkillCatalog,
  STAKES_RISK,
  type StageDef,
  sanctionFor,
  sanctionWeight,
  seedSelfImage,
  setComponent,
  shortGoals,
  socialCandidates,
  stageAt,
  standardize,
  type Trait,
  table,
  temperOf,
  type ValueDef,
  valueBias,
  verbCandidates,
  verbHabits,
  villageCulture,
  villageReligion,
} from "../../sim/index.ts";
import { applyAltitude } from "./altitude.ts";
import { applyDeficiency } from "./deficiencyCaps.ts";
import { acuteOf, type ConsumableDef } from "./substances.ts";
import { applyFrostbite } from "./thermal.ts";

export const DECIDE_PROCESS = "life.decide";
export const DECIDED_EVENT = "npc.decided";
export const GOAL_EVENT = "npc.goal";

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

/** Los objetivos vigentes de un NPC (núcleo y venganza, `sim/mind/goals.ts`). */
export interface NpcGoals {
  readonly items: readonly Goal[];
}

export const NPC_GOALS = table<NpcGoals>("life.goals");

/** A cuántas personas considera como mucho (las que más conoce). */
export const MAX_KNOWN = 12;
/** Cuánto afecto/parentesco (`closeness`) hace que alguien le importe (sin calibrar). */
export const CARES_MIN = 0.3;

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
  /** Bienes del mundo: con ellos los verbos con `what` nombran lo que hay en la despensa. */
  readonly goods?: readonly GoodDef[];
  /** Definiciones de hábitos: los asentados empujan su verbo en la utilidad. */
  readonly habits?: readonly HabitDef[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Opt-in: la altura baja la resistencia creída (`applyAltitude`); apagado, no cambia. */
  readonly altitudeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Opt-in: la congelación y las amputaciones bajan manos y pies (`applyFrostbite`); apagado, no cambia. */
  readonly frostbite?: boolean;
  /** Opt-in: carencias (`vigor`, `oxygen`, `cognition`) y secuela cognitiva bajan las capacidades (`applyDeficiency`); apagado, no cambia. */
  readonly nutritionCaps?: boolean;
  /**
   * Opt-in: sustancias de consumo que tiene en la despensa que cree tener: el verbo `consume`
   * las nombra y el ansia (`serves: craving`) lo empuja. Apagado, no hay candidata nueva.
   */
  readonly consumables?: readonly ConsumableDef[];
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;

export function decideProcess(o: DecideOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: DECIDE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "day", scene: "hour" },
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
      MEMORIES.name,
      HABITS.name,
      MENTAL.name,
      LOCATION.name,
      ACCLIMATIZATION.name,
      DEFICIENCY_EFFECTS.name,
      GROWTH_SEQUELAE.name,
      FROSTBITE.name,
      AMPUTATIONS.name,
      PLACE.name,
      SELF_IMAGES.name,
      SKILL_STATE.name,
      NPC_DECISION.name,
      NPC_GOALS.name,
      "culture.community",
    ],
    writes: [NPC_DECISION.name, NPC_GOALS.name],
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

      // El ánimo sale de su memoria (e3): el miedo de lo que le dolió hace poco y las horas desde
      // que estuvo con alguien que le importa (si hay alguien así acá ahora, no está solo).
      const memories = truth.get(MEMORIES, me);
      const cared = new Set(
        people.filter((p) => closeness(p.rel.dims, p.rel.bonds) >= CARES_MIN).map((p) => p.id),
      );
      const acute = acuteOf(truth, me);
      const mood = {
        ...moodFrom({
          memories,
          now,
          cares: (who) => cared.has(who),
          withCompany: [...cared].some((id) => truth.get(LOCATION, id)?.hex === here),
        }),
        craving: acute.craving,
        numbing: acute.numbing,
      };
      const drives = drivesFor({
        plan,
        body,
        mood,
        valueDefs: o.values,
        schemaDefs: o.schemas,
        mind,
        innate,
        bias: valueBias(culture?.prevalence["values.bias"]?.params ?? {}),
        stage: stageAt(o.stages, age),
      });
      const temper = temperOf(innate, mood);

      // Los objetivos: núcleo desde sus valores y venganza desde el resentimiento con memoria que lo
      // explique. Se reconcilian con los vigentes; los que nacen o terminan quedan como `npc.goal`.
      const prevGoals = truth.get(NPC_GOALS, me)?.items ?? [];
      const goals = reconcileGoals(prevGoals, [
        ...coreGoals(drives.values as never, o.schemas, mind, now),
        ...revengeGoals(
          people.map((p) => ({ who: p.id, resentment: p.rel.dims.resentment ?? 0 })),
          {
            memories,
            now,
            warmth: innate["warmth"] ?? 0.5,
            control: innate["control"] ?? 0.5,
            strengthIsWorth: mind.schemas["strength_is_worth"]?.strength ?? 0,
          },
        ),
      ]);
      // Capas derivadas (largo, mediano, corto): se recalculan cada vez, no se guardan; solo
      // empujan un poco los valores (desempatan).
      const layered = [
        ...longGoals(goals, mind, now),
        ...mediumGoals(
          people.map((p) => ({
            who: p.id,
            resentment: p.rel.dims.resentment ?? 0,
            closeness: closeness(p.rel.dims, p.rel.bonds),
            kin: kinWeight(p.rel.bonds) > 0,
            debt: 0,
          })),
          {
            memories,
            now,
            warmth: innate["warmth"] ?? 0.5,
            control: innate["control"] ?? 0.5,
            strengthIsWorth: mind.schemas["strength_is_worth"]?.strength ?? 0,
          },
          goals,
        ),
        ...shortGoals(drives.needs, goals, mind.originEventId, now),
      ];
      const { born, ended } = goalChanges(prevGoals, goals);
      const goalEvents = [
        ...born.map((g) => ({ g, what: "born" as const })),
        ...ended.map((g) => ({ g, what: "ended" as const })),
      ].map(({ g, what }) => ({
        kind: GOAL_EVENT,
        actors: [me],
        place: o.placeOf(truth, me),
        data: {
          goal: g.id,
          layer: g.layer,
          what,
          weight: g.weight,
          ...(g.value === undefined ? {} : { value: g.value }),
          ...(g.target === undefined ? {} : { target: g.target }),
        },
        emissions: {},
        causes: [
          { kind: "event", event: g.originEventId } as const,
          ...(what === "ended" ? [{ kind: "state", entity: me, key: "goals" } as const] : []),
        ],
      }));
      const goalChange =
        born.length + ended.length > 0 || prevGoals.length !== goals.length
          ? [setComponent(NPC_GOALS, me, { items: goals })]
          : [];
      const acuteCaps = applyAcute(capabilitiesOf(plan, body), acute);
      const altCaps = o.altitudeOf ? applyAltitude(acuteCaps, truth, me, o.altitudeOf) : acuteCaps;
      const frostCaps = o.frostbite ? applyFrostbite(altCaps, truth, me) : altCaps;
      const caps = o.nutritionCaps ? applyDeficiency(frostCaps, truth, me) : frostCaps;
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
        hexesOf: (ref) => truth.get(PLACE, ref)?.hexes,
        placeKindsAt: (hex) =>
          truth.ids(PLACE).flatMap((id) => {
            const p = truth.get(PLACE, id);
            return p?.hexes.includes(hex) ? [p.kind] : [];
          }),
        holds: (holder) => (holder === "self" ? true : undefined),
        nameOf: () => "alguien",
      };

      // La despensa que cree tener: la de su casa, que conoce (no hay foto de NPC todavía).
      const larder = ctx.ledger?.holdings(holderAccount(person.household as unknown as HolderRef));
      const pantry = pantryTexts(
        (o.goods ?? []).flatMap((g) => {
          const unit = goodUnit(g);
          const amount = larder?.find((h) => h.unit === unit)?.amount ?? 0;
          return g.form === "good" ? [{ name: g.name, amount }] : [];
        }),
      );
      const stash = (o.consumables ?? []).flatMap((c) => {
        const g = (o.goods ?? []).find((x) => x.id === c.good);
        const have = g ? (larder?.find((h) => h.unit === goodUnit(g))?.amount ?? 0) : 0;
        return g && have >= 1 ? [g.name] : [];
      });
      const texts = stash.length > 0 ? { ...pantry, consume: stash.sort() } : pantry;
      const social: Candidate[] = [];
      const catalogCandidates: Candidate[] = verbCandidates({
        catalog: o.catalog,
        view,
        persons: people.map((p) => p.id as unknown as EntityRef),
        // Los lugares con nombre de la aldea que conoce (los vive todos los días).
        places: truth.ids(PLACE).map((id) => id as unknown as EntityRef),
        texts,
      });
      for (const p of people) {
        const confidence = (() => {
          const alive = believed(beliefs, p.id, "alive");
          return alive ? beliefConfidenceAt(alive, now) : 0.3;
        })();
        // Lo que la vio hacer: si fue algo de riesgo, la cree peligrosa en proporción.
        const seen = believed(beliefs, p.id, "action");
        const seenDef =
          seen && typeof seen.value === "string"
            ? o.catalog.verbs.find((v) => v.id === seen.value)
            : undefined;
        const seenHarm =
          seen && seenDef ? STAKES_RISK[seenDef.stakes].risk * beliefConfidenceAt(seen, now) : 0;
        social.push(
          ...socialCandidates({
            target: p.id,
            dims: p.rel.dims,
            bonds: p.rel.bonds,
            belief: otherBeliefFrom({
              who: p.id,
              memories,
              now,
              relFear: p.rel.dims.fear,
              seenHarm,
              confidence,
            }),
            means: { surplus: Math.max(0, 1 - (drives.needs.hunger ?? 0) * 2) },
          }),
        );
      }
      // Modificadores (g): memorias, hábitos, disonancia con valores y evitación por trauma; sin
      // esos insumos las candidatas quedan iguales.
      const candidates = modifyCandidates(mergeCandidates(catalogCandidates, social), {
        now,
        memories,
        habits: verbHabits(o.habits ?? [], truth.get(HABITS, me), now),
        values: drives.values,
        mental: truth.get(MENTAL, me),
        // Tabú creído sobre el bien que toma la candidata (hoy ninguna candidata nombra uno).
        sanction: sanctionFor(
          (good) =>
            sanctionWeight(truth.get(RELIGIOUS_IDENTITY, me), villageReligion(truth), good).penalty,
        ),
      });
      if (candidates.length === 0) return { changes: goalChange, events: goalEvents };

      const choice = decideByUtility(
        candidates,
        layerDrives(goalDrives(drives, goals), layered),
        innate,
        temper,
        ctx.rng.fork("decision", me, now),
      );
      if (!choice) return { changes: goalChange, events: goalEvents };
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
        changes: [setComponent(NPC_DECISION, me, decision), ...goalChange],
        events: [
          ...goalEvents,
          ...(changed
            ? [
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
              ]
            : []),
        ],
      };
    },
  };
}
