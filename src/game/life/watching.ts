// Quién aprende mirando un paso (skills §3.2): los que comparten el hex con quien lo hace, vivos y
// despiertos, lo perciben con la misma fase de percepción que todos (distancia, paredes, luz, la
// agudeza por edad y la atención por actividad; si quien lo hace esconde el gesto, emite menos);
// lo que leyeron del paso deposita en su `SKILL_STATE` (`learnFromWatching`) y en lo que creen de
// quien lo hacía (`observeSkill`). Sin habilidad en el verbo o sin tirada, nadie aprende.

import type { AgentId, EventId, PlanetClock, Rng, Tick } from "../../core/index.ts";
import {
  ATTENTION,
  actionStimulus,
  BODY_STATE,
  type BodyPlanDef,
  capabilitiesOf,
  ENTITY,
  INNATE,
  LOCATION,
  learnFromWatching,
  levelOf,
  MENTAL,
  type Observer,
  OPINIONS,
  observeSkill,
  opinionKey,
  PERSON,
  perceive,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type SkillCatalog,
  type SpaceGraph,
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
  /** La luz del día afuera, 0-1 (cada uno la recibe según el espacio en que está). */
  readonly light: number;
  /** Los espacios y el bosque del parche: lo que se interpone entre quien hace y quien mira. */
  readonly spaces: SpaceGraph;
  readonly forest: readonly boolean[];
  /** Qué emitió el paso (esconder el gesto lo baja). */
  readonly emissions: { readonly sight: number; readonly sound: number };
  /** Para el ruido de lo que cada uno cree haber visto (opinión ajena). */
  readonly rng: Rng;
  /** El nivel que mostraba (con la pose); por defecto el efectivo. */
  readonly shown?: number;
  readonly seconds: number;
  readonly now: Tick;
}

/** Lo que se leyó del paso, 0-1: entender el gesto vale todo; solo notar que hacía algo, poco. */
function seenFrom(p: { fields: Readonly<Record<string, { confidence: number } | undefined>> }) {
  const action = p.fields["action"];
  if (action) return action.confidence;
  return 0.3 * (p.fields["presence"]?.confidence ?? 0);
}

/** Los cambios de habilidades de quienes miraron el paso, en orden de id. */
export function watchersLearn(i: WatchInput): StateChange[] {
  const use = i.catalog.forVerb(i.verb);
  if (!use || i.seconds <= 0) return [];
  const at = i.truth.get(LOCATION, i.doer);
  const doerPerson = i.truth.get(PERSON, i.doer);
  if (!at || !doerPerson) return [];
  const observers: Observer[] = [];
  for (const id of i.truth.ids(PERSON) as AgentId[]) {
    if (id === i.doer || id === i.except) continue;
    if (i.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const there = i.truth.get(LOCATION, id);
    if (there?.hex !== i.hex) continue;
    const person = i.truth.get(PERSON, id);
    const body = i.truth.get(BODY_STATE, id);
    if (!person || !body || body.activity === "sleep") continue;
    observers.push({
      id,
      at: there,
      acuity: sensorAcuity((i.now - person.born) / i.clock.year),
      attention: vigilantAttention(
        body.activity === "heavy" || body.activity === "moderate"
          ? ATTENTION.absorbed
          : ATTENTION.relaxed,
        i.truth.get(MENTAL, id),
      ),
      familiar: new Map(),
    });
  }
  if (observers.length === 0) return [];
  // Un id sintético del paso: el evento real todavía no existe cuando se resuelve.
  const step = `watch:${i.doer}@${i.now}` as EventId;
  const percepts = perceive(
    actionStimulus({
      event: step,
      tick: i.now,
      actor: i.doer,
      at,
      look: { sex: doerPerson.sex, ageYears: (i.now - doerPerson.born) / i.clock.year },
      verb: `action.${i.verb}`,
      emissions: i.emissions,
    }),
    observers,
    { graph: i.spaces, forest: i.forest, daylight: i.light },
    i.rng.fork("sight"),
  );
  const out: StateChange[] = [];
  for (const p of percepts) {
    const id = p.observer;
    const seen = Math.min(1, seenFrom(p));
    const person = i.truth.get(PERSON, id);
    const innate = i.truth.get(INNATE, id);
    const body = i.truth.get(BODY_STATE, id);
    const plan = body ? i.plans.get(body.plan) : undefined;
    if (!person || !innate || !body || !plan) continue;
    const age = (i.now - person.born) / i.clock.year;
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
