// El lobo muerto se carnea (novel3-beasts-fight-carcass): «carneo el lobo» con su cuerpo a la vista
// deja carne de monte y piel cruda en la despensa del hogar de quien carnea, desde
// `CARCASS_SOURCE` con el evento de la acción; el cuerpo termina. Vivo no se carnea.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BEAST,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  LINEAGES,
  LOCATION,
  PERSON,
  PLACE,
  SECT,
  WILDS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { beastCarcassOf } from "./beasts.ts";
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

const DAY = 86400;
const VENISON = ledgerUnit("good:venison");
const HIDE = ledgerUnit("good:hide");

const carve = (actor: AgentId, what: string): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "slaughter", args: [{ role: "what", text: what }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("carnear el lobo (novel3-beasts-fight-carcass)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const lineages = content.all(LINEAGES);

  const run = (kill: boolean) => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    const room = w.spaces.spaces.find((s) => s.hex === hex && s.indoor);
    // Adentro mientras baja: que no lo ataque antes.
    w.truth.set(LOCATION, me, room ? { hex, space: room.key } : { hex });
    life.advanceTo(life.now + DAY + 60);
    const wolf = [...w.truth.ids(BEAST)][0] as EntityRef;
    const body = w.truth.get(BODY_STATE, wolf);
    if (kill && body) {
      w.truth.set(BODY_STATE, wolf, { ...body, death: { at: life.now, cause: "test" } as never });
    }
    w.truth.set(LOCATION, me, { hex });
    const mine = w.truth.get(BODY_STATE, me);
    if (mine) w.truth.set(BODY_STATE, me, { ...mine, sleepDebt: 0, fatigue: 0, water: 0 });
    const larder = holderAccount(
      (w.truth.get(PERSON, me)?.household ?? me) as unknown as HolderRef,
    );
    const before = {
      meat: w.ledger.balance(larder, VENISON),
      hide: w.ledger.balance(larder, HIDE),
    };
    const target = beastCarcassOf(w, "el lobo", lineages);
    life.turn(carve(me, "el lobo"), 1);
    return { life, w, wolf, larder, before, target };
  };

  it("muerto: su carne y su piel van a la despensa y el cuerpo termina", () => {
    const { w, wolf, larder, before, target } = run(true);
    expect(target?.animal).toBe(wolf);
    expect(target?.yields).toEqual([
      { unit: VENISON, grams: 14000 },
      { unit: HIDE, grams: 2800 },
    ]);
    expect(w.truth.get(ENTITY, wolf)?.endedAt).toBeDefined();
    expect(w.ledger.balance(larder, VENISON)).toBe(before.meat + 14000);
    expect(w.ledger.balance(larder, HIDE)).toBe(before.hide + 2800);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 600_000);

  it("vivo no se carnea", () => {
    const { w, wolf, target } = run(false);
    expect(target).toBeUndefined();
    expect(w.truth.get(ENTITY, wolf)?.endedAt).toBeUndefined();
  }, 600_000);

  it("determinista", () => {
    expect(run(true).life.hash().total).toBe(run(true).life.hash().total);
  }, 600_000);
});
