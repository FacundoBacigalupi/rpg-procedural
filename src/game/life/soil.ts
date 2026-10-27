// El suelo de la aldea día a día (economy §1): lo que salió del campo desde ayer —tomado del
// acumulado de la fuente `harvest` del ledger, así cuenta también lo que cosecha el personaje— le
// saca fertilidad, y el descanso se la devuelve. La rutina rinde `fertilidad × estación`.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
  type Seed,
} from "../../core/index.ts";
import {
  draftEvent,
  EATEN,
  ENTITY,
  EXCRETED,
  EXCRETED_FRACTION,
  FED_SINK,
  FIELD_MANURE,
  fieldYield,
  HARVEST,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  HEAVY_RAIN_MM,
  type LocalMap,
  MANURE_GRAMS_PER_UNIT,
  MANURE_QUALITY,
  MANURE_UNIT,
  manureQualityOf,
  PARCEL_SOIL,
  PERSON,
  type ProcessDef,
  type ProcessResult,
  type ReadonlyWorldTruth,
  SOIL,
  SOIL_FLOOR,
  setComponent,
  soilAfter,
  startingParcel,
  stepParcelField,
  weatherAt,
} from "../../sim/index.ts";
import { ROUTINE } from "./routine.ts";

export const SOIL_PROCESS = "life.soil";

export interface SoilOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
  /**
   * Opt-in (`fieldManure`): lo comido deja desecho en la cuenta de la aldea y el campo lo toma al
   * día siguiente como abono (cosecha -> comida -> desecho -> campo). Apagado no hay asientos ni eventos.
   */
  readonly manure?: {
    readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
    /**
     * Opt-in (`fieldManureDiet`): proteína por gramo de cada unidad comida (`good:<id>`); con esto la
     * calidad del abono sale de la dieta acumulada en `eaten`, no de `MANURE_QUALITY`.
     */
    readonly proteinOf?: ReadonlyMap<string, number>;
    /**
     * Opt-in (`livestockManure`, livestock-yield-manure): lo que comió el ganado de la casa
     * (sumidero `FED_SINK`) también deja desecho, con la misma fracción que lo comido por la gente.
     */
    readonly livestock?: boolean;
  };
}

export const FIELD_MANURED_EVENT = "field.manured";

export function soilProcess(o: SoilOptions): ProcessDef {
  return {
    id: SOIL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [SOIL.name, PARCEL_SOIL.name, PERSON.name, ENTITY.name],
    writes: [SOIL.name, PARCEL_SOIL.name],
    run(ctx) {
      const [id] = ctx.truth.ids(SOIL);
      const soil = id === undefined ? undefined : ctx.truth.get(SOIL, id);
      if (id === undefined || !soil) return {};
      const taken = -(ctx.ledger?.balance(externalAccount(HARVEST), HARVEST_GOOD) ?? -soil.seen);
      const workers = ctx.truth
        .ids(PERSON)
        .filter(
          (p) =>
            ctx.truth.get(ENTITY, p)?.endedAt === undefined &&
            (ctx.now - (ctx.truth.get(PERSON, p)?.born ?? ctx.now)) / o.clock.year >=
              ROUTINE.workAge,
        ).length;
      const days = Math.max(1, ctx.window) / o.clock.day;
      const fullDay = workers * (ROUTINE.work[1] - ROUTINE.work[0]) * HARVEST_GRAMS_PER_HOUR;
      const seen = Math.max(taken, soil.seen);
      const parcel = ctx.truth.get(PARCEL_SOIL, id);
      if (!parcel) {
        // Vidas anteriores al suelo por parcela: se sigue con el suelo único y se anota el de adentro.
        const fertility = soilAfter(soil.fertility, Math.max(0, taken - soil.seen), fullDay, days);
        return {
          changes: [
            setComponent(SOIL, id, { fertility, seen }),
            setComponent(PARCEL_SOIL, id, { soil: startingParcel(fertility), seen }),
          ],
        };
      }
      // La carga del tramo es la fracción de un día pleno que se cosechó (la misma cuenta de siempre).
      const load = fullDay > 0 ? Math.max(0, taken - soil.seen) / (fullDay * days) : 0;
      // Clima del tramo: se muestrean hasta 30 días y se escala (lluvia fuerte lava y erosiona).
      const samples = Math.min(30, Math.max(1, Math.round(days)));
      let heavy = 0;
      for (let i = 0; i < samples; i++) {
        const t = ctx.now - Math.round(((i + 0.5) / samples) * days * o.clock.day);
        if (weatherAt(o.map, o.clock, o.seed, t).precip.mm >= HEAVY_RAIN_MM) heavy++;
      }
      const arid = o.map.climate.annualPrecipMm < 400;
      // Abono: el desecho de ayer (cuenta de la aldea) va al campo; lo comido desde ayer deja el de hoy.
      let manure = 0;
      let manureQuality = MANURE_QUALITY;
      let manureEvents: ProcessResult["events"];
      let manurePostings: ProcessResult["postings"];
      const first = ctx.truth
        .ids(PERSON)
        .find((p) => ctx.truth.get(ENTITY, p)?.endedAt === undefined);
      if (o.manure && ctx.ledger && first !== undefined) {
        const village = holderAccount(id as unknown as HolderRef);
        const pile = ctx.ledger.balance(village, MANURE_UNIT);
        const ledger = ctx.ledger;
        const sinks = [EATEN, ...(o.manure.livestock === true ? [FED_SINK] : [])];
        const consumed = sinks.flatMap((s) => ledger.holdings(externalAccount(s)));
        const eaten = consumed.reduce((n, h) => n + Math.max(0, h.amount), 0);
        const made = -ctx.ledger.balance(externalAccount(EXCRETED), MANURE_UNIT);
        const fresh = Math.max(0, Math.floor(eaten * EXCRETED_FRACTION) - made);
        const transfers = [
          ...(fresh > 0
            ? [{ unit: MANURE_UNIT, from: externalAccount(EXCRETED), to: village, amount: fresh }]
            : []),
          ...(pile > 0
            ? [
                {
                  unit: MANURE_UNIT,
                  from: village,
                  to: externalAccount(FIELD_MANURE),
                  amount: pile,
                },
              ]
            : []),
        ];
        if (transfers.length > 0) {
          manure = pile / MANURE_GRAMS_PER_UNIT;
          const proteinOf = o.manure.proteinOf;
          if (proteinOf) {
            manureQuality = manureQualityOf(
              consumed.map((h) => ({
                grams: h.amount,
                proteinPerGram: proteinOf.get(h.unit) ?? 0,
              })),
            );
          }
          manureEvents = [
            {
              kind: FIELD_MANURED_EVENT,
              actors: [],
              place: o.manure.placeOf(ctx.truth, first as AgentId),
              data: { returned: pile, excreted: fresh },
              emissions: {},
              causes: [{ kind: "state", entity: id as unknown as EntityRef, key: "soil" }],
            },
          ];
          manurePostings = [{ event: draftEvent(0), transfers }];
        }
      }
      const stepped = stepParcelField(parcel.soil, {
        ...(manure > 0 ? { manure, manureQuality } : {}),
        days,
        load,
        heavyRainDays: (heavy / samples) * days,
        arid,
      });
      const fertility = Math.max(SOIL_FLOOR, Math.min(1, fieldYield(stepped)));
      return {
        changes: [
          setComponent(PARCEL_SOIL, id, { soil: stepped, seen }),
          setComponent(SOIL, id, { fertility, seen }),
        ],
        ...(manureEvents ? { events: manureEvents, postings: manurePostings } : {}),
      };
    },
  };
}
