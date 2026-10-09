// Contagio cableado a la vida (body-health §6): los patógenos son entidades con origen, y cada día
// el proceso expone a quienes comparten hogar con un contagioso y a quienes toman de un pozo
// sucio. La infección avanza por su curso (incubación → síntomas → cura con inmunidad, o muerte con
// causa), y los enfermos ensucian el agua de los pozos si el patógeno pasa por el agua.
// Ningún patógeno nace sin causa: `seeds` es la única fuente (un escenario, una caravana que llega) y
// con la tabla de patógenos vacía el proceso no hace nada, así que la aldea por defecto no cambia.

import type { AgentId, PlaceRef, PlanetClock, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  createEntity,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  exposureDose,
  INFECTION,
  type Infection,
  immunityAfter,
  infectionStage,
  isImmune,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type PersonInfection,
  type ProcessDef,
  type Quarantine,
  quarantinedShared,
  type ReadonlyWorldTruth,
  type Shared,
  type StateChange,
  setComponent,
  sheddingLevel,
  TREATMENT,
  taintAfter,
  treatedCourse,
  tryInfect,
  WELL_TAINT,
  WORK,
  waterDose,
  wellWater,
} from "../../sim/index.ts";

export const EXPOSURE_PROCESS = "life.exposure";

/** Una fuente explícita de patógeno: quién lo trae, desde cuándo y (opcional) qué pozo ensucia. */
export interface PathogenSeed {
  readonly def: PathogenDef;
  readonly carrier: AgentId;
  readonly from: Tick;
  /** El pozo (`WorkId`) donde cae la carga, si entra por el agua. */
  readonly well?: string;
  /** Lo que pasó, en palabras (queda en el evento y en el patógeno). */
  readonly source: string;
}

export interface ExposureOptions {
  readonly clock: PlanetClock;
  readonly seeds?: readonly PathogenSeed[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Lo que comparten los de un mismo hogar en un día (calibración abierta). */
const HOUSEHOLD_DAY: Shared = {
  hours: 8,
  closeness: 0.7,
  ventilation: 0.3,
  waterDirt: 0,
  touch: 0.5,
};
/** Carga que un enfermo suma por día a cada pozo, por peso de la ruta de agua (calibración abierta). */
const TAINT_PER_DAY = 0.15;
/** Carga con que un sembrado cae en su pozo. */
const SEED_TAINT = 0.8;

const EMPTY: PersonInfection = { infections: [], immunities: [], ill: [] };

export function exposureProcess(o: ExposureOptions): ProcessDef {
  const tph = o.clock.day / 24;
  return {
    id: EXPOSURE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      PATHOGEN.name,
      INFECTION.name,
      WELL_TAINT.name,
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      WORK.name,
      TREATMENT.name,
    ],
    writes: [PATHOGEN.name, INFECTION.name, WELL_TAINT.name, ENTITY.name],
    run(ctx) {
      const known = new Map<string, PathogenDef>();
      for (const id of ctx.truth.ids(PATHOGEN)) {
        const rec = ctx.truth.get(PATHOGEN, id);
        if (rec) known.set(rec.def.id, rec.def);
      }

      // Siembra: la fuente explícita introduce el patógeno una sola vez.
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const s of o.seeds ?? []) {
        if (ctx.now < s.from || known.has(s.def.id)) continue;
        const k = events.length;
        const pid = ctx.newId("pathogen");
        const fatal = ctx.rng.fork("seed", s.def.id).chance(Math.min(1, s.def.lethality * 1.0));
        const carrierInfection: Infection = {
          pathogen: s.def.id,
          exposedAt: ctx.now,
          dose: 1,
          fatal,
          cause: draftEvent(k),
        };
        events.push({
          kind: "body.pathogen_introduced",
          actors: [s.carrier],
          place: o.placeOf(ctx.truth, s.carrier),
          data: { pathogen: s.def.id, source: s.source, well: s.well ?? null },
          emissions: {},
          causes: [{ kind: "state", entity: s.carrier, key: "body.carrier" }],
        });
        changes.push(
          createEntity(pid, draftEvent(k), ctx.now),
          setComponent(PATHOGEN, pid, { def: s.def, source: s.source }),
          setComponent(INFECTION, s.carrier, withInfection(ctx.truth, s.carrier, carrierInfection)),
        );
        if (s.well) {
          changes.push(
            setComponent(WELL_TAINT, s.well as never, {
              pathogen: s.def.id,
              load: SEED_TAINT,
              since: ctx.now,
              cause: draftEvent(k),
            }),
          );
        }
        known.set(s.def.id, s.def);
      }
      if (known.size === 0) return {};
      if (events.length > 0) return { changes, events };

      const days = Math.max(1, ctx.window) / o.clock.day;
      const people = ctx.truth
        .ids(PERSON)
        .filter(
          (id) => ctx.truth.get(ENTITY, id)?.endedAt === undefined && ctx.truth.has(BODY_STATE, id),
        );

      // Quién contagia hoy y desde qué evento, por hogar.
      type Source = { shed: number; cause: string; quarantine?: Quarantine; healer?: string };
      const byHouse = new Map<string, Map<string, Source>>();
      const stages = new Map<
        string,
        { inf: Infection; def: PathogenDef; stage: string; hours: number }[]
      >();
      for (const id of people) {
        const mine = ctx.truth.get(INFECTION, id);
        if (!mine) continue;
        const house = ctx.truth.get(PERSON, id)?.household;
        const list: { inf: Infection; def: PathogenDef; stage: string; hours: number }[] = [];
        for (const inf of mine.infections) {
          const def = known.get(inf.pathogen);
          if (!def) continue;
          const hours = (ctx.now - inf.exposedAt) / tph;
          const stage = infectionStage(def, inf, hours);
          list.push({ inf, def, stage, hours });
          const shed = sheddingLevel(def, stage as never, hours);
          if (shed > 0 && house !== undefined && inf.cause !== null) {
            const m = byHouse.get(house) ?? new Map<string, Source>();
            const prev = m.get(def.id);
            if (!prev || shed > prev.shed) {
              const tr = ctx.truth
                .get(TREATMENT, id)
                ?.treatments.find((t) => t.pathogen === def.id);
              m.set(def.id, {
                shed,
                cause: inf.cause,
                ...(tr?.quarantine ? { quarantine: tr.quarantine, healer: tr.healer } : {}),
              });
            }
            byHouse.set(house, m);
          }
        }
        stages.set(id, list);
      }

      // Pozos: la carga que baja con los días y la que suman los enfermos que pasan por el agua.
      const wells = ctx.truth.ids(WORK).filter((id) => ctx.truth.get(WORK, id)?.kind === "well");
      const taintNow = new Map<string, { pathogen: string; load: number; cause: string }>();
      for (const w of wells) {
        const t = ctx.truth.get(WELL_TAINT, w);
        if (!t) continue;
        const load = taintAfter(t.load, days);
        if (load > 0) taintNow.set(w, { pathogen: t.pathogen, load, cause: t.cause });
      }
      for (const [, list] of stages) {
        for (const s of list) {
          const route = s.def.routes.water ?? 0;
          if (s.stage !== "symptomatic" || route <= 0 || s.inf.cause === null) continue;
          for (const w of wells) {
            const cur = taintNow.get(w);
            const base = cur && cur.pathogen === s.def.id ? cur : undefined;
            taintNow.set(w, {
              pathogen: s.def.id,
              load: Math.min(1, (base?.load ?? 0) + TAINT_PER_DAY * route * days),
              cause: base?.cause ?? s.inf.cause,
            });
          }
        }
      }
      for (const w of wells) {
        const had = ctx.truth.get(WELL_TAINT, w);
        const now = taintNow.get(w);
        if (now) {
          changes.push(
            setComponent(WELL_TAINT, w, {
              pathogen: now.pathogen,
              load: now.load,
              since: had?.since ?? ctx.now,
              cause: now.cause,
            }),
          );
        } else if (had) {
          changes.push({ op: "delete", table: WELL_TAINT.name, id: w });
        }
      }
      let dirt: { pathogen: string; load: number; cause: string } | undefined;
      for (const t of taintNow.values()) if (!dirt || t.load > dirt.load) dirt = t;

      // Cada persona: avanza lo que tiene y tira lo que le llega.
      for (const id of people) {
        const agent = id as AgentId;
        const house = ctx.truth.get(PERSON, id)?.household;
        const mine = ctx.truth.get(INFECTION, id) ?? EMPTY;
        let infections = [...mine.infections];
        let immunities = [...mine.immunities];
        let changed = false;
        let died: Infection | undefined;

        for (const s of stages.get(id) ?? []) {
          if (s.stage === "recovered" || s.stage === "dead") {
            infections = infections.filter((i) => i !== s.inf);
            changed = true;
            // Un enfermo tratado con efecto real puede salvarse de un curso fatal (medicina §6).
            const tr = ctx.truth
              .get(TREATMENT, id)
              ?.treatments.find((t) => t.pathogen === s.def.id);
            const saved =
              s.stage === "dead" &&
              tr !== undefined &&
              tr.effect > 0 &&
              !ctx.rng
                .fork("treated", id, s.def.id)
                .chance(treatedCourse(tr.effect).lethalityFactor);
            if (s.stage === "dead" && !saved) died = s.inf;
            else {
              const imm = immunityAfter(s.def, tph, ctx.now);
              if (imm) immunities = [...immunities.filter((i) => i.pathogen !== s.def.id), imm];
            }
          }
        }

        const frailty = 1 - (ctx.truth.get(BODY_STATE, id)?.muscle ?? 0.5);
        let infectedBy: { def: PathogenDef; dose: number; cause: string } | undefined;
        if (!died) {
          for (const def of known.values()) {
            if (infections.some((i) => i.pathogen === def.id)) continue;
            if (isImmune(immunities, def.id, ctx.now)) continue;
            const src = house === undefined ? undefined : byHouse.get(house)?.get(def.id);
            const water = dirt && dirt.pathogen === def.id ? dirt : undefined;
            const shared: Shared = {
              ...HOUSEHOLD_DAY,
              hours: HOUSEHOLD_DAY.hours * days,
              waterDirt: water ? waterDose(wellWater(water.load)) : 0,
            };
            const eff = src?.quarantine
              ? quarantinedShared(shared, src.quarantine, src.healer === id)
              : shared;
            const dose = exposureDose(def, src?.shed ?? (water ? 1 : 0), eff);
            if (dose <= 0) continue;
            const got = tryInfect(
              def,
              dose,
              0,
              frailty,
              ctx.rng.fork("infect", id, def.id),
              ctx.now,
              null,
            );
            if (!got) continue;
            const cause = src?.cause ?? water?.cause;
            if (cause === undefined) continue;
            infectedBy = { def, dose, cause };
            infections.push(got);
            changed = true;
          }
        }

        if (infectedBy) {
          const k = events.length;
          events.push({
            kind: "body.infected",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { pathogen: infectedBy.def.id, dose: Math.round(infectedBy.dose * 1000) / 1000 },
            emissions: {},
            causes: [{ kind: "event", event: infectedBy.cause as never }],
          });
          infections = infections.map((i) =>
            i.pathogen === infectedBy.def.id && i.cause === null
              ? { ...i, cause: draftEvent(k) }
              : i,
          );
        }

        if (died) {
          const base = ctx.truth.get(ENTITY, id);
          const k = events.length;
          events.push({
            kind: "body.died",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { cause: "disease", pathogen: died.pathogen },
            emissions: { sight: 0.6, sound: 0.3 },
            causes: [
              died.cause !== null
                ? { kind: "event", event: died.cause as never }
                : { kind: "state", entity: agent, key: "body.infection" },
            ],
          });
          if (base) changes.push(endEntity(base, draftEvent(k), ctx.now));
        }

        if (!changed) {
          // Nada nuevo, pero puede haber pasado de incubar a tener síntomas.
        }
        const ill = infections
          .filter((i) => {
            const def = known.get(i.pathogen);
            return def && infectionStage(def, i, (ctx.now - i.exposedAt) / tph) === "symptomatic";
          })
          .map((i) => i.pathogen);
        const next: PersonInfection = { infections, immunities, ill };
        const same =
          !changed && ill.length === mine.ill.length && ill.every((p, n) => p === mine.ill[n]);
        if (!same) changes.push(setComponent(INFECTION, id, next));
      }
      return { changes, events };
    },
  };
}

function withInfection(truth: ReadonlyWorldTruth, who: AgentId, inf: Infection): PersonInfection {
  const cur = truth.get(INFECTION, who) ?? EMPTY;
  return { ...cur, infections: [...cur.infections, inf] };
}
