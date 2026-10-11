// Los gustos de cada vivo al empezar (npc-psychology §16, Fase 2): `generateTastes` armado con lo
// innato (`INNATE`), las sensibilidades del cuerpo, lo corriente en la cultura de la aldea, lo
// vedado por sus prácticas y lo que conoció de chico. Escribe `TASTES_OF` y el evento
// `mind.tastes_formed`. Los gustos elegidos en el setup se funden encima de los generados.
// Constantes sin calibrar.

import {
  type AgentId,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Tick,
} from "../../core/index.ts";
import { INNATE, PERSON } from "../family/index.ts";
import { ENTITY, table, type WorldTruth } from "../world/index.ts";
import type { ChosenTaste } from "./chosen.ts";
import {
  EXPOSURE_SATURATION,
  generateTastes,
  type Preference,
  type TasteDef,
  type TasteExposure,
} from "./tastes.ts";

/** Los gustos de una persona: el repertorio y cuáles quedaron fijados por el setup. */
export interface PersonTastes {
  readonly preferences: readonly Preference[];
  /** Objetos cuyo gusto vino elegido (la crónica distingue lo elegido de lo generado). */
  readonly chosen: readonly string[];
  readonly originEventId: EventId;
}

export const TASTES_OF = table<PersonTastes>("mind.tastes");

/** Desvío de la sensibilidad de un sentido alrededor de 0.5. */
export const SENSITIVITY_SPREAD = 0.18;
/** Cuánto corre la sensibilidad la percepción innata (afinada: todo se siente más). */
export const SENSITIVITY_PERCEPTION = 0.1;

export interface SeedTastesInput {
  readonly seed: number;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
  readonly defs: readonly TasteDef[];
  /** Prácticas vedadas de la comunidad (tabúes): vedan lo que se compone de sus bienes. */
  readonly taboos?: readonly { readonly goods: readonly string[] }[];
  /** Gustos elegidos por persona (el personaje del setup); ganan sobre los generados. */
  readonly chosen?: ReadonlyMap<AgentId, readonly ChosenTaste[]>;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Los sentidos que el catálogo nombra, en orden estable. */
export function sensesOf(defs: readonly TasteDef[]): string[] {
  const out = new Set<string>();
  for (const d of defs) for (const s of Object.keys(d.body)) out.add(s);
  return [...out].sort();
}

/** Objetos que las prácticas vedadas de la comunidad tocan (por los bienes que los componen). */
export function forbiddenItems(
  defs: readonly TasteDef[],
  taboos: readonly { readonly goods: readonly string[] }[],
): string[] {
  const goods = new Set(taboos.flatMap((t) => t.goods));
  return defs.filter((d) => d.goods.some((g) => goods.has(g))).map((d) => d.id);
}

/** Funde lo elegido sobre lo generado: lo elegido reemplaza el gusto del mismo objeto. */
export function mergeChosen(
  generated: readonly Preference[],
  chosen: readonly ChosenTaste[],
): Preference[] {
  const taken = new Set(chosen.map((c) => c.item));
  const kept = generated.filter((p) => !taken.has(p.item));
  const fixed: Preference[] = chosen.map((c) => ({
    domain: c.domain,
    item: c.item,
    valence: c.valence,
    strength: c.strength,
    originEventIds: c.originEventIds,
    acquired: c.acquired,
  }));
  return [...kept, ...fixed];
}

/** Lo de la aldea que cada gusto necesita: los sentidos, lo corriente, lo vedado y lo conocido de chico. */
export interface TasteWorld {
  readonly senses: readonly string[];
  readonly familiar: Readonly<Record<string, number>>;
  readonly exposure: Readonly<Record<string, TasteExposure>>;
  readonly forbidden: readonly string[];
}

export function tasteWorld(
  defs: readonly TasteDef[],
  taboos: readonly { readonly goods: readonly string[] }[],
): TasteWorld {
  const familiar: Record<string, number> = {};
  const exposure: Record<string, TasteExposure> = {};
  for (const d of defs) {
    if (d.common <= 0) continue;
    familiar[d.id] = d.common;
    // Lo corriente se conoció de chico: tantas veces como lo corriente que es.
    exposure[d.id] = {
      count: Math.round(d.common * EXPOSURE_SATURATION),
      childhood: true,
      outcome: 0.3,
    };
  }
  return { senses: sensesOf(defs), familiar, exposure, forbidden: forbiddenItems(defs, taboos) };
}

/**
 * Los gustos de una persona: sensibilidades de su cuerpo, lo corriente en la cultura, lo vedado y lo
 * que conoció en la mesa de su madre (lo bueno queda ligado a ella). `rng` es `fork("tastes", id)`.
 */
export function newTastes(
  defs: readonly TasteDef[],
  world: TasteWorld,
  innate: Readonly<Record<string, number>>,
  mother: AgentId | undefined,
  rng: Rng,
  event: EventId,
  chosen: readonly ChosenTaste[] = [],
): PersonTastes {
  const sensitivities: Record<string, number> = {};
  for (const s of world.senses) {
    sensitivities[s] = round(
      clamp01(
        0.5 +
          SENSITIVITY_PERCEPTION * (innate["perception"] ?? 0) +
          rng.fork("sense", s).normal(0, SENSITIVITY_SPREAD),
      ),
    );
  }
  const fed: Record<string, TasteExposure> = mother
    ? Object.fromEntries(
        Object.entries(world.exposure).map(([k, e]) => [k, { ...e, from: mother }]),
      )
    : { ...world.exposure };
  const generated = generateTastes(
    defs,
    {
      innate,
      body: { sensitivities },
      culture: { familiar: world.familiar, forbidden: world.forbidden },
      exposure: fed,
      origin: event,
    },
    rng,
  );
  return {
    preferences: mergeChosen(generated, chosen),
    chosen: chosen.map((c) => c.item),
    originEventId: event,
  };
}

/** Escribe `TASTES_OF` de cada vivo. Devuelve el evento de la formación. */
export function seedTastes(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedTastesInput,
): EventId {
  const event = ids.next("event");
  const alive = (truth.ids(PERSON) as AgentId[]).filter(
    (id) => truth.get(ENTITY, id)?.endedAt === undefined,
  );
  log.append({
    id: event,
    tick: input.now,
    kind: "mind.tastes_formed",
    actors: alive,
    place: input.place,
    data: null,
    emissions: {},
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "local",
  });
  const world = tasteWorld(input.defs, input.taboos ?? []);
  const root = Rng.root(input.seed);
  for (const id of alive) {
    const innate = truth.get(INNATE, id);
    if (!innate) continue;
    const chosen = input.chosen?.get(id) ?? [];
    truth.set(
      TASTES_OF,
      id,
      newTastes(
        input.defs,
        world,
        innate,
        truth.get(PERSON, id)?.mother ?? undefined,
        root.fork("tastes", id),
        event,
        chosen,
      ),
    );
  }
  return event;
}
