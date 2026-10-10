import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import {
  type GoalProgressEvidence,
  goalCompletionsFromProgress,
  goalProgressOf,
  PROGRESS_PER_EVIDENCE_CAP,
} from "./goal-progress-evidence.ts";
import type { Goal } from "./goals.ts";

const goal = (id: string, layer: Goal["layer"] = "medium"): Goal => ({
  id,
  layer,
  kind: "pursue",
  value: "knowledge",
  weight: 0.5,
  originEventId: makeId("event", 1),
  since: 100 as Tick,
});
const ev = (goalId: string, n: number, at: number, amount = 0.4): GoalProgressEvidence => ({
  goalId,
  cause: makeId("event", n),
  at: at as Tick,
  amount,
});
const now = 10_000 as Tick;
const g = goal("medium:master");
const concrete = new Set([g.id]);

describe("sim.mind.goal-progress-evidence", () => {
  it("una acción aislada, por grande que sea, no cierra la meta", () => {
    const one = [ev(g.id, 10, 500, 1)];
    expect(goalProgressOf(g, one, now).progress).toBe(PROGRESS_PER_EVIDENCE_CAP);
    expect(goalCompletionsFromProgress([g], one, now, concrete, 100)).toEqual([]);
  });

  it("varias evidencias distintas y separadas cierran con la última como causa", () => {
    const list = [ev(g.id, 12, 900), ev(g.id, 10, 300), ev(g.id, 11, 600)];
    const [done] = goalCompletionsFromProgress([g], list, now, concrete, 400);
    expect(done).toMatchObject({ goalId: g.id, cause: makeId("event", 12), at: 900, original: g });
    // sin lapso suficiente o repitiendo la misma causa no cierra
    expect(goalCompletionsFromProgress([g], list, now, concrete, 700)).toEqual([]);
    const dup = [ev(g.id, 10, 300), ev(g.id, 10, 600), ev(g.id, 10, 900)];
    expect(goalCompletionsFromProgress([g], dup, now, concrete, 0)).toEqual([]);
  });

  it("ignora evidencia futura, previa al nacimiento, ajena o sin causa válida", () => {
    const list = [
      ev(g.id, 10, 50),
      ev(g.id, 11, 20_000),
      ev("otra", 12, 500),
      { ...ev(g.id, 13, 500), cause: "x" as never },
      ev(g.id, 14, 500, 0),
    ];
    expect(goalProgressOf(g, list, now).events).toBe(0);
  });

  it("un valor continuo no se cierra aunque se declare o acumule evidencia", () => {
    const core = goal("core:family", "core");
    const list = [ev(core.id, 10, 300), ev(core.id, 11, 600), ev(core.id, 12, 900)];
    expect(goalCompletionsFromProgress([core], list, now, new Set([core.id]), 0)).toEqual([]);
    expect(goalCompletionsFromProgress([g], [], now, concrete, 0)).toEqual([]);
    const undeclared = [ev(g.id, 10, 300), ev(g.id, 11, 600), ev(g.id, 12, 900)];
    expect(goalCompletionsFromProgress([g], undeclared, now, new Set(), 0)).toEqual([]);
  });
});
