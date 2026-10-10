// Sanadores cableados a la vida (body-health §6): cada día, un sanador de la aldea atiende a los
// enfermos con síntomas que aún no trató: diagnostica (creencia con error que baja con su habilidad),
// da el remedio que su escuela asocia a lo que creyó (si se equivocó, no hace efecto) e indica
// cuarentena al hogar. El efecto lo lee `life.exposure` (menos dosis a los del hogar, curso menos fatal).
// Sin sanadores o sin enfermos no hace nada: la aldea por defecto no cambia.

import {
  type AgentId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  type AltitudeSickness,
  AMPUTATIONS,
  type Amputations,
  altitudeSickness,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  bodySigns,
  CLEAN,
  type ConditionModel,
  diagnose,
  dose,
  draftEvent,
  ENTITY,
  type EventDraft,
  effectLevel,
  FROSTBITE,
  FROSTBITE_ORDERS,
  type FrostbiteState,
  frostbiteAmputations,
  frostbiteStage,
  type HeldDef,
  INFECTION,
  infectionStage,
  levelOf,
  PATHOGEN,
  type PathogenDef,
  type PathogenTreatment,
  PERSON_SUBSTANCE,
  type PostingDraft,
  type ProcessContext,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type RemedyDef,
  remedyEffect,
  remedyHarm,
  type SignSet,
  SKILL_STATE,
  type StateChange,
  SUBSTANCE,
  type SubstanceDef,
  type SubstanceRoute,
  setComponent,
  stepSubstance,
  substanceSigns,
  TREATMENT,
} from "../../sim/index.ts";
import { deficiencyStagesOf } from "./nutrition.ts";

export const MEDICINE_PROCESS = "life.medicine";
/** Sumidero externo de los remedios dados. */
export const REMEDY_USED = "remedy_used";

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

/** Lo que ve el sanador en el cuerpo del enfermo (`bodySigns`), como pesos 0-1 de `SignSet`. */
export function signsOfBody(
  plan: BodyPlanDef,
  body: Body,
  stages?: Parameters<typeof bodySigns>[3],
): SignSet {
  const r = bodySigns(plan, body, true, stages);
  const out: Record<string, number> = {};
  const put = (k: string, v: number) => {
    out[k] = Math.max(out[k] ?? 0, v);
  };
  const map: Readonly<Record<string, readonly [string, number]>> = {
    feverish: ["fever", 0.8],
    tired: ["weakness", 0.5],
    exhausted: ["weakness", 0.8],
    wasting: ["weakness", 0.4],
    pale: ["pallor", 0.6],
    dizzy: ["dizziness", 0.5],
    thirsty: ["thirst", 0.4],
    parched: ["thirst", 0.8],
    wound_hot: ["wound_heat", 0.7],
    in_pain: ["pain", 0.6],
    bleeding_heavily: ["bleeding", 0.9],
    bleeding: ["bleeding", 0.4],
    limping: ["limping", 0.5],
  };
  for (const s of [...r.general, ...r.zones.flatMap((z) => z.signs)]) {
    const m = map[s];
    if (m) put(m[0], m[1]);
  }
  return out;
}

/**
 * Lo que ve el sanador de las sustancias que el enfermo tiene encima (`substanceSigns`), como pesos
 * 0-1 de `SignSet`: envenenamiento por etapa, sedación (somnolencia) y abstinencia (temblor).
 */
export function signsOfSubstances(held: readonly HeldDef[]): SignSet {
  const out: Record<string, number> = {};
  const put = (k: string, v: number) => {
    out[k] = Math.max(out[k] ?? 0, v);
  };
  for (const s of substanceSigns(held)) {
    if (s.kind === "sedated") put("drowsiness", 0.7);
    else if (s.kind === "withdrawing") {
      put("tremor", 0.6);
      put("restlessness", 0.5);
    } else if (s.stage === "symptoms") {
      put("weakness", 0.4);
      put("dizziness", 0.3);
    } else if (s.stage === "grave") {
      put("weakness", 0.7);
      put("dizziness", 0.6);
      put("pallor", 0.5);
    } else if (s.stage === "dying") {
      put("weakness", 0.9);
      put("pallor", 0.8);
    }
  }
  return out;
}

/**
 * Lo que ve el sanador del mal de altura (`altitudeSickness`), como pesos 0-1 de `SignSet`: dolor
 * de cabeza y mareo desde lo leve, debilidad y palidez en lo moderado, falta de aire y confusión en
 * lo grave.
 */
export function signsOfAltitude(sickness: AltitudeSickness): SignSet {
  if (sickness === "mild") return { headache: 0.4, dizziness: 0.3 };
  if (sickness === "moderate") {
    return { headache: 0.6, dizziness: 0.5, weakness: 0.5, breathlessness: 0.5 };
  }
  if (sickness === "severe") {
    return {
      headache: 0.8,
      dizziness: 0.7,
      weakness: 0.8,
      breathlessness: 0.9,
      confusion: 0.7,
      pallor: 0.5,
    };
  }
  return {};
}

/** Qué haría un sanador con la congelación de alguien: recalentar, aislar lo lesionado o amputar. */
export type FrostbiteCare = "rewarm" | "insulate" | "amputate";

/**
 * Lo que ve el sanador de la congelación (`frostbiteStage` por parte), como pesos 0-1 de `SignSet`:
 * palidez y entumecimiento por la etapa más grave, ampollas desde la profunda, tejido negro si hay
 * necrosis; las partes ya perdidas no se ven como lesión sino como ausencia (`missingPart`).
 */
export function signsOfFrostbite(state: FrostbiteState, had?: Amputations): SignSet {
  const out: Record<string, number> = {};
  const put = (k: string, v: number) => {
    out[k] = Math.max(out[k] ?? 0, v);
  };
  for (const part of ["hands", "feet", "face"] as const) {
    if (had?.lost.some((l) => l.part === part)) {
      put("missingPart", 1);
      continue;
    }
    const stage = frostbiteStage(state[part]);
    if (stage === "frostnip") put("pallor", 0.3);
    else if (stage === "superficial") {
      put("pallor", 0.5);
      put("numbness", 0.5);
    } else if (stage === "deep") {
      put("pallor", 0.7);
      put("numbness", 0.8);
      put("blisters", 0.7);
    } else if (stage === "necrotic") {
      put("numbness", 1);
      put("blackTissue", 0.9);
    }
  }
  return out;
}

/** Tratamientos que corresponden a la congelación: recalentar desde lo superficial, aislar en lo profundo, amputar lo necrosado. */
export function frostbiteCare(state: FrostbiteState): FrostbiteCare[] {
  const worst = frostbiteStage(Math.max(state.hands, state.feet, state.face));
  const dead = frostbiteAmputations(state).length > 0;
  const out: FrostbiteCare[] = [];
  if (worst !== "none") out.push("rewarm");
  if (worst === "deep" || dead) out.push("insulate");
  if (dead) out.push("amputate");
  return out;
}

/** Fama del sanador: la fracción de lo que atendió que mejoró (con prior de 1 caso neutro), 0-1. */
export function healerRenown(treated: number, helped: number): number {
  return (helped + 0.5) / (treated + 1);
}

/** Lo que pide por atender: base según la habilidad, que sube con la fama que le corre por rumor (x1 a x2). */
export function healerFee(base: number, skill: number, renown: number): number {
  return Math.round(base * (0.5 + skill) * (1 + Math.min(1, Math.max(0, renown))) * 100) / 100;
}

function frostSigns(truth: ReadonlyWorldTruth, who: string): SignSet {
  const state = truth.get(FROSTBITE, who as never);
  if (!state) return {};
  return signsOfFrostbite(state, truth.get(AMPUTATIONS, who as never));
}

function altitudeSigns(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  altitudeOf: (truth: ReadonlyWorldTruth, who: AgentId) => number,
): SignSet {
  return signsOfAltitude(
    altitudeSickness(altitudeOf(truth, who), truth.get(ACCLIMATIZATION, who)?.level ?? 0),
  );
}

function mergeSigns(a: SignSet, b: SignSet): SignSet {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/** Los signos de las sustancias que alguien tiene en el cuerpo; sin filas, nada. */
function heldSigns(truth: ReadonlyWorldTruth, who: string): SignSet {
  const rows = truth.get(PERSON_SUBSTANCE, who as never)?.held;
  if (!rows || rows.length === 0) return {};
  const defs = new Map<string, SubstanceDef>();
  for (const id of truth.ids(SUBSTANCE)) {
    const rec = truth.get(SUBSTANCE, id);
    if (rec) defs.set(rec.def.id, rec.def);
  }
  const held: HeldDef[] = [];
  for (const h of rows) {
    const def = defs.get(h.substance);
    if (def) held.push({ def, state: h.state });
  }
  return signsOfSubstances(held);
}

export interface MedicineOptions {
  /** Opt-in: planes de cuerpo; los signos del enfermo salen de `bodySigns` en vez de fijos. */
  readonly plans?: readonly BodyPlanDef[] | undefined;
  /** Opt-in (con `plans`): el sanador ve también los signos de las etapas de carencia. */
  readonly deficiencySigns?: boolean | undefined;
  readonly clock: PlanetClock;
  /** Opt-in: a los signos del enfermo se suman los de las sustancias que tiene encima (`PERSON_SUBSTANCE`). */
  readonly substanceSigns?: boolean | undefined;
  /** Opt-in: también los signos de la congelación (`FROSTBITE`, `AMPUTATIONS`). */
  readonly frostbiteSigns?: boolean | undefined;
  /**
   * Opt-in: el sanador ve la congelación del paciente (`FROSTBITE`) y escribe el pedido de cuidado
   * (`FROSTBITE_ORDERS`, `frostbiteCare`) que `life.thermal` convierte en orden. La habilidad sube la
   * intensidad y la cirugía exige un mínimo. Apagado: sin filas, RNG ni eventos.
   */
  readonly frostbiteOrders?: boolean | undefined;
  /** Opt-in: también los signos del mal de altura (altitud real de donde está y su aclimatación). */
  readonly altitudeSigns?: ((truth: ReadonlyWorldTruth, who: AgentId) => number) | undefined;
  readonly healers?: readonly Healer[];
  /** Sanadores desde las habilidades: quien tiene `medicine` sobre el mínimo atiende, después de los explícitos. */
  readonly school?: HealerSchool | undefined;
  /** Opt-in: id del remedio a la unidad del ledger que gasta (1 por dosis, del sanador o del enfermo). */
  readonly stock?: Readonly<Record<string, string>> | undefined;
  /**
   * Opt-in: remedio a sustancia con dosis real. El tratamiento deja el asiento de la dosis y
   * `life.substances` (con `treatmentDoses`) la aplica a `PERSON_SUBSTANCE`; el efecto sale de
   * `stepSubstance` (nivel al pico) en vez del efecto fijo. Sin esto, el efecto fijo de siempre.
   */
  readonly doses?: Readonly<Record<string, RemedyDose>> | undefined;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** La sustancia en que se vuelve un remedio y cuánto de ella es una dosis. */
export interface RemedyDose {
  readonly def: SubstanceDef;
  readonly route: SubstanceRoute;
  readonly amount: number;
}

/** Efecto de una dosis real: el nivel que `stepSubstance` deja en sangre al pico del remedio (0-1). */
export function substanceRemedyEffect(d: RemedyDose, peakHours: number): number {
  let st = dose(d.def, CLEAN, d.route, d.amount);
  const hours = Math.max(1, Math.round(peakHours));
  for (let h = 0; h < hours; h++) st = stepSubstance(d.def, st, 1);
  return effectLevel(d.def, st);
}

/** Días que rige un pedido de cuidado de congelación. */
const FROSTBITE_ORDER_DAYS = 3;
/** Habilidad mínima para decidir una amputación quirúrgica. */
const SURGERY_MIN_SKILL = 0.3;

/**
 * Los médicos escriben el pedido de cuidado de la congelación de cada paciente con lesión (uno por
 * ventana, sin repetir mientras rige): recalentar/aislar con intensidad por habilidad y, si hay
 * tejido necrosado y el médico sabe operar, amputar. Lo que no hay que hacer no se pide.
 */
function frostbiteOrders(
  ctx: ProcessContext,
  healers: readonly Healer[],
  taken: Map<string, number>,
  changes: StateChange[],
  events: EventDraft[],
  day: number,
  placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef,
): void {
  // Pedidos vencidos de quien ya no tiene lesión: se limpian (este proceso es su único escritor).
  for (const id of ctx.truth.ids(FROSTBITE_ORDERS)) {
    const old = ctx.truth.get(FROSTBITE_ORDERS, id);
    if (old && old.until <= ctx.now && !ctx.truth.get(FROSTBITE, id)) {
      changes.push({ op: "delete", table: FROSTBITE_ORDERS.name, id });
    }
  }
  for (const id of ctx.truth.ids(FROSTBITE)) {
    const patient = id as AgentId;
    if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const state = ctx.truth.get(FROSTBITE, id);
    if (!state) continue;
    const have = ctx.truth.get(FROSTBITE_ORDERS, id);
    if (have && have.until > ctx.now) continue;
    const care = frostbiteCare(state);
    if (care.length === 0) continue;
    const healer = healers.find(
      (h) => h.agent !== patient && (taken.get(h.agent) ?? 0) < (h.capacity ?? 3),
    );
    if (!healer) continue;
    taken.set(healer.agent, (taken.get(healer.agent) ?? 0) + 1);
    const lost = ctx.truth.get(AMPUTATIONS, id);
    const amputate =
      care.includes("amputate") && healer.skill >= SURGERY_MIN_SKILL
        ? frostbiteAmputations(state).filter((p) => !lost?.lost.some((l) => l.part === p))
        : [];
    const power = Math.min(1, 0.4 + 0.6 * healer.skill);
    const rewarm = care.includes("rewarm") ? power : 0;
    const insulate = care.includes("insulate") ? power : 0;
    events.push({
      kind: "body.frostbite_ordered",
      actors: [healer.agent, patient],
      place: placeOf(ctx.truth, patient),
      data: { rewarm, insulate, amputate },
      emissions: {},
      causes: [{ kind: "state", entity: patient, key: "body.frostbite" }],
    });
    changes.push(
      setComponent(FROSTBITE_ORDERS, id, {
        rewarm,
        insulate,
        amputate,
        until: ctx.now + FROSTBITE_ORDER_DAYS * day,
        by: healer.agent,
        at: ctx.now,
      }),
    );
  }
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
      ...(o.substanceSigns ? [PERSON_SUBSTANCE.name, SUBSTANCE.name] : []),
      ...(o.frostbiteSigns || o.frostbiteOrders ? [FROSTBITE.name, AMPUTATIONS.name] : []),
      ...(o.frostbiteOrders ? [FROSTBITE_ORDERS.name] : []),
      ...(o.altitudeSigns ? [ACCLIMATIZATION.name] : []),
    ],
    writes: o.frostbiteOrders ? [TREATMENT.name, FROSTBITE_ORDERS.name] : [TREATMENT.name],
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
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const taken = new Map<string, number>();
      if (o.frostbiteOrders) {
        frostbiteOrders(ctx, healers, taken, changes, events, o.clock.day, o.placeOf);
      }
      if (defs.size === 0) return events.length > 0 ? { changes, events } : {};

      const postings: PostingDraft[] = [];
      const reserved = new Map<string, number>();
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
          const body = o.plans ? ctx.truth.get(BODY_STATE, id) : undefined;
          const plan = body && o.plans?.find((p) => p.id === body.plan);
          const base: SignSet =
            body && plan
              ? signsOfBody(plan, body, deficiencyStagesOf(ctx.truth, id, o.deficiencySigns))
              : { fever: 0.8, weakness: 0.3 + 0.5 * progress };
          const withSubs: SignSet = o.substanceSigns
            ? mergeSigns(base, heldSigns(ctx.truth, id))
            : base;
          const withFrost: SignSet = o.frostbiteSigns
            ? mergeSigns(withSubs, frostSigns(ctx.truth, id))
            : withSubs;
          const signs: SignSet = o.altitudeSigns
            ? mergeSigns(withFrost, altitudeSigns(ctx.truth, patient, o.altitudeSigns))
            : withFrost;
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
          let remedy = healer.remedies.find((r) => r.id === remedyId);
          // Con `stock`, el remedio sale de un lote real (el del sanador, o si no el del enfermo): sin
          // existencias no se da, y lo gastado va al sumidero con el evento del tratamiento.
          let spent: { unit: LedgerUnit; from: LedgerAccount } | undefined;
          const unitName = remedy ? o.stock?.[remedy.id] : undefined;
          const unit = unitName === undefined ? undefined : ledgerUnit(unitName);
          if (remedy && unit !== undefined && ctx.ledger) {
            for (const who of [healer.agent, patient]) {
              const acc = holderAccount(who as unknown as HolderRef);
              const used = reserved.get(`${acc}|${unit}`) ?? 0;
              if (ctx.ledger.balance(acc, unit) - used >= 1) {
                reserved.set(`${acc}|${unit}`, used + 1);
                spent = { unit, from: acc };
                break;
              }
            }
            if (!spent) remedy = undefined;
          }
          const given = remedy
            ? {
                remedy,
                dose: remedy.optimalDose,
                hoursSinceDose: remedy.peakHours,
                courseHoursAtDose: hours,
                skill: healer.skill,
              }
            : undefined;
          const real = remedy ? o.doses?.[remedy.id] : undefined;
          // Con dosis real, el efecto es el nivel de la sustancia (y el daño lo hace ella misma).
          const effect = given
            ? real
              ? Math.min(1, substanceRemedyEffect(real, remedy?.peakHours ?? 1) * healer.skill)
              : remedyEffect(def, given)
            : 0;
          const harm = remedy && given && !real ? remedyHarm(remedy, given.dose) : 0;
          const iso = healer.isolation ?? 0;
          if (spent) {
            postings.push({
              event: draftEvent(events.length),
              transfers: [
                {
                  unit: spent.unit,
                  from: spent.from,
                  to: externalAccount(REMEDY_USED),
                  amount: 1,
                },
              ],
            });
          }
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
            ...(real ? { dose: { def: real.def, route: real.route, amount: real.amount } } : {}),
            givenAt: ctx.now,
            cause: draftEvent(k + 1),
          });
        }
        if (added.length > 0) {
          changes.push(setComponent(TREATMENT, id, { treatments: [...had, ...added] }));
        }
      }
      if (events.length === 0) return {};
      return postings.length > 0 ? { changes, events, postings } : { changes, events };
    },
  };
}
