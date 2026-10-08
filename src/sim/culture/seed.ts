// La cultura de la aldea al empezar (culture §1, §14 Fase 1): sale de `content/cultures/` y queda
// como la prevalencia de cada rasgo en la comunidad, con su origen, en un evento del pasado que
// cuelga de la fundación. Los demás sistemas la leen con `dominantVariant`/`traitParam`.

import type {
  EventId,
  EventLog,
  IdAllocator,
  PlaceRef,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { type ReadonlyWorldTruth, table, type WorldTruth } from "../world/index.ts";
import { type CultureDef, cultureProblems, type TraitDef, type TraitOrigin } from "./trait.ts";

export interface TraitPrevalence {
  /** Fracción de la comunidad que sigue cada variante (suma 1). */
  readonly variants: Readonly<Record<string, number>>;
  readonly params: Readonly<Record<string, number>>;
  readonly origin: TraitOrigin;
  readonly because: string;
}

/** La cultura de una comunidad: prevalencia por rasgo (§1). Una fila por asentamiento. */
export interface CommunityCulture {
  readonly culture: string;
  readonly name: string;
  readonly prevalence: Readonly<Record<string, TraitPrevalence>>;
  readonly originEventId: EventId;
}

export const COMMUNITY_CULTURE = table<CommunityCulture>("culture.community");

export interface SeedCultureInput {
  readonly settlement: SettlementId;
  readonly place: PlaceRef;
  readonly now: Tick;
  readonly foundersEvent: EventId;
  readonly culture: CultureDef;
  readonly traits: readonly TraitDef[];
}

/** Escribe la cultura de la aldea. Falla fuerte si el contenido no cierra. */
export function seedCulture(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedCultureInput,
): CommunityCulture {
  const problems = cultureProblems(input.culture, input.traits);
  if (problems.length > 0) throw new Error(`cultura inválida: ${problems.join("; ")}`);
  const prevalence: Record<string, TraitPrevalence> = {};
  for (const t of input.culture.traits) {
    const entries = Object.entries(t.variants).sort(([a], [b]) => (a < b ? -1 : 1));
    const total = entries.reduce((s, [, w]) => s + w, 0);
    prevalence[t.trait] = {
      variants: Object.fromEntries(entries.map(([v, w]) => [v, w / total])),
      params: t.params,
      origin: t.origin,
      because: t.because,
    };
  }
  const event = ids.next("event");
  log.append({
    id: event,
    tick: input.now,
    kind: "culture.seeded",
    actors: [],
    place: input.place,
    data: { culture: input.culture.id, traits: input.culture.traits.length },
    emissions: null,
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "history",
  });
  const community: CommunityCulture = {
    culture: input.culture.id,
    name: input.culture.name,
    prevalence,
    originEventId: event,
  };
  truth.set(COMMUNITY_CULTURE, input.settlement, community);
  return community;
}

/** La respuesta más seguida a un rasgo (la de mayor fracción; a igual, la de menor id). */
export function dominantVariant(
  culture: CommunityCulture | undefined,
  trait: string,
): string | undefined {
  const p = culture?.prevalence[trait];
  if (!p) return undefined;
  let best: string | undefined;
  for (const [v, f] of Object.entries(p.variants)) {
    const cur = best === undefined ? -1 : (p.variants[best] as number);
    if (f > cur || (f === cur && best !== undefined && v < best)) best = v;
  }
  return best;
}

/** Un número de un rasgo (días de luto, sesgo de un valor), o `fallback` si la cultura no lo dice. */
export function traitParam(
  culture: CommunityCulture | undefined,
  trait: string,
  param: string,
  fallback: number,
): number {
  return culture?.prevalence[trait]?.params[param] ?? fallback;
}

/** La cultura de la aldea de la vida (hoy hay una sola comunidad). */
export function villageCulture(truth: ReadonlyWorldTruth): CommunityCulture | undefined {
  const [first] = truth.ids(COMMUNITY_CULTURE);
  return first === undefined ? undefined : truth.get(COMMUNITY_CULTURE, first);
}
