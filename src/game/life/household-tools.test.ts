import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import {
  BUILDING,
  checkInvariants,
  ENTITY,
  ITEM_HOLD,
  ITEM_LOOK,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { itemsSeen } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

describe("las cosas de cada casa (play-refs-objects-source-tools)", () => {
  it("sin la opción no hay objetos; con ella cada casa tiene los suyos con causa", () => {
    expect([...Life.create(7, content, { frequency: 8 }).world.truth.ids(ITEM_LOOK)]).toEqual([]);

    const life = Life.create(7, content, { frequency: 8, householdTools: true });
    const w = life.world;
    const items = [...w.truth.ids(ITEM_LOOK)];
    expect(items.length).toBeGreaterThan(0);
    const built = new Set(
      [...w.truth.ids(BUILDING)].map((b) => w.truth.get(BUILDING, b)?.builtBy as EventId),
    );
    for (const id of items) {
      const origin = w.truth.get(ENTITY, id)?.originEventId as EventId;
      const event = w.log.get(origin);
      expect(event?.kind).toBe("settlement.tools_made");
      expect(event?.causes.some((c) => c.kind === "event" && built.has(c.event))).toBe(true);
      const hold = w.truth.get(ITEM_HOLD, id as never);
      const at = w.truth.get(LOCATION, id);
      expect(String(hold?.possession)).toMatch(/^household:/);
      expect(at?.space?.startsWith(`house:${String(hold?.possession)}`)).toBe(true);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    const at0 = new Map(items.map((id) => [id, w.truth.get(LOCATION, id)]));

    // En su casa, el personaje ve la olla y la puede nombrar.
    const home = w.truth.get(PERSON, w.player)?.household;
    const here = w.truth.get(LOCATION, w.player);
    expect(here?.space).toBeDefined();
    const seen = itemsSeen(w);
    const mine = seen.filter(
      (p) =>
        String(w.truth.get(ITEM_HOLD, p.sourceEntityId as never)?.possession) === String(home),
    );
    expect(mine.length).toBeGreaterThan(0);
    const known = knownEntities(w, [], seen);
    expect(known.some((k) => k.kind === "object" && k.names.includes("olla"))).toBe(true);

    // Un día después siguen donde estaban (nadie las mueve todavía) y el mundo sigue sano.
    life.advanceTo(life.now + 24 * 3600);
    for (const id of items) expect(w.truth.get(LOCATION, id)).toEqual(at0.get(id));
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);

    // Determinista: la misma vida da los mismos objetos.
    const again = Life.create(7, content, { frequency: 8, householdTools: true }).world;
    expect([...again.truth.ids(ITEM_LOOK)]).toEqual(items);
    expect(again.truth.get(LOCATION, items[0] as never)).toEqual(
      w.truth.get(LOCATION, items[0] as never),
    );
  }, 300_000);
});
