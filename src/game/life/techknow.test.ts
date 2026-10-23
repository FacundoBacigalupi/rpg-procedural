import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, externalAccount, loadContent } from "../../core/index.ts";
import { HARVEST, HARVEST_GOOD, PROCESS_KNOWLEDGE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { TECH_SEEDED_EVENT, TECH_TAUGHT_EVENT } from "./techknow.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de soil.test.ts): apagado no debe moverlo.
const BASE_HASH = "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26";

describe("procesos mortales en la aldea (mortalTech)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (mortalTech: boolean, days: number) => {
    const l = Life.create(3, content, mortalTech ? { mortalTech: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };
  const rows = (l: Life) => l.world.truth.ids(PROCESS_KNOWLEDGE);
  const harvested = (l: Life) => -l.world.ledger.balance(externalAccount(HARVEST), HARVEST_GOOD);

  it("apagado deja el hash de develop y no hay saber ni eventos", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(rows(off)).toEqual([]);
    expect(off.world.log.all().some((e) => e.kind === TECH_SEEDED_EVENT)).toBe(false);
  });

  it("encendido siembra el saber con fuente y causa, y cambia el hash", () => {
    const on = Life.create(3, content, { mortalTech: true });
    expect(on.hash().total).not.toBe(BASE_HASH);
    expect(rows(on).length).toBeGreaterThan(0);
    const seeded = on.world.log.all().filter((e) => e.kind === TECH_SEEDED_EVENT);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.causes.length).toBeGreaterThan(0);
    for (const id of rows(on)) {
      for (const k of Object.values(on.world.truth.get(PROCESS_KNOWLEDGE, id) ?? {})) {
        expect(k.source).toBe(seeded[0]?.id);
        expect(k.fidelity).toBeGreaterThan(0);
        expect(k.skill).toBeLessThanOrEqual(k.fidelity);
      }
    }
  });

  it("determinista, el hogar enseña con evento y causa, y el ledger cuadra", () => {
    const a = run(true, 40);
    const b = run(true, 40);
    expect(a.hash().total).toBe(b.hash().total);
    const lessons = a.world.log.all().filter((e) => e.kind === TECH_TAUGHT_EVENT);
    expect(lessons.length).toBeGreaterThan(0);
    for (const e of lessons) {
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.actors).toHaveLength(2);
    }
    expect(a.world.ledger.audit()).toEqual([]);
    const taught = rows(a)
      .flatMap((id) => Object.values(a.world.truth.get(PROCESS_KNOWLEDGE, id) ?? {}))
      .filter((k) => k.taughtBy !== undefined);
    expect(taught.length).toBeGreaterThan(0);
    const ids = new Set(lessons.map((e) => e.id));
    for (const k of taught) expect(ids.has(k.source)).toBe(true);
  });

  it("la cosecha lee yieldFactor: con saber rinde distinto que sin él", () => {
    const on = run(true, 30);
    const off = run(false, 30);
    expect(harvested(on)).toBeGreaterThan(0);
    expect(harvested(on)).not.toBe(harvested(off));
  });
});
