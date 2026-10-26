// El ganado de la aldea (livestock-herd, living-world §12 «Ganado como bien vivo»): perros,
// gallinas y bueyes como entidades con identidad (`animal:n`), dueño y origen. Los traen los hogares
// cuando levantan la casa: un evento por hogar causado por el de construcción, y cada animal nace
// de ese evento. Viven en el patio de la casa (el hex abierto, sin espacio). Por ahora no comen,
// no envejecen, no paren ni enferman: eso son los ítems siguientes de la línea.

import {
  type AnimalId,
  type BuildingId,
  contentId,
  defineContent,
  type EventId,
  type EventLog,
  type HouseholdId,
  type IdAllocator,
  Rng,
  type SettlementId,
  type Tick,
  z,
} from "../../core/index.ts";
import type { Sex } from "../family/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { ENTITY, LOCATION, table, type WorldTruth } from "../world/index.ts";

export const LivestockDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Lo que se ve (perception §3): la silueta que pinta la escena y nombra el narrador. */
  shape: z.string().min(1),
  /** Masa de un adulto (kg). */
  massKg: z.number().positive(),
  /** Vida típica (años): de ella sale la edad de los que llegan con la casa. */
  lifespanYears: z.number().positive(),
  /** Cuántos trae cada hogar que lo tiene. */
  count: z.number().int().min(1),
  /** Desde cuántos miembros lo tiene un hogar (el buey, en las casas grandes). */
  minMembers: z.number().int().min(1).optional(),
  /** Qué parte son hembras (las gallinas: casi todas). */
  femaleShare: z.number().min(0).max(1),
});
export type LivestockDef = z.infer<typeof LivestockDef>;
export const LIVESTOCK = defineContent("livestock", LivestockDef);

/** Un animal de la casa: de qué especie es, su sexo, cuándo nació y de quién es. */
export interface AnimalRecord {
  readonly species: string;
  readonly sex: Sex;
  readonly bornAt: Tick;
  /** El hogar dueño (la tenencia formal queda para property). */
  readonly owner: HouseholdId;
  /** La casa en cuyo patio vive. */
  readonly home: BuildingId;
}

export const ANIMAL = table<AnimalRecord>("living.animal");

export interface SeedLivestockInput {
  readonly seed: number;
  readonly settlement: SettlementId;
  readonly species: readonly LivestockDef[];
  /** Cuántos viven en cada hogar (los que no están no tienen casa que poblar). */
  readonly members: ReadonlyMap<string, number>;
  /** Duración del año (ticks), para la edad de los que llegan. */
  readonly yearTicks: number;
}

/** Siembra el ganado de cada casa viva del asentamiento. Devuelve cuántos animales creó. */
export function seedLivestock(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedLivestockInput,
): number {
  if (input.species.length === 0) return 0;
  const species = [...input.species].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const root = Rng.root(input.seed);
  let made = 0;
  for (const id of [...truth.ids(BUILDING)].sort() as BuildingId[]) {
    const b = truth.get(BUILDING, id);
    const household = b?.household;
    if (!b || household === undefined || b.settlement !== input.settlement) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const members = input.members.get(household) ?? 0;
    if (members === 0) continue;
    const kept = species.filter((s) => (s.minMembers ?? 1) <= members);
    if (kept.length === 0) continue;
    const at: Tick = truth.get(ENTITY, id)?.createdAt ?? 0;
    const event: EventId = ids.next("event");
    log.append({
      id: event,
      tick: at,
      kind: "settlement.livestock_brought",
      data: { building: id, household, species: kept.map((s) => s.id) },
      causes: [{ kind: "event", event: b.builtBy }],
      actors: [],
      place: { kind: "settlement", settlement: input.settlement },
      emissions: null,
      resolution: "history",
    });
    for (const s of kept) {
      for (let n = 0; n < s.count; n++) {
        const animal: AnimalId = ids.next("animal");
        const r = root.fork("living", "animal", animal).stream();
        const sex: Sex = r.float() < s.femaleShare ? "female" : "male";
        // Llegan jóvenes o adultos: hasta las tres quintas partes de su vida.
        const age = Math.floor(r.float() * 0.6 * s.lifespanYears * input.yearTicks);
        truth.set(ENTITY, animal, { id: animal, originEventId: event, createdAt: at });
        truth.set(ANIMAL, animal, {
          species: s.id,
          sex,
          bornAt: at - age,
          owner: household as HouseholdId,
          home: id,
        });
        truth.set(LOCATION, animal, { hex: b.hex });
        made++;
      }
    }
  }
  return made;
}
