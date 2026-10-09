// El acento en la charla (language §5, §12): quien habla emite su acento nativo (con la faceta y la
// tensión cuando imita otro, `utterAccent`), quien escucha lo percibe con su oído (`perceiveAccent`,
// afinado por la faceta `reading` de la habilidad de lengua), lo compara con los acentos que
// conoce (`identifyOrigin`) y, si el personaje es quien escucha, anota de dónde cree que es el
// otro en `ASCRIBED_GROUPS` (base `speech`). Un acento que no reconoce queda como uno nuevo que
// conoce desde ahora. Hoy todos nacen en la aldea, así que se oye el acento de la aldea; con más
// comunidades (ramas de la lengua, viajeros) `nativeOf` cambia por persona.

import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  type Accent,
  communityAccents,
  type IdentityBelief,
  identifyOrigin,
  type KnownAccent,
  levelOf,
  nativeAccent,
  type ProcessDef,
  perceiveAccent,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type StateChange,
  setComponent,
  table,
  utterAccent,
} from "../../sim/index.ts";
import { ASCRIBED_GROUPS, type AscribedGroups } from "./identity.ts";
import { villageOf } from "./taboos.ts";

export const ACCENT_PROCESS = "life.accent";

/** Los acentos que alguien conoce (sin fila: el de su aldea). */
export interface KnownAccents {
  readonly known: readonly KnownAccent[];
}
export const KNOWN_ACCENTS = table<KnownAccents>("life.known_accents");

/** Cuántos acentos ajenos guarda cada uno (los más viejos se olvidan). */
export const KEPT_ACCENTS = 8;
/** Oído mínimo sin ninguna práctica y lo que suma la faceta `reading` (sin calibrar). */
export const EAR_BASE = 0.4;
export const EAR_SKILL = 0.6;
/** Confianza mínima en el origen para anotar la creencia. */
export const ORIGIN_MIN_CONFIDENCE = 0.2;

export function knownAccentsOf(truth: ReadonlyWorldTruth, who: AgentId): readonly KnownAccent[] {
  const row = truth.get(KNOWN_ACCENTS, who);
  if (row) return row.known;
  const village = villageOf(truth);
  const own = village === undefined ? undefined : nativeAccent(truth, village);
  return village !== undefined && own ? [{ community: village, accent: own }] : [];
}

/** El oído de quien escucha: su práctica con la lengua afina lo que distingue. */
export function earOf(truth: ReadonlyWorldTruth, who: AgentId): number {
  const level = levelOf(truth.get(SKILL_STATE, who)?.["speech"], "reading");
  return Math.min(1, EAR_BASE + EAR_SKILL * level);
}

export interface AccentOptions {
  readonly player: AgentId;
  /** El acento nativo de cada uno (hoy el de la aldea). */
  readonly nativeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => Accent | undefined;
}

function defaultNative(truth: ReadonlyWorldTruth): Accent | undefined {
  const village = villageOf(truth);
  return village === undefined ? undefined : nativeAccent(truth, village);
}

export function accentProcess(o: AccentOptions): ProcessDef {
  return {
    id: ACCENT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "settle",
    reads: [
      KNOWN_ACCENTS.name,
      ASCRIBED_GROUPS.name,
      SKILL_STATE.name,
      "language.community_accent",
    ],
    writes: [KNOWN_ACCENTS.name, ASCRIBED_GROUPS.name],
    run(ctx) {
      const nativeOf = o.nativeOf ?? ((t: ReadonlyWorldTruth) => defaultNative(t));
      const known = new Map<EntityRef, readonly KnownAccent[]>();
      let ascribed: AscribedGroups | undefined;
      const about: Record<string, IdentityBelief> = {
        ...(ctx.truth.get(ASCRIBED_GROUPS, o.player)?.about ?? {}),
      };
      let ascribedChanged = false;
      const communities = communityAccents(ctx.truth);
      for (const e of ctx.recent) {
        if (e.kind !== "action.speak" || e.actors.length < 2) continue;
        for (const [i, listener] of (e.actors as AgentId[]).entries()) {
          const speaker = (e.actors as AgentId[])[1 - (i % 2)];
          if (!speaker || speaker === listener) continue;
          const native = nativeOf(ctx.truth, speaker);
          if (!native) continue;
          const rng = ctx.rng.fork("accent", e.id, listener);
          // Hoy nadie imita: quien habla emite el suyo (la faceta y la tensión entran con el engaño).
          const said = utterAccent(native, native, 0, 0, rng);
          const heard = perceiveAccent(said, earOf(ctx.truth, listener), rng);
          const mine = known.get(listener) ?? knownAccentsOf(ctx.truth, listener);
          const guess = identifyOrigin(heard, mine);
          if (!guess.recognized) {
            const learned: KnownAccent = { community: `heard:${speaker}`, accent: heard };
            const next = [...mine.filter((k) => k.community !== learned.community), learned];
            known.set(listener, next.slice(-KEPT_ACCENTS));
          }
          if (
            listener === o.player &&
            guess.recognized &&
            guess.nearest !== undefined &&
            guess.confidence >= ORIGIN_MIN_CONFIDENCE &&
            communities.some((c) => c.community === guess.nearest)
          ) {
            const prev = about[speaker];
            if (!prev || prev.confidence < guess.confidence) {
              about[speaker] = {
                holder: listener,
                about: speaker,
                group: guess.nearest,
                confidence: guess.confidence,
                basis: ["speech"],
              };
              ascribedChanged = true;
            }
          }
        }
      }
      if (ascribedChanged) ascribed = { about };
      const changes: StateChange[] = [...known].map(([who, k]) =>
        setComponent(KNOWN_ACCENTS, who, { known: k }),
      );
      if (ascribed) changes.push(setComponent(ASCRIBED_GROUPS, o.player, ascribed));
      return changes.length === 0 ? {} : { changes };
    },
  };
}
