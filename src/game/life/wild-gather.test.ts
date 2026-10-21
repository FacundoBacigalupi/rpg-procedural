import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  loadContent,
} from "../../core/index.ts";
import { ECOLOGY, LOCATION, PERSON, PLACE, WILD } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { FORAGE_UNIT, WILD_SOURCE, WILD_SUPPLIED_EVENT } from "./wild.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const DAY = 86400;

/** Un monte pobre (techo de unos 8 kg de forraje) para que una sola persona lo agote en pocos días. */
const POOR_CAPACITY_SCALE = 0.0025;

describe("gather real contra el monte (wildHarvest)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  function run(days: number, gatherer: boolean) {
    const life = Life.create(7, content, {
      wildHarvest: true,
      wildCapacityScale: POOR_CAPACITY_SCALE,
      npcVerbs: ["gather"],
    });
    const w = life.world;
    const [eco] = w.truth.ids(ECOLOGY);
    if (eco === undefined) throw new Error("sin ecología");
    const npc = living(w.truth).find(
      (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * DAY,
    ) as AgentId;
    const forest = w.truth.ids(PLACE).find((p) => w.truth.get(PLACE, p)?.kind === "forest");
    const hex = forest ? w.truth.get(PLACE, forest)?.hexes[0] : undefined;
    if (hex === undefined) throw new Error("sin monte");
    const rows: { standing: number; gathered: number }[] = [];
    for (let d = 0; d < days; d++) {
      if (gatherer) {
        w.truth.set(LOCATION, npc, { hex });
        w.truth.set(NPC_DECISION, npc, {
          at: life.now,
          id: "gather:",
          verb: "gather",
          utility: 1,
          options: 2,
        } as never);
      }
      const before = w.log.all().length;
      life.advanceTo(life.now + DAY);
      const gathered = w.log
        .all()
        .slice(before)
        .filter((e) => e.kind === "action.gather" && e.actors[0] === npc)
        .reduce(
          (s, e) => s + Number((e.data as { effect?: { amount?: number } }).effect?.amount ?? 0),
          0,
        );
      rows.push({ standing: w.truth.get(WILD, eco)?.standing ?? -1, gathered });
    }
    return { life, rows };
  }

  it("recolectar varios días seguidos baja lo que rinde y el stock en pie, con ledger y causas", () => {
    const days = 12;
    const a = run(days, true);
    const b = run(days, false);
    const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    const first = sum(a.rows.slice(0, 3).map((r) => r.gathered));
    const last = sum(a.rows.slice(-3).map((r) => r.gathered));
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(first / 2);
    // El stock en pie queda por debajo del monte intacto: bajó por lo que el verbo tomó.
    const end = (r: { standing: number }[]) => (r[r.length - 1] as { standing: number }).standing;
    expect(end(a.rows)).toBeLessThan(end(b.rows) / 2);
    expect((a.rows[0] as { standing: number }).standing).toBeGreaterThan(end(a.rows));
    // Lo que salió del monte (neto) es lo que tiene el lugar más lo que la gente se llevó.
    const net = -a.life.world.ledger.balance(externalAccount(WILD_SOURCE), FORAGE_UNIT);
    expect(net).toBeGreaterThan(0);
    expect(a.life.world.ledger.audit()).toEqual([]);
    const events = a.life.world.log.all().filter((e) => e.kind === WILD_SUPPLIED_EVENT);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.causes.length).toBeGreaterThan(0);
  }, 300_000);

  it("determinista: misma corrida, mismo hash", () => {
    expect(run(4, true).life.hash().total).toBe(run(4, true).life.hash().total);
  }, 300_000);
});
