// Solo opt-in al ensamblar: proyecta las lecturas de acciones que sobrevivieron la fase act.
import type { PlanetClock } from "../../core/index.ts";
import { OPINIONS, type ProcessDef, SKILL_STATE, type SkillCatalog } from "../../sim/index.ts";
import { foldWatchExposures, type WatchExposure } from "./watching.ts";

export const WATCH_EXPOSURES_KEY = "watchExposures";
export const WATCHING_PROJECTION_PROCESS = "life.watch_projection";

export function watchingProjectionProcess(options: {
  readonly catalog: SkillCatalog;
  readonly clock: PlanetClock;
}): ProcessDef {
  return {
    id: WATCHING_PROJECTION_PROCESS,
    system: "life",
    scope: "world",
    phase: "physics",
    cadence: { local: "onEvent", scene: "onEvent" },
    withRecent: true,
    representation: "individual",
    reads: [SKILL_STATE.name, OPINIONS.name],
    writes: [SKILL_STATE.name, OPINIONS.name],
    run(ctx) {
      // `recent` conserva el orden canónico de commit; no ordenarlo lexicográficamente por event:N.
      const exposures = ctx.recent.flatMap((event) => {
        if (!event.kind.startsWith("action.")) return [];
        return (
          (event.data as { readonly watchExposures?: readonly WatchExposure[] }).watchExposures ??
          []
        );
      });
      return { changes: foldWatchExposures(ctx.truth, options.catalog, options.clock, exposures) };
    },
  };
}
