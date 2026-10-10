// Migración de hogares por hambruna, solo la decisión (economy §«Crisis con causa»). Opt-in: sin
// `MigrationOptions` no se agrega el proceso, así que no hay filas, RNG ni eventos y la aldea por
// defecto no cambia. Una vez por día, cada hogar de un asentamiento con `FAMINE.migrationPull` > 0
// pesa irse (`decidesToLeave`: empuje, arraigo, medios) y adónde (`chooseDestination`) y, si se
// decide, deja `migration.decided` con su causa y su fila en `MIGRATIONS` (destino y día de salida).
// No mueve casa, gente ni bienes: la mudanza es un ítem aparte. Tabla propia, escritor único.
// El destino se lee de `FAMINE` (verdad), no de lo que el hogar cree: pendiente con las creencias.

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
  chooseDestination,
  type Destination,
  decidesToLeave,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { FAMINE } from "./famineRow.ts";
import { GRAIN_EATEN_PER_PERSON_DAY_G } from "./larder.ts";

export const MIGRATION_PROCESS = "life.migration";

/** La decisión de un hogar de irse: vive en la entidad del hogar (su clave). */
export interface MigrationRow {
  readonly from: string;
  readonly to: string;
  readonly decidedOn: number;
  /** Día en que sale (después de juntar lo del viaje). */
  readonly departsOn: number;
  readonly state: "leaving";
}
export const MIGRATIONS = table<MigrationRow>("economy.migrations");

/** Días entre decidir y salir. Sin calibrar. */
export const MIGRATION_PREP_DAYS = 3;
/** Días de comida que el hogar necesita guardada para contar con medios plenos. Sin calibrar. */
export const MIGRATION_MEANS_DAYS = 30;

export interface MigrationOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  /** El bien que es la comida de base (`grain`). */
  readonly staple: string;
  /** Arraigo del hogar, 0..1 (por defecto 0.3). */
  readonly attachment?: (truth: ReadonlyWorldTruth, household: string) => number;
  /** Costo del viaje entre asentamientos, 0..1 (por defecto 0.3). */
  readonly travelCost?: (from: string, to: string) => number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function migrationProcess(o: MigrationOptions): ProcessDef {
  const def = o.goods.find((g) => g.id === o.staple);
  return {
    id: MIGRATION_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, BUILDING.name, FAMINE.name, MIGRATIONS.name],
    writes: [MIGRATIONS.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || !def) return {};
      const unit = goodUnit(def);
      const today = Math.floor(ctx.now / o.clock.day);
      const homes = new Map<string, string>();
      const settlements = new Set<string>();
      for (const id of [...ctx.truth.ids(BUILDING)].sort()) {
        const b = ctx.truth.get(BUILDING, id);
        if (!b || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        settlements.add(b.settlement);
        if (b.household !== undefined) homes.set(b.household, b.settlement);
      }
      const members = new Map<string, AgentId[]>();
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const p = ctx.truth.get(PERSON, id);
        if (!p || !homes.has(p.household)) continue;
        const list = members.get(p.household) ?? [];
        list.push(id as AgentId);
        members.set(p.household, list);
      }
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const [home, from] of [...homes].sort()) {
        const row = ctx.truth.get(FAMINE, from as never);
        if (!row || row.state === "none" || row.migrationPull <= 0) continue;
        if (ctx.truth.get(MIGRATIONS, home as never)) continue;
        const who = members.get(home)?.[0];
        if (who === undefined) continue;
        const mouths = members.get(home)?.length ?? 0;
        const held = ledger.balance(holderAccount(home as unknown as HolderRef), unit) ?? 0;
        const need = mouths * GRAIN_EATEN_PER_PERSON_DAY_G * MIGRATION_MEANS_DAYS;
        const means = need > 0 ? Math.min(1, held / need) : 0;
        const inputs = {
          pull: row.migrationPull,
          attachment: o.attachment?.(ctx.truth, home) ?? 0.3,
          means,
        };
        const rng = ctx.rng.fork("migration", home, today);
        if (!decidesToLeave(inputs, rng.float())) continue;
        const options = new Map<string, Destination>();
        for (const s of settlements) {
          if (s === from) continue;
          const f = ctx.truth.get(FAMINE, s as never);
          options.set(s, {
            believedScarcity: f && f.state !== "none" ? f.value : 0,
            pull: f?.migrationPull ?? 0,
            travelCost: o.travelCost?.(from, s) ?? 0.3,
            ties: 0,
          });
        }
        const to = chooseDestination(options);
        if (to === undefined) continue;
        events.push({
          kind: "migration.decided",
          actors: members.get(home) ?? [who],
          place: o.placeOf(ctx.truth, who),
          data: { household: home, from, to, departsOn: today + MIGRATION_PREP_DAYS },
          emissions: {},
          causes: [{ kind: "state", entity: from as unknown as EntityRef, key: "food-scarcity" }],
        });
        changes.push(
          setComponent(MIGRATIONS, home as never, {
            from,
            to,
            decidedOn: today,
            departsOn: today + MIGRATION_PREP_DAYS,
            state: "leaving",
          }),
        );
      }
      return events.length === 0 ? {} : { events, changes };
    },
  };
}
