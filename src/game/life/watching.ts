// Quién aprende mirando un paso (skills §3.2): los que comparten el hex con quien lo hace, vivos y
// despiertos, lo ven según su vista, su atención y la luz; lo que ven deposita en su `SKILL_STATE`
// (`learnFromWatching`). Sin habilidad en el verbo o sin tirada, nadie aprende.

import type { AgentId, PlanetClock, Rng, Tick } from "../../core/index.ts";
import {
  ATTENTION,
  BODY_STATE,
  type BodyPlanDef,
  capabilitiesOf,
  ENTITY,
  INNATE,
  LOCATION,
  learnFromWatching,
  levelOf,
  MENTAL,
  OPINIONS,
  observeSkill,
  opinionKey,
  PERSON,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  sensorAcuity,
  setComponent,
  standardize,
  type Trait,
  vigilantAttention,
  WATCH_MIN_SEEN,
} from "../../sim/index.ts";

export interface WatchInput {
  readonly truth: ReadonlyWorldTruth;
  readonly catalog: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly plans: ReadonlyMap<string, BodyPlanDef>;
  readonly clock: PlanetClock;
  readonly doer: AgentId;
  readonly verb: string;
  /** El nivel efectivo con que lo hizo. */
  readonly doerLevel: number;
  readonly hex: number;
  /** Alguien que no mira (el blanco de un golpe: su estado ya lo escribió el paso). */
  readonly except?: AgentId | null;
  readonly light: number;
  readonly seconds: number;
  /** Para el ruido de lo que cada uno cree haber visto (opinión ajena). */
  readonly rng: Rng;
  /** El nivel que mostraba (con la pose); por defecto el efectivo. */
  readonly shown?: number;
  readonly now: Tick;
}

/** Los cambios de habilidades de quienes miraron el paso, en orden de id. */
export function watchersLearn(i: WatchInput): StateChange[] {
  const use = i.catalog.forVerb(i.verb);
  if (!use || i.seconds <= 0) return [];
  const out: StateChange[] = [];
  for (const id of i.truth.ids(PERSON) as AgentId[]) {
    if (id === i.doer || id === i.except) continue;
    if (i.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if (i.truth.get(LOCATION, id)?.hex !== i.hex) continue;
    const person = i.truth.get(PERSON, id);
    const innate = i.truth.get(INNATE, id);
    const body = i.truth.get(BODY_STATE, id);
    if (!person || !innate || !body || body.activity === "sleep") continue;
    const plan = i.plans.get(body.plan);
    if (!plan) continue;
    const age = (i.now - person.born) / i.clock.year;
    const attention = vigilantAttention(
      body.activity === "heavy" || body.activity === "moderate"
        ? ATTENTION.absorbed
        : ATTENTION.relaxed,
      i.truth.get(MENTAL, id),
    );
    const seen = Math.min(1, sensorAcuity(age).sight * attention * (0.3 + 0.7 * i.light));
    const next = learnFromWatching(
      use,
      i.truth.get(SKILL_STATE, id)?.[use.skill.id],
      {
        z: standardize(innate, i.traits, person.sex),
        capabilities: capabilitiesOf(plan, body),
        ageYears: age,
      },
      { doer: i.doer, seen, doerLevel: i.doerLevel, seconds: i.seconds, tick: i.now },
      i.clock.day,
    );
    if (next)
      out.push(
        setComponent(SKILL_STATE, id, { ...i.truth.get(SKILL_STATE, id), [use.skill.id]: next }),
      );
    // Y se forma una idea de qué tan bueno es quien lo hace (skills §9): con lo que vio, no con la verdad.
    if (seen >= WATCH_MIN_SEEN) {
      const mine = i.truth.get(SKILL_STATE, id)?.[use.skill.id];
      const key = opinionKey(i.doer, use.skill.id);
      const opinions = i.truth.get(OPINIONS, id);
      out.push(
        setComponent(OPINIONS, id, {
          ...opinions,
          [key]: observeSkill(
            opinions?.[key],
            i.shown ?? i.doerLevel,
            seen,
            levelOf(mine, "reading"),
            i.rng.fork("opinion", id).normal(),
            i.now,
          ),
        }),
      );
    }
  }
  return out;
}
