// Avisar de lo que vio (travel §3, npc-b2b4c1): cuando dos viajeros que ya se cruzaron (`NPC_MET`)
// siguen en el mismo hex, el que vio rastros en el camino (`NPC_TRACES`) se los cuenta al otro. Quien
// escucha lo guarda como creencia de oídas (`NPC_HEARD`): el tipo, la edad que le dijeron y de quién
// vino, sin tocar la verdad ni su propio libro de rastros. Cuenta o no según una tirada con rng
// propio, una vez por persona y viaje. Opt-in (`LifeParts.npcWarnings`, con `npcTraces`).

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_MET } from "./npc-encounters.ts";
import { NPC_TRACES, type TraceKind } from "./npc-traces.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_WARNINGS_PROCESS = "life.npc_warnings";
export const WARNED_EVENT = "npc.warned";

/** Lo que le contaron: como lo vio quien avisa (sin error nuevo), con de quién viene. */
export interface HeardTrace {
  readonly hex: number;
  readonly kind: TraceKind;
  readonly estAgeHours: number;
  readonly from: string;
  readonly at: number;
}
export const NPC_HEARD = table<{
  readonly since: number;
  /** A quién ya le oyó en este viaje. */
  readonly told: readonly string[];
  readonly heard: readonly HeardTrace[];
}>("life.npc_heard");

/** Chance por hora de que quien vio algo se lo cuente a quien tiene al lado (sin calibrar). */
export const TELL_CHANCE = 0.6;
/** Tope de lo que guarda de oídas y de lo que se cuenta de una vez. */
export const MAX_HEARD = 8;
export const MAX_TOLD_AT_ONCE = 3;

export interface NpcWarningsOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function npcWarningsProcess(o: NpcWarningsOptions): ProcessDef {
  return {
    id: NPC_WARNINGS_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      ENTITY.name,
      LOCATION.name,
      NPC_JOURNEY.name,
      NPC_MET.name,
      NPC_TRACES.name,
      NPC_HEARD.name,
    ],
    writes: [NPC_HEARD.name],
    scopeGuard: (truth, scope) =>
      truth.get(NPC_JOURNEY, scope as AgentId) !== undefined ||
      truth.get(NPC_HEARD, scope as AgentId) !== undefined,
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const trip = truth.get(NPC_JOURNEY, me);
      const book = truth.get(NPC_HEARD, me);
      if (!trip) return book ? { changes: [deleteComponent(NPC_HEARD, me)] } : {};
      const here = truth.get(LOCATION, me)?.hex;
      const met = truth.get(NPC_MET, me);
      if (here === undefined || !met || met.since !== trip.since) return {};
      const fresh = book !== undefined && book.since === trip.since;
      const told = new Set(fresh ? book.told : []);
      const heard = [...(fresh ? book.heard : [])];
      const events: EventDraft[] = [];
      for (const other of met.met as AgentId[]) {
        if (told.has(other)) continue;
        if (
          truth.get(LOCATION, other)?.hex !== here ||
          truth.get(ENTITY, other)?.endedAt !== undefined
        )
          continue;
        const theirs = truth.get(NPC_TRACES, other)?.seen ?? [];
        const news = theirs
          .filter((t) => !heard.some((h) => h.hex === t.hex && h.kind === t.kind))
          .slice(-MAX_TOLD_AT_ONCE);
        if (news.length === 0) continue;
        if (ctx.rng.fork("tell", me, other, ctx.now).float() >= TELL_CHANCE) continue;
        told.add(other);
        for (const t of news) {
          heard.push({
            hex: t.hex,
            kind: t.kind,
            estAgeHours: t.estAgeHours,
            from: other,
            at: ctx.now,
          });
        }
        events.push({
          kind: WARNED_EVENT,
          actors: [other, me],
          place: o.placeOf(truth, me),
          data: { hex: here, told: news.length },
          emissions: {},
          causes: [{ kind: "state", entity: other, key: "life.npc_traces" }],
        });
      }
      if (events.length === 0) return {};
      return {
        changes: [
          setComponent(NPC_HEARD, me, {
            since: trip.since,
            told: [...told].sort(),
            heard: heard.slice(-MAX_HEARD),
          }),
        ],
        events,
      };
    },
  };
}
