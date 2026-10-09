// El deterioro y el mantenimiento de la aldea día a día (settlements §7): el clima del día, el uso
// de los ocupantes y los defectos ocultos gastan cada componente; el hogar mantenedor, si tiene un
// adulto vivo, repara lo más gastado cuando se acuerda (una chance diaria: el que posterga deja que
// la casa se degrade más), y las puertas muy gastadas se traban con la humedad hasta que se
// arreglan. Reparar cambia materia por el ledger: el material nuevo entra de `gathered` (el monte
// y el campo) y lo cambiado sale a `debris`; el evento de reparación cita al anterior como causa.

import {
  type BuildingId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type PlanetClock,
  type Seed,
} from "../../core/index.ts";
import {
  BUILDING,
  type BuildingComponent,
  type BuildingRecord,
  collapseCheck,
  DEBRIS_SINK,
  type DoorState,
  doorBarrier,
  draftEvent,
  ENTITY,
  endEntity,
  GATHERED_SOURCE,
  jammedDoor,
  type LoadInput,
  type LocalMap,
  type MaterialDef,
  materialUnit,
  needsRepair,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  rebuildChoice,
  repairedCondition,
  repairedDefects,
  replacedGrams,
  replacedShare,
  restingDoor,
  type StateChange,
  salvagedGrams,
  setComponent,
  weatherAt,
  wornCondition,
} from "../../sim/index.ts";

export const UPKEEP_PROCESS = "life.upkeep";

/** Chance diaria de que el mantenedor se ponga a arreglar lo que está gastado (calibración abierta). */
export const REPAIR_CHANCE = 0.2;
/** Desde qué edad un miembro del hogar puede reparar. */
export const REPAIR_AGE_YEARS = 14;
/** Ocupantes que llevan el uso de una casa al máximo. */
const FULL_USE_OCCUPANTS = 6;
/** Uso de un edificio comunal (graneros: entra y sale gente de todos los hogares). */
const COMMUNAL_USE = 0.3;

export interface UpkeepOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
  readonly materials: readonly MaterialDef[];
}

interface Crew {
  readonly alive: number;
  readonly adults: number;
}

/** Vivos y adultos por hogar, de una pasada por la gente. */
function crewsOf(truth: ReadonlyWorldTruth, clock: PlanetClock, now: number): Map<string, Crew> {
  const crews = new Map<string, { alive: number; adults: number }>();
  for (const id of truth.ids(PERSON)) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const p = truth.get(PERSON, id);
    if (!p) continue;
    const crew = crews.get(p.household) ?? { alive: 0, adults: 0 };
    crew.alive += 1;
    if ((now - p.born) / clock.year >= REPAIR_AGE_YEARS) crew.adults += 1;
    crews.set(p.household, crew);
  }
  return crews;
}

export function upkeepProcess(o: UpkeepOptions): ProcessDef {
  const materials = new Map(o.materials.map((m) => [m.id, m]));
  return {
    id: UPKEEP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "physics",
    reads: [BUILDING.name, PERSON.name, ENTITY.name],
    writes: [BUILDING.name, ENTITY.name],
    run(ctx) {
      const ids = ctx.truth
        .ids(BUILDING)
        .filter((id) => ctx.truth.get(ENTITY, id)?.endedAt === undefined);
      if (ids.length === 0) return {};
      const days = Math.max(1, ctx.window) / o.clock.day;
      const day = weatherAt(o.map, o.clock, o.seed, ctx.now);
      const rainMm = day.precip.kind === "none" ? 0 : day.precip.mm;
      const exposure = { rainMm, frost: day.tempMinC < 0, windMs: day.windMs };
      const load: LoadInput = {
        rainMm: day.precip.kind === "rain" ? day.precip.mm : 0,
        snowMm: day.precip.kind === "snow" ? day.precip.mm : 0,
        windMs: day.windMs,
        quake: 0, // ninguna fuente produce sismos todavía
        weight: 0,
      };
      const crews = crewsOf(ctx.truth, o.clock, ctx.now);

      const changes: StateChange[] = [];
      const events: NonNullable<ReturnType<ProcessDef["run"]>["events"]>[number][] = [];
      const postings: NonNullable<ReturnType<ProcessDef["run"]>["postings"]>[number][] = [];

      for (const id of ids) {
        const b = ctx.truth.get(BUILDING, id);
        if (!b) continue;
        const crew = b.household === undefined ? undefined : crews.get(b.household);
        const use =
          b.household === undefined
            ? COMMUNAL_USE
            : Math.min(1, (crew?.alive ?? 0) / FULL_USE_OCCUPANTS);

        // Cuánto se gastó el día.
        let components: BuildingComponent[] = b.components.map((c) => {
          const mat = materials.get(c.materials[0]?.material ?? "");
          return mat ? { ...c, condition: wornCondition(c, mat, days, exposure, use) } : c;
        });

        // Derrumbe: parte bajo su umbral de ruina y una carga que no aguanta.
        const check = collapseCheck(components, load);
        const base = ctx.truth.get(ENTITY, id);
        if (check && base && ctx.rng.fork("collapse", id).stream().chance(check.risk)) {
          const k = events.length;
          const holder: HolderRef = { kind: "building", building: id as BuildingId };
          const town: HolderRef = { kind: "settlement", settlement: b.settlement };
          const meanCondition =
            components.reduce((s, c) => s + c.condition, 0) / Math.max(1, components.length);
          const transfers: {
            unit: ReturnType<typeof materialUnit>;
            from: ReturnType<typeof holderAccount>;
            to: ReturnType<typeof holderAccount> | ReturnType<typeof externalAccount>;
            amount: number;
          }[] = [];
          let needed = 0;
          let salvaged = 0;
          for (const matId of new Set(
            components.flatMap((c) => c.materials.map((l) => l.material)),
          )) {
            const unit = materialUnit(matId);
            const has = ctx.ledger?.balance(holderAccount(holder), unit) ?? 0;
            if (has <= 0) continue;
            const kept = salvagedGrams(has, meanCondition, check.cause === "quake");
            needed += has;
            salvaged += kept;
            if (kept > 0)
              transfers.push({
                unit,
                from: holderAccount(holder),
                to: holderAccount(town),
                amount: kept,
              });
            if (has - kept > 0)
              transfers.push({
                unit,
                from: holderAccount(holder),
                to: externalAccount(DEBRIS_SINK),
                amount: has - kept,
              });
          }
          const rebuild = rebuildChoice({
            neededGrams: needed,
            salvagedGrams: salvaged,
            savingsGrams: 0,
            helpGrams: 0,
            siteUnsafe: check.cause === "quake",
          });
          events.push({
            kind: "settlement.collapsed",
            actors: [],
            place: { kind: "settlement", settlement: b.settlement },
            data: {
              building: id,
              part: check.part,
              cause: check.cause,
              load: Math.round(check.load * 1000) / 1000,
              capacity: Math.round(check.capacity * 1000) / 1000,
              salvagedGrams: salvaged,
              rebuild,
            },
            emissions: {},
            causes: [
              { kind: "event", event: b.lastRepair ?? b.builtBy },
              { kind: "state", entity: id, key: `condition.${check.part}` },
            ],
          });
          if (transfers.length > 0) postings.push({ event: draftEvent(k), transfers });
          changes.push(endEntity(base, draftEvent(k), ctx.now));
          continue;
        }

        // Si el que mantiene puede y se acuerda, arregla lo más gastado.
        const canRepair =
          b.household === undefined || (b.maintainer === b.household && (crew?.adults ?? 0) > 0);
        const worst = needsRepair(components)[0];
        let lastRepair = b.lastRepair;
        if (canRepair && worst) {
          const rng = ctx.rng.fork("repair", id).stream();
          const mat = materials.get(worst.materials[0]?.material ?? "");
          if (mat && rng.chance(REPAIR_CHANCE)) {
            const total = worst.materials.reduce((s, l) => s + l.grams, 0);
            const grams = replacedGrams(total, replacedShare(worst.condition, worst.quality));
            const holder: HolderRef = { kind: "building", building: id as BuildingId };
            const unit = materialUnit(mat.id);
            const has = ctx.ledger?.balance(holderAccount(holder), unit) ?? 0;
            if (grams > 0 && has >= grams) {
              const share = grams / total;
              const k = events.length;
              events.push({
                kind: "settlement.repaired",
                actors: [],
                place: { kind: "settlement", settlement: b.settlement },
                data: { building: id, part: worst.part, material: mat.id, grams },
                emissions: {},
                causes: [{ kind: "event", event: b.lastRepair ?? b.builtBy }],
              });
              postings.push({
                event: draftEvent(k),
                transfers: [
                  {
                    unit,
                    from: holderAccount(holder),
                    to: externalAccount(DEBRIS_SINK),
                    amount: grams,
                  },
                  {
                    unit,
                    from: externalAccount(GATHERED_SOURCE),
                    to: holderAccount(holder),
                    amount: grams,
                  },
                ],
              });
              components = components.map((c) =>
                c.part === worst.part
                  ? {
                      ...c,
                      condition: repairedCondition(c.condition, share),
                      defects: repairedDefects(c.defects, share),
                      materials: replaceMass(c, grams, draftEvent(k)),
                    }
                  : c,
              );
              lastRepair = draftEvent(k);
            }
          }
        }

        // La puerta: se traba gastada y con humedad, y arreglada vuelve a su reposo.
        const door = components.find((c) => c.part === "door");
        const rest = restingDoor(b.household !== undefined);
        const prev: DoorState = b.doorState ?? rest;
        const doorState: DoorState = jammedDoor(door, rainMm)
          ? "jammed"
          : prev === "jammed" && door !== undefined && door.condition >= 0.3
            ? rest
            : prev;

        const next: BuildingRecord = {
          ...b,
          components,
          doorState,
          ...(lastRepair !== undefined ? { lastRepair } : {}),
          graph: { ...b.graph, door: doorBarrier(doorState) },
        };
        changes.push(setComponent(BUILDING, id, next));
      }
      return { changes, events, postings };
    },
  };
}

/** Quita `grams` de las líneas de un componente (las más pesadas primero) y suma las nuevas con su origen. */
function replaceMass(
  c: BuildingComponent,
  grams: number,
  origin: BuildingComponent["materials"][number]["origin"],
): BuildingComponent["materials"] {
  let left = grams;
  const lines = [...c.materials]
    .sort((a, b) => b.grams - a.grams)
    .map((l) => {
      const take = Math.min(l.grams, left);
      left -= take;
      return { ...l, grams: l.grams - take };
    })
    .filter((l) => l.grams > 0);
  const material = c.materials[0]?.material ?? "";
  return [...lines, { material, grams, origin }];
}
