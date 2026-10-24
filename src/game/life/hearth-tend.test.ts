import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, holderAccount, ledgerUnit, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  HEARTH,
  type IntentDraft,
  LOCATION,
  PERSON,
  PLACE,
  planFromDraft,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { HEARTH_FUEL_UNIT } from "./hearth.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import type { LifeWorld } from "./world.ts";

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

/** El hogar de la casa del jugador (id de la fila y espacio), y lo pone parado al lado. */
function homeHearth(w: LifeWorld): { id: string; space: string } {
  const mine = w.truth.get(PERSON, w.player)?.household;
  if (mine === undefined) throw new Error("sin hogar");
  const id = w.truth
    .ids(HEARTH)
    .find((h) => w.truth.get(HEARTH, h)?.holder === holderAccount(mine));
  const h = id === undefined ? undefined : w.truth.get(HEARTH, id);
  if (id === undefined || h === undefined) throw new Error("sin hogar propio");
  return { id, space: h.space };
}

function standAt(w: LifeWorld, space: string): void {
  const node = w.spaces.spaces.find((s) => s.key === space);
  if (node === undefined) throw new Error("sin espacio");
  w.truth.set(LOCATION, w.player, { hex: node.hex, space: node.key });
}

function doVerb(life: Life, verb: string, args: { role: string; text: string }[] = []) {
  const w = life.world;
  const r = planFromDraft({ kind: "act", plan: { kind: "do", verb, args } } as IntentDraft, {
    actor: w.player,
    source: "player",
    catalog: w.catalog,
    known: knownEntities(w, []),
    clock: w.clock,
    causes: [{ kind: "state", entity: w.player, key: "intent" }],
    here: w.truth.get(LOCATION, w.player)?.hex,
  });
  if (r.kind !== "plan") throw new Error(r.kind);
  const turn = life.turn(r.plan, 1);
  return turn.steps.find((s) => s.verb === verb)?.self.effect as
    | { hearth?: string | null }
    | undefined;
}

describe("encender y apagar el hogar (hearth-tend)", () => {
  it("«apago el fuego» borra la fila; «enciendo el fuego» la vuelve a poner con la pila de la casa", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const { id, space } = homeHearth(w);
    standAt(w, space);
    expect(doVerb(life, "douse")?.hearth ?? null).not.toBeNull();
    expect(w.truth.get(HEARTH, id as never)).toBeUndefined();
    // Apagado, no hay qué apagar.
    expect(doVerb(life, "douse")?.hearth ?? null).toBeNull();
    standAt(w, space);
    const lit = doVerb(life, "kindle");
    expect(lit?.hearth ?? null).not.toBeNull();
    const row = w.truth.get(HEARTH, id as never);
    expect(row?.space).toBe(space);
    expect(row?.intensity ?? 0).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
  }, 300_000);

  it("la leña juntada en el monte pasa a la pila del hogar al encenderlo", () => {
    const life = Life.create(7, content, {
      hearths: true,
      wildHarvest: true,
      wildFirewood: true,
    });
    const w = life.world;
    const { id, space } = homeHearth(w);
    const mine = w.truth.get(PERSON, w.player)?.household;
    if (mine === undefined) throw new Error("sin hogar");
    life.advanceTo(life.now + DAY);
    // Al monte a juntar leña.
    const forest = w.truth.ids(PLACE).find((p) => w.truth.get(PLACE, p)?.kind === "forest");
    const hex = forest === undefined ? undefined : w.truth.get(PLACE, forest)?.hexes[0];
    if (hex === undefined) throw new Error("sin monte");
    w.truth.set(LOCATION, w.player, { hex });
    doVerb(life, "gather", [{ role: "what", text: "leña" }]);
    const carried = w.ledger.balance(holderAccount(w.player), WOOD);
    expect(carried).toBeGreaterThan(0);
    standAt(w, space);
    const pile = w.ledger.balance(holderAccount(mine), WOOD);
    const lit = doVerb(life, "kindle");
    expect(lit?.hearth ?? null).not.toBeNull();
    expect(w.ledger.balance(holderAccount(w.player), WOOD)).toBe(0);
    expect(w.ledger.balance(holderAccount(mine), WOOD)).toBe(pile + carried);
    expect(w.truth.get(HEARTH, id as never)?.intensity ?? 0).toBeGreaterThan(0);
    // Al día siguiente el hogar quema de esa pila.
    life.advanceTo(life.now + DAY);
    expect(w.ledger.balance(holderAccount(mine), WOOD)).toBeLessThan(pile + carried);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("fuera de una casa no hay hogar que encender", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const outdoor = w.spaces.spaces.find((s) => !s.indoor);
    if (outdoor === undefined) throw new Error("sin afuera");
    standAt(w, outdoor.key);
    expect(doVerb(life, "kindle")?.hearth ?? null).toBeNull();
  }, 300_000);

  it("apagado (sin `hearths`), encender no hace nada", () => {
    const life = Life.create(7, content);
    const w = life.world;
    expect(doVerb(life, "kindle")?.hearth ?? null).toBeNull();
    expect(w.truth.ids(HEARTH).length).toBe(0);
  }, 300_000);
});
