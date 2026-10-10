// El deterioro y el mantenimiento de la aldea día a día (settlements §7): el clima del día, el uso
// de los ocupantes y los defectos ocultos gastan cada componente; el hogar mantenedor, si tiene un
// adulto vivo, repara lo más gastado cuando se acuerda (una chance diaria: el que posterga deja que
// la casa se degrade más), y las puertas muy gastadas se traban con la humedad hasta que se
// arreglan. Reparar cambia materia por el ledger: el material nuevo entra de `gathered` (el monte
// y el campo) y lo cambiado sale a `debris`; el evento de reparación cita al anterior como causa.

import {
  type AgentId,
  type BuildingId,
  cos,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type PlanetClock,
  type Seed,
  sin,
  TAU,
} from "../../core/index.ts";
import {
  BUILDING,
  type BuildingComponent,
  type BuildingFire,
  type BuildingRecord,
  COPPER,
  collapseCheck,
  createEntity,
  DEBRIS_SINK,
  DEFAULT_MATERIAL_COPPER_PER_KG,
  type DoorState,
  doorBarrier,
  draftEvent,
  ENTITY,
  endEntity,
  fuelLoad,
  GATHERED_SOURCE,
  gramsBought,
  jammedDoor,
  LOCATION,
  type LoadInput,
  type LocalMap,
  laborGrams,
  type MaterialDef,
  MIN_REBUILD_DAYS,
  materialUnit,
  needsRepair,
  PERSON,
  type ProcessDef,
  planRebuild,
  REBUILD_CHOICES,
  REBUILD_SAVINGS_SHARE,
  RELOCATE_M,
  type ReadonlyLedger,
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
  VILLAGE_SQUARE,
  WAGES_SINK,
  WORK,
  weatherAt,
  wornCondition,
} from "../../sim/index.ts";
import {
  burnDay,
  type FireContext,
  fireDecisions,
  INITIAL_INTENSITY,
  settlementEffort,
} from "./fire.ts";

export const UPKEEP_PROCESS = "life.upkeep";

/** Chance diaria de que el mantenedor se ponga a arreglar lo que está gastado (calibración abierta). */
export const REPAIR_CHANCE = 0.2;
/** Desde qué edad un miembro del hogar puede reparar. */
export const REPAIR_AGE_YEARS = 14;
/** Ocupantes que llevan el uso de una casa al máximo. */
const FULL_USE_OCCUPANTS = 6;
/** Uso de un edificio comunal (graneros: entra y sale gente de todos los hogares). */
const COMMUNAL_USE = 0.3;
/** Qué parte de los adultos de la aldea levanta un edificio comunal caído. */
const COMMUNAL_CREW = 0.15;

export interface UpkeepOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
  readonly materials: readonly MaterialDef[];
  /** Opt-in: la reconstrucción «distinta» puede cambiar de material según lo que haya y alcance. */
  readonly swapMaterials?: boolean;
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
    reads: [BUILDING.name, PERSON.name, ENTITY.name, WORK.name, LOCATION.name],
    writes: [BUILDING.name, ENTITY.name, LOCATION.name],
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

      const adultsIn = [...crews.values()].reduce((n, c) => n + c.adults, 0);
      const fireCtx: FireContext = {
        truth: ctx.truth,
        rng: ctx.rng,
        day,
        fuelOf: (m) => materials.get(m)?.fuel ?? 0,
        aliveOf: (h) => (h === undefined ? 0 : (crews.get(h)?.alive ?? 0)),
        adultsIn: () => adultsIn,
        savingsOf: (b) => savingsGramsOf(ctx.truth, ctx.ledger, b, materials),
      };
      const ignitions = fireDecisions(fireCtx, ids);

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
            savingsGrams: savingsGramsOf(ctx.truth, ctx.ledger, { ...b, components }, materials),
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
          changes.push(
            endEntity(base, draftEvent(k), ctx.now),
            setComponent(BUILDING, id, { ...b, components, ruin: { cause: check.cause, rebuild } }),
            ...evict(ctx.truth, b),
          );
          continue;
        }

        // Fuego (settlements §9): un día de incendio, o una chispa nueva que prende hoy.
        let fireNow: BuildingFire | undefined = b.fire;
        if (b.fire && base) {
          const effort = settlementEffort(fireCtx, b.settlement);
          const k = events.length;
          const burn = burnDay(
            fireCtx,
            ctx.ledger,
            id,
            { ...b, components },
            b.fire,
            effort,
            rainMm,
            k,
          );
          events.push({
            kind: burn.event.kind,
            actors: [],
            place: { kind: "settlement", settlement: b.settlement },
            data: burn.event.data,
            emissions: {},
            causes: burn.event.causes,
          });
          if (burn.transfers.length > 0)
            postings.push({ event: draftEvent(k), transfers: burn.transfers });
          if (burn.collapsed) {
            const choice = burn.rebuild;
            changes.push(
              endEntity(base, draftEvent(k), ctx.now),
              setComponent(BUILDING, id, {
                ...burn.record,
                ruin: {
                  cause: "fire",
                  rebuild: REBUILD_CHOICES.find((c) => c === choice) ?? "different",
                },
              }),
              ...evict(ctx.truth, b),
            );
            continue;
          }
          components = [...burn.record.components];
          fireNow = burn.record.fire;
        } else if (ignitions.has(id)) {
          const ig = ignitions.get(id);
          const src =
            ig?.from === undefined ? undefined : ctx.truth.get(BUILDING, ig.from as EntityRef);
          if (ig) {
            const k = events.length;
            events.push({
              kind: "settlement.ignited",
              actors: [],
              place: { kind: "settlement", settlement: b.settlement },
              data: {
                building: id,
                cause: ig.cause,
                fuelLoad: Math.round(fuelLoad(components, fireCtx.fuelOf) * 1000) / 1000,
                ...(ig.from !== undefined ? { from: ig.from } : {}),
              },
              emissions: {},
              causes:
                src?.fire !== undefined
                  ? [{ kind: "event", event: src.fire.last }]
                  : [
                      {
                        kind: "state",
                        entity: id,
                        key: ig.cause === "lightning" ? "weather.storm" : "fuelLoad",
                      },
                    ],
            });
            fireNow = {
              intensity: INITIAL_INTENSITY,
              cause: ig.cause,
              grams0: components.reduce(
                (n, c) => n + c.materials.reduce((t, l) => t + l.grams, 0),
                0,
              ),
              since: ctx.now,
              last: draftEvent(k),
            };
          }
        }

        // Si el que mantiene puede y se acuerda, arregla lo más gastado.
        const canRepair =
          fireNow === undefined &&
          (b.household === undefined || (b.maintainer === b.household && (crew?.adults ?? 0) > 0));
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

        const { fire: _burning, ...still } = b;
        const next: BuildingRecord = {
          ...still,
          ...(fireNow !== undefined ? { fire: fireNow } : {}),
          components,
          doorState,
          ...(lastRepair !== undefined ? { lastRepair } : {}),
          graph: { ...b.graph, door: doorBarrier(doorState) },
        };
        changes.push(setComponent(BUILDING, id, next));
      }
      rebuildRuins(ctx, o, materials, crews, adultsIn, changes, events, postings);
      return { changes, events, postings };
    },
  };
}

type Out<K extends "events" | "postings"> = NonNullable<ReturnType<ProcessDef["run"]>[K]>[number][];

/**
 * Reconstrucción efectiva (settlements §7, §11): cada edificio caído que nadie reemplazó lo
 * levanta su hogar (o la aldea, si era comunal) cuando el trabajo y la materia salvada alcanzan,
 * en lo que eligieron al caer. Lo salvado sale del depósito de la aldea y lo demás se junta del
 * monte; el edificio nuevo cita la caída como causa. Sin ledger no se levanta nada.
 */
function rebuildRuins(
  ctx: Parameters<ProcessDef["run"]>[0],
  o: UpkeepOptions,
  materials: ReadonlyMap<string, MaterialDef>,
  crews: ReadonlyMap<string, Crew>,
  adultsIn: number,
  changes: StateChange[],
  events: Out<"events">,
  postings: Out<"postings">,
): void {
  const ledger = ctx.ledger;
  if (!ledger) return;
  const all = ctx.truth.ids(BUILDING);
  const replaced = new Set(all.flatMap((id) => ctx.truth.get(BUILDING, id)?.replaces ?? []));
  const stock = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const id of all) {
    const ruin = ctx.truth.get(BUILDING, id);
    const base = ctx.truth.get(ENTITY, id);
    if (!ruin?.ruin || base?.endedAt === undefined || base.endEventId === undefined) continue;
    if (replaced.has(id)) continue;
    const own =
      ruin.household === undefined
        ? Math.ceil(adultsIn * COMMUNAL_CREW)
        : (crews.get(ruin.household)?.adults ?? 0);
    if (own <= 0) continue;
    const days = (ctx.now - base.endedAt) / o.clock.day;
    if (days < MIN_REBUILD_DAYS) continue;

    // Componentes del caído con material (lo que ardió por completo hereda el de otro componente).
    const fallback = ruin.components.find((c) => c.materials.length > 0)?.materials[0];
    if (!fallback) continue;
    const old = ruin.components.map((c) =>
      c.materials.length > 0 ? c : { ...c, materials: [{ ...fallback, grams: 0 }] },
    );
    const town: HolderRef = { kind: "settlement", settlement: ruin.settlement };
    for (const m of new Set(old.flatMap((c) => c.materials.map((l) => l.material)))) {
      if (!stock.has(m)) stock.set(m, ledger.balance(holderAccount(town), materialUnit(m)));
    }
    const k = events.length;
    const pays =
      ruin.household === undefined ? [] : pursesOf(ctx.truth, ledger, ruin.household, spent);
    const coins = Math.floor(pays.reduce((n, p) => n + p.coins, 0) * REBUILD_SAVINGS_SHARE);
    const plan = planRebuild({
      old,
      choice: ruin.ruin.rebuild,
      gramsPerM2: (m) => materials.get(m)?.gramsPerM2 ?? 0,
      stock,
      labor: laborGrams(own, adultsIn - own, days),
      coins,
      pricePerKg: (m) => materials.get(m)?.priceCopperPerKg ?? DEFAULT_MATERIAL_COPPER_PER_KG,
      ...(o.swapMaterials
        ? {
            alternatives: (m: string, part: BuildingComponent["part"]) =>
              [...materials.values()]
                .filter((x) => x.id !== m && (x.parts === undefined || x.parts.includes(part)))
                .map((x) => x.id),
          }
        : {}),
      built: draftEvent(k),
    });
    if (!plan) continue;
    // Lo comprado sale de las bolsas del hogar (las más llenas primero) hacia los jornales.
    const payments: { holder: HolderRef; amount: number }[] = [];
    let owed = plan.coinsSpent;
    for (const p of [...pays].sort((a, b) => b.coins - a.coins)) {
      if (owed <= 0) break;
      const amount = Math.min(owed, p.coins);
      if (amount <= 0) continue;
      owed -= amount;
      payments.push({ holder: p.holder, amount });
      spent.set(p.key, (spent.get(p.key) ?? 0) + amount);
    }
    for (const [m, g] of plan.salvaged) stock.set(m, (stock.get(m) ?? 0) - g);

    const nid = ctx.newId("building");
    const holder: HolderRef = { kind: "building", building: nid };
    const transfers = [
      ...[...plan.salvaged].map(([m, g]) => ({
        unit: materialUnit(m),
        from: holderAccount(town),
        to: holderAccount(holder),
        amount: g,
      })),
      ...[...plan.gathered].map(([m, g]) => ({
        unit: materialUnit(m),
        from: externalAccount(GATHERED_SOURCE),
        to: holderAccount(holder),
        amount: g,
      })),
      ...payments.map((p) => ({
        unit: COPPER,
        from: holderAccount(p.holder),
        to: externalAccount(WAGES_SINK),
        amount: p.amount,
      })),
    ];
    let at = ruin.at;
    if (ruin.ruin.rebuild === "elsewhere") {
      const a = ctx.rng.fork("rebuild", id).stream().float() * TAU;
      at = { x: Math.round(at.x + RELOCATE_M * cos(a)), y: Math.round(at.y + RELOCATE_M * sin(a)) };
    }
    const { fire: _f, ruin: _r, lastRepair: _l, doorState: _d, ...kept } = ruin as BuildingRecord;
    const rest = restingDoor(ruin.household !== undefined);
    const sum = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((n, g) => n + g, 0);
    events.push({
      kind: "settlement.rebuilt",
      actors: [],
      place: { kind: "settlement", settlement: ruin.settlement },
      data: {
        building: nid,
        replaces: id,
        choice: ruin.ruin.rebuild,
        cause: ruin.ruin.cause,
        salvagedGrams: sum(plan.salvaged),
        gatheredGrams: sum(plan.gathered),
        boughtGrams: sum(plan.bought),
        coinsSpent: plan.coinsSpent,
        days: Math.round(days),
      },
      emissions: {},
      causes: [{ kind: "event", event: base.endEventId }],
    });
    if (transfers.length > 0) postings.push({ event: draftEvent(k), transfers });
    changes.push(
      createEntity(nid, draftEvent(k), ctx.now),
      setComponent(BUILDING, nid, {
        ...kept,
        at,
        components: plan.components,
        builtBy: draftEvent(k),
        replaces: id,
        graph: { ...ruin.graph, door: doorBarrier(rest) },
      }),
    );
  }
}

interface Purse {
  readonly holder: HolderRef;
  readonly key: string;
  readonly coins: number;
}

/** Las bolsas de cobre del hogar (miembros vivos y la casa), menos lo ya gastado hoy en otras obras. */
function pursesOf(
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger,
  household: string,
  spent: ReadonlyMap<string, number>,
): Purse[] {
  const holders: { holder: HolderRef; key: string }[] = [
    { holder: household as unknown as HolderRef, key: household },
  ];
  for (const id of truth.ids(PERSON)) {
    if (truth.get(PERSON, id)?.household !== household) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    holders.push({ holder: id as AgentId as unknown as HolderRef, key: id });
  }
  return holders
    .map((h) => ({
      ...h,
      coins: Math.max(0, ledger.balance(holderAccount(h.holder), COPPER) - (spent.get(h.key) ?? 0)),
    }))
    .filter((p) => p.coins > 0);
}

/**
 * Cuántos gramos de la materia principal del edificio compraría el hogar con lo que está dispuesto
 * a gastar (`REBUILD_SAVINGS_SHARE` de sus monedas): los ahorros que entran en `rebuildChoice`.
 * Sin ledger o sin hogar (comunal), 0.
 */
function savingsGramsOf(
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger | undefined,
  b: BuildingRecord,
  materials: ReadonlyMap<string, MaterialDef>,
): number {
  if (!ledger || b.household === undefined) return 0;
  const coins = pursesOf(truth, ledger, b.household, new Map()).reduce((n, p) => n + p.coins, 0);
  const main = materials.get(b.components[0]?.materials[0]?.material ?? "");
  const price = main?.priceCopperPerKg ?? DEFAULT_MATERIAL_COPPER_PER_KG;
  return gramsBought(Math.floor(coins * REBUILD_SAVINGS_SHARE), price);
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

/** Los que estaban dentro cuando el edificio cayó quedan en la plaza (sin heridas todavía). */
function evict(truth: ReadonlyWorldTruth, b: BuildingRecord): StateChange[] {
  const keys = new Set<string>(b.graph.spaces.map((s) => s.key));
  return truth.ids(PERSON).flatMap((id) => {
    const here = truth.get(LOCATION, id);
    if (here?.space === undefined || !keys.has(here.space)) return [];
    return [setComponent(LOCATION, id, { hex: here.hex, space: VILLAGE_SQUARE })];
  });
}
