// El fuego de la aldea cableado a `life.upkeep` (settlements §9). Dos pasos: `fireDecisions` tira
// las chispas y la propagación con rng con clave (fogones y lámparas según el uso, rayo solo con
// tormenta, el fuego de un edificio sobre sus vecinos según distancia y viento), y `burnDay` gasta
// un día de incendio en un edificio: la materia que arde sale por el ledger (la ceniza a escombros,
// el resto a humo), el componente pierde masa y condición, y el edificio se derrumba si queda poco
// en pie. Cada evento cita su causa: la ignición el estado del edificio, el tiempo o el fuego
// vecino; cada día de fuego, el evento anterior del mismo incendio.

import {
  atan2,
  type BuildingId,
  type CauseRef,
  type EntityRef,
  type EventId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type Rng,
} from "../../core/index.ts";
import {
  ashShare,
  BUILDING,
  type BuildingComponent,
  type BuildingFire,
  type BuildingRecord,
  burnedGrams,
  type DayWeather,
  DEBRIS_SINK,
  draftEvent,
  type FireNode,
  fuelLoad,
  ignitionChance,
  materialUnit,
  nextIntensity,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  rebuildChoice,
  responseEffort,
  SMOKE_SINK,
  salvagedGrams,
  spreadChance,
  WORK,
} from "../../sim/index.ts";

/** Intensidad con que prende una chispa que no se apagó sola. */
export const INITIAL_INTENSITY = 0.2;
/** Con menos que esto el fuego se da por apagado. */
const OUT_BELOW = 0.04;
/** Si queda menos de esta parte de la materia en pie, el edificio se viene abajo. */
const COLLAPSE_BELOW_SHARE = 0.4;
/** Litros del pozo que equivalen a «agua de sobra» para apagar (calibración abierta). */
const WATER_FULL_L = 8000;

export interface Ignition {
  readonly cause: BuildingFire["cause"];
  /** El edificio vecino que lo contagió, si fue propagación. */
  readonly from?: string;
}

export interface FireContext {
  readonly truth: ReadonlyWorldTruth;
  readonly rng: Rng;
  readonly day: DayWeather;
  readonly fuelOf: (material: string) => number;
  /** Vivos por hogar (para el uso del fogón) y adultos por aldea (los vecinos que acuden). */
  readonly aliveOf: (household: string | undefined) => number;
  readonly adultsIn: (settlement: string) => number;
}

/** Sequedad 0-1 del día: la lluvia la baja a casi nada; sin lluvia, el calor la sube (calibración abierta). */
export function drynessOf(day: DayWeather): number {
  if (day.precip.kind !== "none" && day.precip.mm > 0)
    return Math.max(0, 0.15 - day.precip.mm / 100);
  return Math.min(1, Math.max(0, 0.45 + (day.tempMaxC - 10) / 40));
}

/** Tormenta: lluvia fuerte con viento (el clima aún no da rayos propios). */
export function stormOf(day: DayWeather): boolean {
  return day.precip.kind === "rain" && day.precip.mm >= 12 && day.windMs >= 9;
}

/** El esfuerzo de los vecinos de la aldea hoy: manos, agua del pozo, sin brigada todavía. */
export function settlementEffort(f: FireContext, settlement: string): number {
  let liters = 0;
  for (const id of f.truth.ids(WORK)) {
    const w = f.truth.get(WORK, id);
    if (w && w.kind === "well" && w.settlement === settlement) liters += w.capacity;
  }
  return responseEffort({
    neighbors: f.adultsIn(settlement),
    water: Math.min(1, liters / WATER_FULL_L),
    organized: false,
  });
}

function nodeOf(f: FireContext, id: string, b: BuildingRecord): FireNode {
  const wall = b.components.find((c) => c.part === "walls");
  return {
    id,
    at: b.at,
    fuelLoad: fuelLoad(b.components, f.fuelOf),
    // La piedra y el adobe frenan: lo que el muro tiene de menos combustible que la madera.
    firebreak: wall ? Math.max(0, 1 - fuelLoad([wall], f.fuelOf)) * 0.5 : 0,
  };
}

/** Qué edificios prenden hoy, por chispa o por contagio. El orden de ids lo fija el llamador. */
export function fireDecisions(f: FireContext, ids: readonly EntityRef[]): Map<string, Ignition> {
  const out = new Map<string, Ignition>();
  const dryness = drynessOf(f.day);
  const storm = stormOf(f.day);
  const windDirRad = atan2(f.day.windNorth, f.day.windEast);
  const nodes = new Map<string, FireNode>();
  const recs = new Map<string, BuildingRecord>();
  for (const id of ids) {
    const b = f.truth.get(BUILDING, id);
    if (!b) continue;
    recs.set(id, b);
    nodes.set(id, nodeOf(f, id, b));
  }
  const burning = [...recs].filter(([, b]) => b.fire !== undefined).map(([id]) => id);
  for (const [id, b] of recs) {
    if (b.fire) continue;
    const node = nodes.get(id);
    if (!node) continue;
    // Chispas: cada causa con su tirada.
    const use = b.household === undefined ? 0.2 : Math.min(1, f.aliveOf(b.household) / 6);
    const rng = f.rng.fork("ignite", id).stream();
    let cause: BuildingFire["cause"] | undefined;
    for (const c of ["hearth", "lamp", "lightning"] as const) {
      const p = ignitionChance({
        cause: c,
        fuelLoad: node.fuelLoad,
        dryness,
        use,
        storm,
      });
      if (rng.chance(p) && cause === undefined) cause = c;
    }
    if (cause) {
      out.set(id, { cause });
      continue;
    }
    // Contagio: el fuego de cada vecino que arde, con la respuesta de la aldea echando agua.
    const wetting = settlementEffort(f, b.settlement);
    for (const from of burning) {
      const src = recs.get(from);
      const fromNode = nodes.get(from);
      if (!src?.fire || !fromNode || src.settlement !== b.settlement) continue;
      const p = spreadChance({
        from: fromNode,
        to: node,
        intensity: src.fire.intensity,
        windMs: f.day.windMs,
        windDirRad,
        dryness,
        wetting,
      });
      if (p > 0 && f.rng.fork("spread", `${from}>${id}`).stream().chance(p)) {
        out.set(id, { cause: "spread", from });
        break;
      }
    }
  }
  return out;
}

function gramsOf(components: readonly BuildingComponent[]): number {
  return components.reduce((s, c) => s + c.materials.reduce((t, l) => t + l.grams, 0), 0);
}

export interface BurnResult {
  readonly record: BuildingRecord;
  readonly collapsed: boolean;
  readonly event: {
    readonly kind: "settlement.burned";
    readonly data: Record<string, unknown>;
    readonly causes: CauseRef[];
  };
  readonly transfers: {
    unit: ReturnType<typeof materialUnit>;
    from: ReturnType<typeof holderAccount>;
    to: ReturnType<typeof holderAccount> | ReturnType<typeof externalAccount>;
    amount: number;
  }[];
}

/**
 * Un día de fuego en un edificio que arde. `k` es el índice del evento en la tanda (para que el
 * `last` del incendio apunte al evento de hoy). Devuelve el edificio ya con el fuego apagado,
 * encendido más o caído, y el evento con sus transferencias.
 */
export function burnDay(
  f: FireContext,
  ledger: ReadonlyLedger | undefined,
  id: string,
  b: BuildingRecord,
  fire: BuildingFire,
  effort: number,
  rainMm: number,
  k: number,
): BurnResult {
  const holder: HolderRef = { kind: "building", building: id as BuildingId };
  const town: HolderRef = { kind: "settlement", settlement: b.settlement };
  const transfers: BurnResult["transfers"] = [];
  const budget = new Map<string, number>();
  const room = (material: string) => {
    if (!budget.has(material))
      budget.set(material, ledger?.balance(holderAccount(holder), materialUnit(material)) ?? 0);
    return budget.get(material) ?? 0;
  };
  const take = (material: string, grams: number) => {
    const g = Math.min(grams, room(material));
    budget.set(material, room(material) - g);
    return g;
  };

  // Lo que arde hoy, línea por línea.
  let burned = 0;
  let ash = 0;
  const burnedBy = new Map<string, number>();
  const components: BuildingComponent[] = b.components.map((c) => {
    const before = c.materials.reduce((s, l) => s + l.grams, 0);
    const lines = c.materials
      .map((l) => {
        const want = burnedGrams(l.grams, f.fuelOf(l.material), fire.intensity);
        const gone = Math.min(l.grams, want);
        if (gone > 0) burnedBy.set(l.material, (burnedBy.get(l.material) ?? 0) + gone);
        return { ...l, grams: l.grams - gone };
      })
      .filter((l) => l.grams > 0);
    const after = lines.reduce((s, l) => s + l.grams, 0);
    return {
      ...c,
      materials: lines,
      condition: before > 0 ? c.condition * (after / before) : c.condition,
    };
  });
  for (const [material, grams] of burnedBy) {
    const g = take(material, grams);
    if (g <= 0) continue;
    const a = Math.round(g * ashShare(f.fuelOf(material)));
    burned += g;
    ash += a;
    if (a > 0)
      transfers.push({
        unit: materialUnit(material),
        from: holderAccount(holder),
        to: externalAccount(DEBRIS_SINK),
        amount: a,
      });
    if (g - a > 0)
      transfers.push({
        unit: materialUnit(material),
        from: holderAccount(holder),
        to: externalAccount(SMOKE_SINK),
        amount: g - a,
      });
  }

  const left = gramsOf(components);
  const standing = fire.grams0 > 0 ? left / fire.grams0 : 0;
  const intensity = nextIntensity(
    fire.intensity,
    fuelLoad(components, f.fuelOf) * standing,
    effort,
    rainMm,
  );
  const collapsed = standing < COLLAPSE_BELOW_SHARE;
  const out = !collapsed && intensity < OUT_BELOW;

  let rebuild: string | undefined;
  let salvaged = 0;
  if (collapsed) {
    const mean = components.reduce((s, c) => s + c.condition, 0) / Math.max(1, components.length);
    let needed = 0;
    for (const material of new Set(components.flatMap((c) => c.materials.map((l) => l.material)))) {
      const has = room(material);
      if (has <= 0) continue;
      const kept = salvagedGrams(has, mean, false);
      needed += has;
      salvaged += kept;
      if (kept > 0)
        transfers.push({
          unit: materialUnit(material),
          from: holderAccount(holder),
          to: holderAccount(town),
          amount: kept,
        });
      if (has - kept > 0)
        transfers.push({
          unit: materialUnit(material),
          from: holderAccount(holder),
          to: externalAccount(DEBRIS_SINK),
          amount: has - kept,
        });
    }
    rebuild = rebuildChoice({
      neededGrams: needed + burned,
      salvagedGrams: salvaged,
      savingsGrams: 0,
      helpGrams: 0,
      siteUnsafe: false,
    });
  }

  const next: BuildingFire = { ...fire, intensity, last: draftEvent(k) as EventId };
  const { fire: _drop, ...rest } = b;
  const record: BuildingRecord = {
    ...rest,
    components,
    ...(collapsed || out ? {} : { fire: next }),
  };
  return {
    record,
    collapsed,
    transfers,
    event: {
      kind: "settlement.burned",
      data: {
        building: id,
        cause: fire.cause,
        intensity: Math.round(fire.intensity * 1000) / 1000,
        burnedGrams: burned,
        ashGrams: ash,
        effort: Math.round(effort * 1000) / 1000,
        since: fire.since,
        collapsed,
        extinguished: out,
        ...(collapsed ? { salvagedGrams: salvaged, rebuild } : {}),
      },
      causes: [{ kind: "event", event: fire.last }],
    },
  };
}
