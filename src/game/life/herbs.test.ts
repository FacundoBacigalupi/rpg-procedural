// Las hierbas espirituales en la vida (novel2-pills-herbs): crecen en la sede, donde el qi es denso,
// y se juntan nombrándolas; lo juntado sale de la cuenta del lugar y rebrota.

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
  type PlaceId,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  HERB_STAND,
  LOCATION,
  PLACE,
  PLACE_QI,
  qiRatio,
  SECT,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { HERBS_GREW_EVENT } from "./herbs.ts";
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

const gatherHerbs = (actor: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "gather",
    args: [{ role: "what", text: "hierbas espirituales" }],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("hierbas espirituales (novel2-pills-herbs)", () => {
  it("crecen en la sede con su qi y se juntan nombrándolas", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const seat = sect.seatPlace;
    const qi = w.truth.get(PLACE_QI, seat);
    if (!qi) throw new Error("la sede sin qi");
    expect(qiRatio(qi)).toBeGreaterThan(1.2);
    const unit = ledgerUnit("good:spirit-herb");
    const there = holderAccount({ kind: "place", place: seat as unknown as PlaceId });
    const mine = holderAccount(me as unknown as HolderRef);
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(seat, "hall") });
    const body = w.truth.get(BODY_STATE, me);
    if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });

    // Al pasar un día, el proceso pone en la cuenta de la sede lo que hay en pie.
    life.advanceTo(life.now + w.clock.day);
    const grown = w.ledger.balance(there, unit);
    expect(grown).toBeGreaterThan(0);
    expect(w.truth.get(HERB_STAND, seat)?.standing["spirit-grass"]).toBeGreaterThan(0);
    const grew = w.log.all().find((e) => e.kind === HERBS_GREW_EVENT);
    expect(grew?.causes[0]).toEqual({ kind: "state", entity: seat, key: PLACE_QI.name });

    // Juntarlas: salen de la cuenta del lugar a la mano.
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(seat, "hall") });
    const rested = w.truth.get(BODY_STATE, me);
    if (rested) w.truth.set(BODY_STATE, me, { ...rested, sleepDebt: 0, fatigue: 0, water: 0 });
    life.turn(gatherHerbs(me), 1);
    const got = w.ledger.balance(mine, unit);
    expect(got).toBeGreaterThan(0);
    expect(w.ledger.balance(there, unit)).toBe(grown - got);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
