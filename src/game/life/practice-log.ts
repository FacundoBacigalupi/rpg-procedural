// Registro de práctica propia (npc-psychology §7, f3d4e): cada paso de un verbo que usa una
// habilidad deja una sesión con el evento que la asentó. Es la evidencia citable de las metas de
// oficio y estudio (`sim/mind/craft-goals.ts`); `SKILL_STATE` guarda el nivel, no de dónde vino.

import type { AgentId } from "../../core/index.ts";
import {
  type PracticeEntry,
  type ProcessDef,
  type SkillCatalog,
  setComponent,
  table,
} from "../../sim/index.ts";

export const PRACTICE_LOG_PROCESS = "life.practice_log";
/** Sesiones que se conservan por persona: las más recientes. */
export const PRACTICE_LOG_CAPACITY = 60;

export interface PracticeLog {
  readonly items: readonly PracticeEntry[];
}

export const PRACTICE_LOG = table<PracticeLog>("life.practice_log");

export interface PracticeLogOptions {
  readonly skills: SkillCatalog;
}

/** Anota cada acción propia que usa una habilidad; escucha el evento asentado, no agenda nada. */
export function practiceLogProcess(o: PracticeLogOptions): ProcessDef {
  return {
    id: PRACTICE_LOG_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PRACTICE_LOG.name],
    writes: [PRACTICE_LOG.name],
    run(ctx) {
      const pending = new Map<AgentId, PracticeEntry[]>();
      for (const e of ctx.recent) {
        if (!e.kind.startsWith("action.")) continue;
        const who = e.actors[0];
        if (!who?.startsWith("agent:")) continue;
        const data = e.data as { verb?: unknown; seconds?: unknown } | null;
        if (typeof data?.verb !== "string") continue;
        if (typeof data.seconds !== "number" || !(data.seconds > 0)) continue;
        const use = o.skills.forVerb(data.verb);
        if (!use) continue;
        const actor = who as AgentId;
        const list = pending.get(actor) ?? [];
        list.push({
          skill: use.skill.id,
          event: e.id,
          at: e.tick,
          hours: (data.seconds / 3600) * use.intensity,
        });
        pending.set(actor, list);
      }
      const changes = [...pending.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([actor, entries]) => {
          const old = ctx.truth.get(PRACTICE_LOG, actor)?.items ?? [];
          const seen = new Set(old.map((x) => x.event));
          const items = [...old, ...entries.filter((x) => !seen.has(x.event))].slice(
            -PRACTICE_LOG_CAPACITY,
          );
          return setComponent(PRACTICE_LOG, actor, { items });
        });
      return changes.length > 0 ? { changes } : {};
    },
  };
}
