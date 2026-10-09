// Sanadores cableados a la vida (body-health §6): cada día, un sanador de la aldea atiende a los
// enfermos con síntomas que aún no trató: diagnostica (creencia con error que baja con su habilidad),
// da el remedio que su escuela asocia a lo que creyó (si se equivocó, no hace efecto) e indica
// cuarentena al hogar. El efecto lo lee `life.exposure` (menos dosis a los del hogar, curso menos fatal).
// Sin sanadores o sin enfermos no hace nada: la aldea por defecto no cambia.

import type { AgentId, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  BODY_STATE,
  type ConditionModel,
  diagnose,
  draftEvent,
  ENTITY,
  type EventDraft,
  INFECTION,
  infectionStage,
  levelOf,
  PATHOGEN,
  type PathogenDef,
  type PathogenTreatment,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type RemedyDef,
  remedyEffect,
  remedyHarm,
  type SignSet,
  SKILL_STATE,
  type StateChange,
  setComponent,
  TREATMENT,
} from "../../sim/index.ts";

export const MEDICINE_PROCESS = "life.medicine";

/** Un sanador explícito (hasta que el oficio de sanar viva en el modelo de habilidades). */
export interface Healer {
  readonly agent: AgentId;
  /** 0-1. */
  readonly skill: number;
  /** Cómo entiende las enfermedades su escuela. */
  readonly models: readonly ConditionModel[];
  readonly remedies: readonly RemedyDef[];
  /** Condición creída a id del remedio que da. */
  readonly remedyFor: Readonly<Record<string, string>>;
  /** Aislamiento que indica al hogar (0-1; 0 o ausente: sin cuarentena). */
  readonly isolation?: number;
  /** Cuánto cumple el hogar la cuarentena (0-1; por defecto 0.6). */
  readonly compliance?: number;
  /** Cuántos enfermos nuevos atiende por día (por defecto 3). */
  readonly capacity?: number;
}

/** La escuela de la aldea: lo que sabe y da quien practica el oficio (`medicine`), sin lista de sanadores. */
export interface HealerSchool {
  readonly models: readonly ConditionModel[];
  readonly remedies: readonly RemedyDef[];
  readonly remedyFor: Readonly<Record<string, string>>;
  readonly isolation?: number;
  readonly compliance?: number;
  readonly capacity?: number;
  /** Nivel de la habilidad desde el cual la gente lo busca como sanador (por defecto 0.2). */
  readonly minSkill?: number;
}

/** El nivel de sanar de alguien: promedio de ejecución, saber y juicio de `medicine` (skills §2). */
export function healingSkill(state: Parameters<typeof levelOf>[0]): number {
  return (
    (levelOf(state, "execution") + levelOf(state, "knowledge") + levelOf(state, "judgment")) / 3
  );
}

export interface MedicineOptions {
  readonly clock: PlanetClock;
  readonly healers?: readonly Healer[];
  /** Sanadores desde las habilidades: quien tiene `medicine` sobre el mínimo atiende, después de los explícitos. */
  readonly school?: HealerSchool | undefined;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function medicineProcess(o: MedicineOptions): ProcessDef {
  const tph = o.clock.day / 24;
  return {
    id: MEDICINE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SKILL_STATE.name,
      PATHOGEN.name,
      INFECTION.name,
      TREATMENT.name,
      ENTITY.name,
      BODY_STATE.name,
    ],
    writes: [TREATMENT.name],
    run(ctx) {
      const alive = (a: AgentId) => ctx.truth.get(ENTITY, a)?.endedAt === undefined;
      const healers = (o.healers ?? []).filter((h) => alive(h.agent));
      const school = o.school;
      if (school) {
        const min = school.minSkill ?? 0.2;
        const explicit = new Set(healers.map((h) => h.agent));
        const found: Healer[] = [];
        for (const id of ctx.truth.ids(SKILL_STATE)) {
          const agent = id as AgentId;
          if (explicit.has(agent) || !alive(agent)) continue;
          const skill = healingSkill(ctx.truth.get(SKILL_STATE, id)?.["medicine"]);
          if (skill < min) continue;
          found.push({ ...school, agent, skill });
        }
        found.sort((a, b) => b.skill - a.skill || (a.agent < b.agent ? -1 : 1));
        healers.push(...found);
      }
      if (healers.length === 0) return {};
      const defs = new Map<string, PathogenDef>();
      for (const id of ctx.truth.ids(PATHOGEN)) {
        const rec = ctx.truth.get(PATHOGEN, id);
        if (rec) defs.set(rec.def.id, rec.def);
      }
      if (defs.size === 0) return {};

      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const taken = new Map<string, number>();
      for (const id of ctx.truth.ids(INFECTION)) {
        const mine = ctx.truth.get(INFECTION, id);
        if (!mine || mine.ill.length === 0) continue;
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const patient = id as AgentId;
        const had = ctx.truth.get(TREATMENT, id)?.treatments ?? [];
        const added: PathogenTreatment[] = [];
        for (const inf of mine.infections) {
          const def = defs.get(inf.pathogen);
          if (!def || !mine.ill.includes(def.id)) continue;
          if (had.some((t) => t.pathogen === def.id)) continue;
          const hours = (ctx.now - inf.exposedAt) / tph;
          if (infectionStage(def, inf, hours) !== "symptomatic") continue;
          const healer = healers.find(
            (h) => h.agent !== patient && (taken.get(h.agent) ?? 0) < (h.capacity ?? 3),
          );
          if (!healer) continue;
          taken.set(healer.agent, (taken.get(healer.agent) ?? 0) + 1);

          const progress = Math.min(1, Math.max(0, hours / Math.max(1, def.courseHours)));
          const signs: SignSet = { fever: 0.8, weakness: 0.3 + 0.5 * progress };
          const belief = diagnose(
            signs,
            healer.models,
            healer.skill,
            0.6,
            ctx.rng.fork("diagnose", id, def.id),
          );
          if (!belief) continue;

          const k = events.length;
          events.push({
            kind: "body.diagnosed",
            actors: [healer.agent, patient],
            place: o.placeOf(ctx.truth, patient),
            data: {
              pathogen: def.id,
              believed: belief.condition,
              confidence: Math.round(belief.confidence * 1000) / 1000,
              alternatives: belief.alternatives,
            },
            emissions: {},
            causes:
              inf.cause !== null
                ? [{ kind: "event", event: inf.cause as never }]
                : [{ kind: "state", entity: patient, key: "body.infection" }],
          });

          const remedyId = healer.remedyFor[belief.condition];
          const remedy = healer.remedies.find((r) => r.id === remedyId);
          const given = remedy
            ? {
                remedy,
                dose: remedy.optimalDose,
                hoursSinceDose: remedy.peakHours,
                courseHoursAtDose: hours,
                skill: healer.skill,
              }
            : undefined;
          const effect = given ? remedyEffect(def, given) : 0;
          const harm = remedy && given ? remedyHarm(remedy, given.dose) : 0;
          const iso = healer.isolation ?? 0;
          events.push({
            kind: "body.treated",
            actors: [healer.agent, patient],
            place: o.placeOf(ctx.truth, patient),
            data: { pathogen: def.id, remedy: remedy?.id ?? null, quarantine: iso > 0 },
            emissions: {},
            causes: [{ kind: "event", event: draftEvent(k) }],
          });
          added.push({
            pathogen: def.id,
            healer: healer.agent,
            believed: belief.condition,
            confidence: belief.confidence,
            remedy: remedy?.id ?? null,
            effect,
            harm,
            quarantine:
              iso > 0
                ? {
                    isolation: iso,
                    compliance: healer.compliance ?? 0.6,
                    caregiverHygiene: Math.min(1, healer.skill),
                    separateWater: true,
                  }
                : null,
            givenAt: ctx.now,
            cause: draftEvent(k + 1),
          });
        }
        if (added.length > 0) {
          changes.push(setComponent(TREATMENT, id, { treatments: [...had, ...added] }));
        }
      }
      return events.length > 0 ? { changes, events } : {};
    },
  };
}
