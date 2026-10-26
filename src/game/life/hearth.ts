// Hogueras y hogares encendidos cableados (body-health §7, crafts §fuegos), opt-in: una vez por día
// cada fuego de `HEARTH` quema leña de la cuenta de su titular (sale del ledger hacia un sumidero con
// su evento: la leña no desaparece sin rastro) y guarda su intensidad efectiva; `hearthEnv` la
// suma como `radiantC` al ambiente de quien está en el mismo espacio (gancho `refineEnv` de
// `life.thermal`). Sin filas en `HEARTH` el proceso no escribe nada ni hay RNG: la aldea por
// defecto no cambia. `HEARTH` la escribe solo este proceso (`life.thermal` solo la lee, en otra fase).

import {
  compareStrings,
  type EntityRef,
  type EventId,
  type EventLog,
  externalAccount,
  holderAccount,
  type IdAllocator,
  type Ledger,
  type LedgerAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  BUILDING,
  draftEvent,
  ENTITY,
  type EventDraft,
  fireRadiantC,
  HEARTH,
  HEARTH_BURN_G_PER_H,
  HEARTH_WARMING,
  hearthBurn,
  hearthRadiantC,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  type StateChange,
  type ThermalEnv,
  WARM_DISTANCE_M,
  type WorldTruth,
} from "../../sim/index.ts";

export const HEARTH_PROCESS = "life.hearth";
/** Sumidero por defecto de la leña quemada (cenizas y humo); quien lo cablee lo declara en el ledger. */
export const BURNED_SINK = "burned";

export interface HearthOptions {
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, hearth: EntityRef) => PlaceRef;
  /** Nombre de la cuenta externa que recibe lo quemado (declarada con la unidad del fuego). */
  readonly sink?: string;
}

export function hearthProcess(o: HearthOptions): ProcessDef {
  return {
    id: HEARTH_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "physics",
    reads: [HEARTH.name],
    writes: [HEARTH.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: {
        event: ReturnType<typeof draftEvent>;
        transfers: {
          unit: ReturnType<typeof ledgerUnit>;
          from: LedgerAccount;
          to: LedgerAccount;
          amount: number;
        }[];
      }[] = [];
      const days = Math.max(1, ctx.window) / o.clock.day;
      const sink = externalAccount(o.sink ?? BURNED_SINK);
      for (const id of [...ctx.truth.ids(HEARTH)].sort()) {
        const h = ctx.truth.get(HEARTH, id);
        if (!h) continue;
        const unit = ledgerUnit(h.fuelUnit);
        const from = h.holder as LedgerAccount;
        const fuel = ctx.ledger?.balance(from, unit) ?? 0;
        const { burnedG, intensity } = hearthBurn(h, fuel, days);
        if (burnedG <= 0) {
          // Sin leña el hogar queda frío pero sigue ahí (lo apaga del todo `douse`): vuelve a
          // arder cuando la pila tiene leña otra vez.
          if (h.intensity !== 0) {
            changes.push({
              op: "set",
              table: HEARTH.name,
              id,
              value: { ...h, intensity: 0, at: ctx.now },
            });
          }
          continue;
        }
        const k = events.length;
        events.push({
          kind: "hearth.burned",
          actors: [],
          place: o.placeOf(ctx.truth, id),
          data: { space: h.space, burnedG, outOfFuel: burnedG >= fuel },
          emissions: { sight: 0.2 },
          causes: [{ kind: "state", entity: id, key: "body.hearth" }],
        });
        postings.push({
          event: draftEvent(k),
          transfers: [{ unit, from, to: sink, amount: burnedG }],
        });
        changes.push({
          op: "set",
          table: HEARTH.name,
          id,
          value: { ...h, intensity, at: ctx.now },
        });
      }
      return changes.length > 0 ? { changes, events, postings } : {};
    },
  };
}

/**
 * `refineEnv` para `life.thermal`: suma al `radiantC` de quien está en un espacio con fuegos
 * encendidos lo que le llega a esa distancia. Si en el tramo `span` del paso estuvo arrimado a uno
 * (`HEARTH_WARMING`, use-hearth-warm), suma además lo que le da estar pegado al fuego, en proporción
 * a la parte del tramo que estuvo ahí. Sin fuegos, el ambiente vuelve igual.
 */
export function hearthEnv(
  spaces: SpaceGraph,
): (
  truth: ReadonlyWorldTruth,
  who: EntityRef,
  env: ThermalEnv,
  span?: { readonly from: number; readonly to: number },
) => ThermalEnv {
  return (truth, who, env, span) => {
    const space = truth.get(LOCATION, who)?.space;
    if (space === undefined) return env;
    const here = truth.ids(HEARTH).flatMap((id) => {
      const h = truth.get(HEARTH, id);
      return h !== undefined && h.space === space && h.intensity > 0 ? [h] : [];
    });
    if (here.length === 0) return env;
    const area = spaces.spaces.find((s) => s.key === space)?.area ?? 20;
    const room = hearthRadiantC(here, area);
    const near = warmingC(truth, who, space, room, span);
    return { ...env, radiantC: Math.min(30, env.radiantC + room + near) };
  };
}

/**
 * Lo que suma estar arrimado al fuego sobre lo que ya da el cuarto, por la fracción del tramo que
 * se quedó ahí. Cero sin fila de `HEARTH_WARMING`, sin tramo o si el fuego no está en su espacio.
 */
function warmingC(
  truth: ReadonlyWorldTruth,
  who: EntityRef,
  space: string,
  roomC: number,
  span: { readonly from: number; readonly to: number } | undefined,
): number {
  if (span === undefined || span.to <= span.from) return 0;
  const w = truth.get(HEARTH_WARMING, who);
  if (w === undefined) return 0;
  const h = truth.get(HEARTH, w.hearth as EntityRef);
  if (h === undefined || h.space !== space || h.intensity <= 0) return 0;
  const overlap = Math.min(span.to, w.until) - Math.max(span.from, w.from);
  if (overlap <= 0) return 0;
  const fed = Math.min(1, (h.intensity * 24) / Math.max(1, h.litHoursPerDay));
  const close = fireRadiantC([{ intensity: fed, distanceM: WARM_DISTANCE_M }]);
  return (Math.max(0, close - roomC) * overlap) / (span.to - span.from);
}

// ---------------------------------------------------------------------------------------------
// Los hogares de la aldea al empezar (hearth-seed, opt-in `hearths`).

export const HEARTHS_LAID_EVENT = "life.hearths-laid";
/** La unidad de la leña del ledger (la misma que junta `gather` en el monte con `wildFirewood`). */
export const HEARTH_FUEL_UNIT = "good:firewood";
/** Horas por día que una casa tiene el hogar encendido (cocinar a la mañana y a la noche). */
export const HEARTH_LIT_HOURS = 5;
/** Leña apilada que tiene cada casa al empezar (g): una semana larga de hogar. */
export const HEARTH_WOODPILE_G = 60_000;

/** Debajo de esta pila (g, dos días de hogar) la casa sale a buscar leña al monte (hearth-npc). */
export const HEARTH_WOOD_LOW_G = 2 * HEARTH_LIT_HOURS * HEARTH_BURN_G_PER_H;
/** Gramos de leña caída que junta una persona en una hora de monte (como `gather` «leña»). */
export const HEARTH_WOOD_PER_HOUR_G = 3000;

export interface SeedHearthsOptions {
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
}

/**
 * Un hogar en el cuarto principal de cada casa habitada (`BUILDING.household`): fila `HEARTH` con
 * la cuenta del hogar como titular y la leña como combustible, y una pila de leña inicial desde la
 * fuente `seed`, todo con un evento cuya causa es la fundación. Devuelve cuántos hogares puso.
 */
export function seedHearths(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  ledger: Ledger,
  o: SeedHearthsOptions,
): number {
  const houses = truth
    .ids(BUILDING)
    .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined)
    .sort(compareStrings)
    .flatMap((id) => {
      const b = truth.get(BUILDING, id);
      const main = b?.graph.spaces[0];
      return b?.household !== undefined && main !== undefined
        ? [{ id, household: b.household, space: main.key }]
        : [];
    });
  if (houses.length === 0) return 0;
  const event = ids.next("event");
  log.append({
    id: event,
    tick: o.now,
    kind: HEARTHS_LAID_EVENT,
    actors: [],
    place: o.place,
    data: { hearths: houses.length, woodpileG: HEARTH_WOODPILE_G },
    emissions: {},
    causes: [{ kind: "event", event: o.foundersEvent }],
    resolution: "local",
  });
  const unit = ledgerUnit(HEARTH_FUEL_UNIT);
  const households = [...new Set(houses.map((h) => h.household))];
  ledger.post({
    tick: o.now,
    eventId: event,
    transfers: households.map((h) => ({
      unit,
      from: externalAccount("seed"),
      to: holderAccount(h),
      amount: HEARTH_WOODPILE_G,
    })),
  });
  for (const h of houses) {
    truth.set(HEARTH, h.id, {
      space: h.space,
      holder: holderAccount(h.household),
      fuelUnit: HEARTH_FUEL_UNIT,
      burnGramsPerHour: HEARTH_BURN_G_PER_H,
      litHoursPerDay: HEARTH_LIT_HOURS,
      intensity: 0,
      at: o.now,
    });
  }
  return houses.length;
}
