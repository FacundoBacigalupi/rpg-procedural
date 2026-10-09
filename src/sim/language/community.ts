// El acento de cada comunidad en la verdad (language §5, §12). Cada lengua tiene un acento madre
// (el de la protovariante, sorteado del seed y de su id); cada comunidad que habla una rama lo
// tiene derivado de él con una deriva que crece con las generaciones de separación. Las que se
// separaron hace poco suenan parecido; las lejanas, distinto. Una fila por asentamiento, con el
// evento de origen que la explica. Lo que oye o cree cada uno vive aparte (game/life).

import type {
  EventId,
  EventLog,
  IdAllocator,
  PlaceRef,
  Seed,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import { type ReadonlyWorldTruth, table, type WorldTruth } from "../world/index.ts";
import { type Accent, deriveAccent, rootAccent } from "./accent.ts";

/** El acento de una comunidad y de dónde viene. */
export interface CommunityAccent {
  readonly language: string;
  /** El acento tal cual lo habla hoy la gente de la comunidad. */
  readonly accent: Accent;
  /** El de la variante madre de la que se separó. */
  readonly parent: Accent;
  /** Generaciones desde que se separó de la madre (cuánto derivó). */
  readonly generations: number;
  readonly originEventId: EventId;
}

export const COMMUNITY_ACCENT = table<CommunityAccent>("language.community_accent");

/** Generaciones de separación de la aldea fundadora respecto de la variante madre (sin calibrar). */
export const VILLAGE_SEPARATION = 6;

/** El acento madre de una lengua: depende solo del seed y de su id. */
export function languageRootAccent(seed: Seed, language: string): Accent {
  return rootAccent(Rng.root(seed).fork("accent-root", language));
}

export interface SeedCommunityAccentInput {
  readonly seed: Seed;
  readonly settlement: SettlementId;
  readonly place: PlaceRef;
  readonly now: Tick;
  readonly foundersEvent: EventId;
  readonly language: string;
  /** Generaciones desde que la comunidad se separó de la variante madre. */
  readonly generations: number;
}

/** Escribe el acento de la comunidad, derivado del madre de su lengua, con su evento de origen. */
export function seedCommunityAccent(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedCommunityAccentInput,
): CommunityAccent {
  const parent = languageRootAccent(input.seed, input.language);
  const accent = deriveAccent(
    parent,
    Rng.root(input.seed).fork("accent-community", input.language, input.settlement),
    input.generations,
  );
  const event = ids.next("event");
  log.append({
    id: event,
    tick: input.now,
    kind: "language.accent_seeded",
    actors: [],
    place: input.place,
    data: { language: input.language, generations: input.generations },
    emissions: null,
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "history",
  });
  const row: CommunityAccent = {
    language: input.language,
    accent,
    parent,
    generations: input.generations,
    originEventId: event,
  };
  truth.set(COMMUNITY_ACCENT, input.settlement, row);
  return row;
}

/** El acento nativo de la gente de un asentamiento, si se sembró. */
export function nativeAccent(
  truth: ReadonlyWorldTruth,
  settlement: SettlementId,
): Accent | undefined {
  return truth.get(COMMUNITY_ACCENT, settlement)?.accent;
}

/** Todos los acentos de comunidades sembrados, por asentamiento (lo que alguien podría conocer). */
export function communityAccents(
  truth: ReadonlyWorldTruth,
): { community: SettlementId; accent: Accent }[] {
  return truth.ids(COMMUNITY_ACCENT).flatMap((id) => {
    const row = truth.get(COMMUNITY_ACCENT, id);
    return row ? [{ community: id as SettlementId, accent: row.accent }] : [];
  });
}
