// Hambruna con causa cableada a la vida (economy §«Crisis con causa»). Apagada por defecto: sin
// `FamineOptions` no se agrega el proceso, así que no hay filas, RNG ni eventos y la aldea por
// defecto no cambia. Una vez por día lee, por asentamiento, el grano guardado en sus hogares y lo
// que come su gente, calcula la presión de escasez (`sim/economy/famine.ts`) y, solo cuando el
// estado cambia (escasez, hambruna, fin), deja `famine.began|worsened|ended` con su causa y el
// estado en `FAMINE`. No mata, no mueve gente ni toca precios: declara el empuje de precio y de
// migración para que sus dueños lo lean.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  BUILDING,
  citePressure,
  draftEvent,
  ENTITY,
  type EventDraft,
  FAMINE_HORIZON_DAYS,
  famineDischarge,
  famineState,
  type GoodDef,
  goodUnit,
  PERSON,
  PRESSURE,
  type PressureReading,
  type PressureSource,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SCARCITY_THRESHOLD,
  type StateChange,
  scarcityValue,
  setComponent,
} from "../../sim/index.ts";
import { FAMINE, type FamineRow } from "./famineRow.ts";
import { GRAIN_EATEN_PER_PERSON_DAY_G } from "./larder.ts";

export const FAMINE_PROCESS = "life.famine";

export { FAMINE, type FamineRow };

/**
 * La hambruna de cada asentamiento como presión `hunger` de comunidad para el libro y el
 * inspector: sale de `FAMINE` (sin filas, no hay lecturas). La descarga es `life.famine`.
 */
export function communityHungerSource(): PressureSource {
  return {
    kind: "hunger",
    read({ truth }): PressureReading[] {
      return truth.ids(FAMINE).flatMap((id): PressureReading[] => {
        const row = truth.get(FAMINE, id);
        if (!row || row.state === "none") return [];
        return [
          {
            kind: "hunger",
            scope: { kind: "community", ref: id as unknown as EntityRef },
            value: row.value,
            sources: [{ kind: "state", entity: id as unknown as EntityRef, key: "food-scarcity" }],
            discharges: [
              { process: FAMINE_PROCESS, threshold: SCARCITY_THRESHOLD, hazard: 0, blockers: [] },
            ],
            system: "economy",
          },
        ];
      });
    },
  };
}

export interface FamineOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  /** El bien que es la comida de base (`grain`). */
  readonly staple: string;
  /** Gramos de cosecha esperados por día en el asentamiento; sin esto no se espera cosecha. */
  readonly expectedHarvestGramsPerDay?: (
    settlement: string,
    dayOffset: number,
    today: number,
  ) => number;
  readonly horizonDays?: number;
  /**
   * Opt-in: mientras dura una escasez o hambruna, cada día se refresca el valor (y los empujes) de
   * la fila aunque el estado no cambie, sin evento; así la presión `hunger` lee el valor de hoy.
   */
  readonly refresh?: boolean;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function famineProcess(o: FamineOptions): ProcessDef {
  const def = o.goods.find((g) => g.id === o.staple);
  return {
    id: FAMINE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, BUILDING.name, FAMINE.name, PRESSURE.name],
    writes: [FAMINE.name, PRESSURE.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || !def) return {};
      const unit = goodUnit(def);
      const today = Math.floor(ctx.now / o.clock.day);
      const homeOf = new Map<string, string>();
      for (const id of ctx.truth.ids(BUILDING)) {
        const b = ctx.truth.get(BUILDING, id);
        if (b?.household !== undefined && ctx.truth.get(ENTITY, id)?.endedAt === undefined) {
          homeOf.set(b.household, b.settlement);
        }
      }
      const stock = new Map<string, number>();
      const mouths = new Map<string, number>();
      const speaker = new Map<string, AgentId>();
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const p = ctx.truth.get(PERSON, id);
        const s = p ? homeOf.get(p.household) : undefined;
        if (!p || s === undefined) continue;
        mouths.set(s, (mouths.get(s) ?? 0) + 1);
        if (!speaker.has(s)) speaker.set(s, id as AgentId);
      }
      for (const [home, s] of [...homeOf].sort()) {
        const held = ledger.balance(holderAccount(home as unknown as HolderRef), unit) ?? 0;
        stock.set(s, (stock.get(s) ?? 0) + held);
      }
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const s of [...mouths.keys()].sort()) {
        const who = speaker.get(s);
        if (who === undefined) continue;
        const value = scarcityValue({
          stockGrams: stock.get(s) ?? 0,
          harvestGramsOnDay: (d) => o.expectedHarvestGramsPerDay?.(s, d, today) ?? 0,
          eatenPerDay: (mouths.get(s) ?? 0) * GRAIN_EATEN_PER_PERSON_DAY_G,
          horizonDays: o.horizonDays ?? FAMINE_HORIZON_DAYS,
        });
        const prev = ctx.truth.get(FAMINE, s as never);
        const state = famineState(value, prev?.state ?? "none");
        if (state === (prev?.state ?? "none")) {
          if (o.refresh && prev && state !== "none" && prev.value !== value) {
            const r = famineDischarge(value, state);
            changes.push(
              setComponent(FAMINE, s as never, {
                ...prev,
                value,
                pricePush: r.pricePush,
                migrationPull: r.migrationPull,
              }),
            );
          }
          continue;
        }
        const d = famineDischarge(value, state);
        const kind =
          state === "none"
            ? "famine.ended"
            : prev?.state === "famine"
              ? "famine.eased"
              : state === "famine"
                ? "famine.worsened"
                : "famine.began";
        // Escasez o hambruna es la descarga de la presión: la cita (nace del primer evento).
        const cite =
          state === "none"
            ? undefined
            : citePressure(
                ctx,
                {
                  kind: "hunger",
                  scope: { kind: "community", ref: s as unknown as EntityRef },
                  value,
                },
                draftEvent(events.length),
              );
        if (cite) changes.push(...cite.changes);
        events.push({
          kind,
          actors: [who],
          place: o.placeOf(ctx.truth, who),
          data: {
            settlement: s,
            state,
            value,
            pricePush: d.pricePush,
            migrationPull: d.migrationPull,
          },
          emissions: {},
          causes: [
            ...(cite ? [cite.cause] : []),
            { kind: "state", entity: s as unknown as EntityRef, key: "food-scarcity" },
          ],
        });
        changes.push(
          setComponent(FAMINE, s as never, {
            state,
            value,
            since: today,
            pricePush: d.pricePush,
            migrationPull: d.migrationPull,
          }),
        );
      }
      if (events.length === 0) return changes.length === 0 ? {} : { changes };
      return { events, changes };
    },
  };
}
