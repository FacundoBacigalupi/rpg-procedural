import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { BUILDING, checkInvariants, HEARTH, LOCATION, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  BURNED_SINK,
  HEARTH_FUEL_UNIT,
  HEARTH_WOODPILE_G,
  HEARTHS_LAID_EVENT,
  hearthEnv,
} from "./hearth.ts";
import { Life } from "./life.ts";

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

describe("hogares en las casas (hearth-seed)", () => {
  it("cada casa habitada tiene su hogar y su pila de leña, con evento y causa", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const houses = w.truth.ids(BUILDING).filter((id) => w.truth.get(BUILDING, id)?.household);
    expect(houses.length).toBeGreaterThan(0);
    expect(w.truth.ids(HEARTH).length).toBe(houses.length);
    const laid = w.log.all().find((e) => e.kind === HEARTHS_LAID_EVENT);
    expect(laid?.causes.length).toBeGreaterThan(0);
    const mine = w.truth.get(PERSON, w.player)?.household;
    if (mine === undefined) throw new Error("sin hogar");
    expect(w.ledger.balance(holderAccount(mine), WOOD)).toBe(HEARTH_WOODPILE_G);
    expect(w.ledger.audit()).toEqual([]);
  }, 300_000);

  it("el hogar quema leña cada día hacia `burned`, calienta el cuarto y se apaga sin leña", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const mine = w.truth.get(PERSON, w.player)?.household;
    if (mine === undefined) throw new Error("sin hogar");
    life.advanceTo(life.now + DAY);
    const burned = w.log.all().filter((e) => e.kind === "hearth.burned");
    expect(burned.length).toBeGreaterThan(0);
    expect(w.ledger.balance(externalAccount(BURNED_SINK), WOOD)).toBeGreaterThan(0);
    expect(w.ledger.balance(holderAccount(mine), WOOD)).toBeLessThan(HEARTH_WOODPILE_G);
    // Quien está en el cuarto del hogar recibe su calor.
    const h = w.truth
      .ids(HEARTH)
      .map((id) => w.truth.get(HEARTH, id))
      .find((x) => x?.holder === holderAccount(mine));
    if (h === undefined) throw new Error("sin hogar propio");
    expect(h.intensity).toBeGreaterThan(0);
    const at = w.truth.get(LOCATION, w.player);
    if (at === undefined) throw new Error("sin lugar");
    w.truth.set(LOCATION, w.player, { ...at, space: h.space });
    const env = { airC: 5, radiantC: 5, windMs: 0, humidity: 0.5 } as never;
    const warmer = hearthEnv(w.spaces)(w.truth, w.player, env) as { radiantC: number };
    expect(warmer.radiantC).toBeGreaterThan(5);
    // Sin traer más leña, la pila se termina y los fuegos quedan fríos (la fila sigue).
    life.advanceTo(life.now + 12 * DAY);
    expect(w.truth.ids(HEARTH).every((id) => w.truth.get(HEARTH, id)?.intensity === 0)).toBe(true);
    expect(w.ledger.balance(holderAccount(mine), WOOD)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("apagado, no hay hogares ni leña", () => {
    const life = Life.create(7, content, {});
    expect(life.world.truth.ids(HEARTH).length).toBe(0);
    expect(life.world.ledger.total(WOOD)).toBe(0);
  }, 300_000);

  it("determinista: misma corrida, mismo hash", () => {
    const run = () => {
      const life = Life.create(7, content, { hearths: true });
      life.advanceTo(life.now + 3 * DAY);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 300_000);
});
