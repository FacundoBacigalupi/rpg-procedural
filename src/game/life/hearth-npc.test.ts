import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, ledgerUnit, loadContent } from "../../core/index.ts";
import { checkInvariants, HEARTH } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { HEARTH_FUEL_UNIT } from "./hearth.ts";
import { Life } from "./life.ts";
import { GATHERED_WOOD_EVENT } from "./routine.ts";

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
const DAY = 86400;
const WOOD = ledgerUnit(HEARTH_FUEL_UNIT);
const ON = { hearths: true, wildHarvest: true, wildFirewood: true } as const;

describe("las casas juntan leña para el hogar (hearth-npc)", () => {
  it("con la pila baja, alguien de la casa va al monte y la leña llega a la pila", () => {
    const life = Life.create(7, content, ON);
    const w = life.world;
    life.advanceTo(life.now + 12 * DAY);
    const gathered = w.log.all().filter((e) => e.kind === GATHERED_WOOD_EVENT);
    expect(gathered.length).toBeGreaterThan(0);
    expect(gathered.every((e) => e.actors.length === 1 && e.causes.length > 0)).toBe(true);
    // Sin la ronda, a los 12 días todas las pilas estarían en cero (ver hearths.test).
    const piles = w.truth
      .ids(HEARTH)
      .map((id) => w.truth.get(HEARTH, id)?.holder)
      .filter((h) => h !== undefined)
      .map((h) => w.ledger.balance(h as never, WOOD));
    expect(piles.some((g) => g > 0)).toBe(true);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 600_000);

  it("sin leña en el monte (wildFirewood apagado) nadie sale a buscarla", () => {
    const life = Life.create(7, content, { hearths: true, wildHarvest: true });
    life.advanceTo(life.now + 8 * DAY);
    expect(life.world.log.all().some((e) => e.kind === GATHERED_WOOD_EVENT)).toBe(false);
  }, 300_000);

  it("determinista: misma corrida, mismo hash", () => {
    const run = () => {
      const life = Life.create(7, content, ON);
      life.advanceTo(life.now + 7 * DAY);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 600_000);
});
