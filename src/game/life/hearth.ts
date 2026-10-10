// Hogueras y hogares encendidos cableados (body-health §7, crafts §fuegos), opt-in: una vez por día
// cada fuego de `HEARTH` quema leña de la cuenta de su titular (sale del ledger hacia un sumidero con
// su evento: la leña no desaparece sin rastro) y guarda su intensidad efectiva; `hearthEnv` la
// suma como `radiantC` al ambiente de quien está en el mismo espacio (gancho `refineEnv` de
// `life.thermal`). Sin filas en `HEARTH` el proceso no escribe nada ni hay RNG: la aldea por
// defecto no cambia. `HEARTH` la escribe solo este proceso (`life.thermal` solo la lee, en otra fase).

import {
  type EntityRef,
  externalAccount,
  type LedgerAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  draftEvent,
  type EventDraft,
  HEARTH,
  hearthBurn,
  hearthRadiantC,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  type StateChange,
  type ThermalEnv,
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
          changes.push({ op: "delete", table: HEARTH.name, id });
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
 * encendidos lo que le llega a esa distancia. Sin fuegos, el ambiente vuelve igual.
 */
export function hearthEnv(
  spaces: SpaceGraph,
): (truth: ReadonlyWorldTruth, who: EntityRef, env: ThermalEnv) => ThermalEnv {
  return (truth, who, env) => {
    const space = truth.get(LOCATION, who)?.space;
    if (space === undefined) return env;
    const here = truth.ids(HEARTH).flatMap((id) => {
      const h = truth.get(HEARTH, id);
      return h !== undefined && h.space === space && h.intensity > 0 ? [h] : [];
    });
    if (here.length === 0) return env;
    const area = spaces.spaces.find((s) => s.key === space)?.area ?? 20;
    return { ...env, radiantC: Math.min(30, env.radiantC + hearthRadiantC(here, area)) };
  };
}
