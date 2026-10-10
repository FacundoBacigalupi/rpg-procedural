// Contagio cableado a la vida (body-health Â§6): los patÃ³genos son entidades con origen, y cada dÃ­a
// el proceso expone a quienes comparten hogar con un contagioso y a quienes toman de un pozo
// sucio. La infecciÃ³n avanza por su curso (incubaciÃ³n â†’ sÃ­ntomas â†’ cura con inmunidad, o muerte con
// causa), y los enfermos ensucian el agua de los pozos si el patÃ³geno pasa por el agua.
// NingÃºn patÃ³geno nace sin causa: `seeds` es la Ãºnica fuente (un escenario, una caravana que llega) y
// con la tabla de patÃ³genos vacÃ­a el proceso no hace nada, asÃ­ que la aldea por defecto no cambia.

import {
  type AgentId,
  type CauseRef,
  type EntityRef,
  exp,
  type PlaceRef,
  type PlanetClock,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  BUILDING,
  type Carrier,
  type CarrionSource,
  carrierArrival,
  createEntity,
  DEFICIENCY_EFFECTS,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  exposureDose,
  INFECTION,
  type Infection,
  immuneSusceptibility,
  immunityAfter,
  infectionStage,
  isImmune,
  LOCATION,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type PersonInfection,
  type ProcessDef,
  type Quarantine,
  quarantinedShared,
  REACH_TAINT,
  type Reach,
  type ReachTaint,
  type ReadonlyWorldTruth,
  type Reservoir,
  reservoirSpill,
  type Shared,
  type StateChange,
  seepageLoad,
  setComponent,
  sheddingLevel,
  stepWatercourse,
  TREATMENT,
  taintAfter,
  treatedCourse,
  tryInfect,
  VILLAGE_SQUARE,
  type WaterQuality,
  WELL_TAINT,
  WORK,
  waterDose,
  wellWater,
} from "../../sim/index.ts";

export const EXPOSURE_PROCESS = "life.exposure";

/** Una fuente explÃ­cita de patÃ³geno: quiÃ©n lo trae, desde cuÃ¡ndo y (opcional) quÃ© pozo ensucia. */
export interface PathogenSeed {
  readonly def: PathogenDef;
  readonly carrier: AgentId;
  readonly from: Tick;
  /** El pozo (`WorkId`) donde cae la carga, si entra por el agua. */
  readonly well?: string;
  /** Lo que pasÃ³, en palabras (queda en el evento y en el patÃ³geno). */
  readonly source: string;
  /** Causas del mundo del evento (caravana que llega, reservorio); sin esto, solo el portador. */
  readonly causes?: readonly CauseRef[];
}

export interface ExposureOptions {
  readonly clock: PlanetClock;
  readonly seeds?: readonly PathogenSeed[];
  /**
   * Semillas con causa del mundo (body-health §6), opt-in: se consultan cada día y aportan
   * `PathogenSeed` con `causes` (portador que llega, derrame de reservorio; ver `arrivalSeed` y
   * `spillSeed`). Sin esto no hay semillas nuevas, RNG ni eventos.
   */
  readonly arrivals?: (truth: ReadonlyWorldTruth, now: Tick) => readonly PathogenSeed[];
  /**
   * Calidad del agua que bebe cada quien, con la carga del pozo (turbiedad, tratamiento);
   * sin esto es `wellWater(load)`, como siempre.
   */
  readonly waterFor?: (truth: ReadonlyWorldTruth, who: EntityRef, load: number) => WaterQuality;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Leer `DEFICIENCY_EFFECTS` (`immune` sube la chance de infectarse); apagado por defecto. */
  readonly deficiency?: boolean;
  /**
   * Agua corriente (body-health §6), opt-in: tramos de río, fuentes de carga (cadáveres sin enterrar,
   * fosas) y a qué tramo filtra cada pozo. Sin esto, o sin fuentes ni carga, no hay RNG ni filas.
   */
  readonly watercourse?: {
    readonly reaches: readonly Reach[];
    readonly sources: (truth: ReadonlyWorldTruth) => readonly CarrionSource[];
    readonly wellReach: (truth: ReadonlyWorldTruth, well: string) => string | undefined;
  };
}

/** Lo que comparten los de un mismo hogar en un dÃ­a (calibraciÃ³n abierta). */
const HOUSEHOLD_DAY: Shared = {
  hours: 8,
  closeness: 0.7,
  ventilation: 0.3,
  waterDirt: 0,
  touch: 0.5,
};
/** Horas de contacto por dÃ­a con quien comparte lugar fuera del hogar (foto del dÃ­a, calibraciÃ³n abierta). */
const PLACE_HOURS = 2;
/** CuÃ¡ntos vecinos de lugar hacen falta para que la cercanÃ­a llegue a ~63% (calibraciÃ³n abierta). */
const CROWD_SCALE = 4;
/** VentilaciÃ³n de la plaza y del campo abierto contra la de un cuarto cerrado. */
const OPEN_AIR = 0.9;
const ROOM_AIR = 0.3;
/** Carga que un enfermo suma por dÃ­a a cada pozo, por peso de la ruta de agua (calibraciÃ³n abierta). */
const TAINT_PER_DAY = 0.15;
/** Carga con que un sembrado cae en su pozo. */
const SEED_TAINT = 0.8;

/**
 * Semilla de un portador que llega de viaje (caravana): si muere en el camino o no llega contagioso
 * no hay semilla; la dosis que deja en el destino pasa por una tirada con clave del patógeno.
 * `event` es el evento de la llegada (queda como causa).
 */
export function arrivalSeed(
  rng: Rng,
  c: Carrier,
  travelHours: number,
  atDestination: Shared,
  who: { carrier: AgentId; from: Tick; event: CauseRef },
): PathogenSeed | null {
  const out = carrierArrival(c, travelHours, atDestination);
  if (out.diedOnRoad || out.dose <= 0) return null;
  if (!rng.fork("arrival", c.pathogen.id, who.carrier).chance(Math.min(1, out.dose))) return null;
  return {
    def: c.pathogen,
    carrier: who.carrier,
    from: who.from,
    source: `llegó con ${c.from}`,
    causes: [who.event],
  };
}

/**
 * Semilla por derrame de un reservorio (zoonosis, agua): la dosis acumulada en `days` días de
 * contacto de `who` con el reservorio es la chance de que se infecte, con tirada con clave.
 */
export function spillSeed(
  rng: Rng,
  r: Reservoir,
  def: PathogenDef,
  contact: number,
  days: number,
  who: { carrier: AgentId; from: Tick; cause: CauseRef },
): PathogenSeed | null {
  const dose = reservoirSpill(r, def, contact, days);
  if (dose <= 0) return null;
  if (!rng.fork("spill", def.id, who.carrier).chance(Math.min(1, dose))) return null;
  return {
    def,
    carrier: who.carrier,
    from: who.from,
    source: r.kind === "animal" ? "zoonosis de un reservorio animal" : "agua de un reservorio",
    causes: [who.cause],
  };
}

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
      DEFICIENCY_EFFECTS.name,
    ],
    writes: [PATHOGEN.name, INFECTION.name, WELL_TAINT.name, REACH_TAINT.name, ENTITY.name],
    run(ctx) {
      const known = new Map<string, PathogenDef>();
      for (const id of ctx.truth.ids(PATHOGEN)) {
        const rec = ctx.truth.get(PATHOGEN, id);
        if (rec) known.set(rec.def.id, rec.def);
      }

      // Siembra: la fuente explÃ­cita introduce el patÃ³geno una sola vez.
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const s of [...(o.seeds ?? []), ...(o.arrivals?.(ctx.truth, ctx.now) ?? [])]) {
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
          causes: s.causes?.length
            ? [...s.causes]
            : [{ kind: "state", entity: s.carrier, key: "body.carrier" }],
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

      // QuiÃ©n contagia hoy y desde quÃ© evento, por hogar.
      type Source = { shed: number; cause: string; quarantine?: Quarantine; healer?: string };
      const byHouse = new Map<string, Map<string, Source>>();
      const byPlace = new Map<string, Map<string, Source>>();
      const stages = new Map<
        string,
        { inf: Infection; def: PathogenDef; stage: string; hours: number }[]
      >();
      for (const id of people) {
        const mine = ctx.truth.get(INFECTION, id);
        if (!mine) continue;
        const house = ctx.truth.get(PERSON, id)?.household;
        const here = placeKey(ctx.truth, id);
        const list: { inf: Infection; def: PathogenDef; stage: string; hours: number }[] = [];
        for (const inf of mine.infections) {
          const def = known.get(inf.pathogen);
          if (!def) continue;
          const hours = (ctx.now - inf.exposedAt) / tph;
          const stage = infectionStage(def, inf, hours);
          list.push({ inf, def, stage, hours });
          const shed = sheddingLevel(def, stage as never, hours);
          if (shed > 0 && inf.cause !== null) {
            const tr = ctx.truth.get(TREATMENT, id)?.treatments.find((t) => t.pathogen === def.id);
            const src: Source = {
              shed,
              cause: inf.cause,
              ...(tr?.quarantine ? { quarantine: tr.quarantine, healer: tr.healer } : {}),
            };
            for (const [key, groups] of [
              [house, byHouse],
              [here, byPlace],
            ] as const) {
              if (key === undefined) continue;
              const m = groups.get(key) ?? new Map<string, Source>();
              const prev = m.get(def.id);
              if (!prev || shed > prev.shed) m.set(def.id, src);
              groups.set(key, m);
            }
          }
        }
        stages.set(id, list);
      }

      // Pozos: la carga que baja con los dÃ­as y la que suman los enfermos que pasan por el agua.
      const wells = ctx.truth.ids(WORK).filter((id) => ctx.truth.get(WORK, id)?.kind === "well");
      const taintNow = new Map<string, { pathogen: string; load: number; cause: string }>();
      for (const w of wells) {
        const t = ctx.truth.get(WELL_TAINT, w);
        if (!t) continue;
        const load = taintAfter(t.load, days);
        if (load > 0) taintNow.set(w, { pathogen: t.pathogen, load, cause: t.cause });
      }
      const settlementOf = householdSettlements(ctx.truth);
      const wellsFor = (id: string): readonly string[] => {
        const home = settlementOf.get(ctx.truth.get(PERSON, id as EntityRef)?.household ?? "");
        if (home === undefined) return wells;
        const own = wells.filter((w) => ctx.truth.get(WORK, w)?.settlement === home);
        return own.length > 0 ? own : wells;
      };
      for (const [who, list] of stages) {
        for (const s of list) {
          const route = s.def.routes.water ?? 0;
          if (s.stage !== "symptomatic" || route <= 0 || s.inf.cause === null) continue;
          for (const w of wellsFor(who)) {
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
      const wc = o.watercourse;
      if (wc) {
        const prev = new Map<string, ReachTaint>();
        for (const id of ctx.truth.ids(REACH_TAINT)) {
          const t = ctx.truth.get(REACH_TAINT, id);
          if (t) prev.set(id, t);
        }
        const nowReach = new Map<string, ReachTaint>(prev);
        let left = Math.max(1, Math.round(days));
        const sources = wc.sources(ctx.truth).filter((s) => known.has(s.pathogen));
        let step = prev;
        while (left-- > 0) {
          step = stepWatercourse(wc.reaches, step, sources, ctx.now, o.clock.day);
        }
        nowReach.clear();
        for (const [id, t] of step) nowReach.set(id, t);
        for (const id of new Set([...prev.keys(), ...nowReach.keys()])) {
          const a = prev.get(id);
          const b = nowReach.get(id);
          if (b) {
            if (!a || a.load !== b.load || a.pathogen !== b.pathogen) {
              changes.push(setComponent(REACH_TAINT, id as never, b));
            }
          } else changes.push({ op: "delete", table: REACH_TAINT.name, id: id as never });
        }
        for (const w of wells) {
          const rid = wc.wellReach(ctx.truth, w);
          const rt = rid === undefined ? undefined : nowReach.get(rid);
          const load = seepageLoad(rt);
          if (!rt || load <= 0 || !known.has(rt.pathogen)) continue;
          const cur = taintNow.get(w);
          if (!cur || cur.load < load) {
            taintNow.set(w, { pathogen: rt.pathogen, load, cause: rt.cause });
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
      // CuÃ¡nta gente comparte cada lugar hoy: la cercanÃ­a sale de la ocupaciÃ³n.
      const crowd = new Map<string, number>();
      for (const id of people) {
        const k = placeKey(ctx.truth, id);
        if (k !== undefined) crowd.set(k, (crowd.get(k) ?? 0) + 1);
      }
      const dirtFor = (id: string) => {
        let best: { pathogen: string; load: number; cause: string } | undefined;
        for (const w of wellsFor(id)) {
          const t = taintNow.get(w);
          if (t && (!best || t.load > best.load)) best = t;
        }
        return best;
      };

      // Cada persona: avanza lo que tiene y tira lo que le llega.
      for (const id of people) {
        const agent = id as AgentId;
        const house = ctx.truth.get(PERSON, id)?.household;
        const here = placeKey(ctx.truth, id);
        const dirt = dirtFor(id);
        const mine = ctx.truth.get(INFECTION, id) ?? EMPTY;
        let infections = [...mine.infections];
        let immunities = [...mine.immunities];
        let changed = false;
        let died: Infection | undefined;

        for (const s of stages.get(id) ?? []) {
          if (s.stage === "recovered" || s.stage === "dead") {
            infections = infections.filter((i) => i !== s.inf);
            changed = true;
            // Un enfermo tratado con efecto real puede salvarse de un curso fatal (medicina Â§6).
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
        const fx = o.deficiency ? ctx.truth.get(DEFICIENCY_EFFECTS, id) : undefined;
        const susceptible = fx ? immuneSusceptibility(fx.immune) : 1;
        let infectedBy: { def: PathogenDef; dose: number; cause: string } | undefined;
        if (!died) {
          for (const def of known.values()) {
            if (infections.some((i) => i.pathogen === def.id)) continue;
            if (isImmune(immunities, def.id, ctx.now)) continue;
            const homeSrc = house === undefined ? undefined : byHouse.get(house)?.get(def.id);
            const placeSrc = here === undefined ? undefined : byPlace.get(here)?.get(def.id);
            const water = dirt && dirt.pathogen === def.id ? dirt : undefined;
            const shared: Shared = {
              ...HOUSEHOLD_DAY,
              hours: HOUSEHOLD_DAY.hours * days,
              waterDirt: water
                ? waterDose(
                    o.waterFor ? o.waterFor(ctx.truth, id, water.load) : wellWater(water.load),
                  )
                : 0,
            };
            const eff = homeSrc?.quarantine
              ? quarantinedShared(shared, homeSrc.quarantine, homeSrc.healer === id)
              : shared;
            let src = homeSrc;
            let dose = exposureDose(def, homeSrc?.shed ?? (water ? 1 : 0), eff);
            if (placeSrc && here !== undefined) {
              const others = Math.max(0, (crowd.get(here) ?? 1) - 1);
              const open = here.endsWith("|") || here.endsWith(`|${VILLAGE_SQUARE}`);
              const common: Shared = {
                hours: PLACE_HOURS * days,
                closeness: 1 - exp(-others / CROWD_SCALE),
                ventilation: open ? OPEN_AIR : ROOM_AIR,
                waterDirt: 0,
                touch: 0.2,
              };
              const eff2 = placeSrc.quarantine
                ? quarantinedShared(common, placeSrc.quarantine, placeSrc.healer === id)
                : common;
              const d2 = exposureDose(def, placeSrc.shed, eff2);
              if (d2 > dose) {
                dose = d2;
                src = placeSrc;
              }
            }
            if (dose <= 0) continue;
            const got = tryInfect(
              def,
              dose,
              0,
              frailty,
              ctx.rng.fork("infect", id, def.id),
              ctx.now,
              null,
              susceptible,
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
          // Nada nuevo, pero puede haber pasado de incubar a tener sÃ­ntomas.
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

/** DÃ³nde estÃ¡ alguien hoy: hex y espacio (vacÃ­o es el campo abierto del hex). */
function placeKey(truth: ReadonlyWorldTruth, who: EntityRef): string | undefined {
  const loc = truth.get(LOCATION, who as never);
  return loc ? `${loc.hex}|${loc.space ?? ""}` : undefined;
}

/** El asentamiento de cada hogar, por el edificio que habita (de ahÃ­ sale quÃ© pozo usa). */
function householdSettlements(truth: ReadonlyWorldTruth): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of truth.ids(BUILDING)) {
    const b = truth.get(BUILDING, id);
    if (b?.household !== undefined && truth.get(ENTITY, id)?.endedAt === undefined) {
      out.set(b.household, b.settlement);
    }
  }
  return out;
}
