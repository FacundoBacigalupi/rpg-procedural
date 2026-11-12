// Canjear puntos por píldoras (novel2-pills-exchange): en la sede, el que es de la secta pide una
// píldora del tesoro; si le alcanzan los puntos y queda alguna, sale del tesoro a su mano en el
// libro mayor y se le descuentan; si no, no, y el personaje sabe por qué.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_MEMBER,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { treasuryAccount } from "./sect-hall.ts";
import { playerView } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const askPill = (actor: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "redeem",
    args: [{ role: "what", text: "píldora de reunir qi" }],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("canjear puntos por píldoras (novel2-pills-exchange)", () => {
  it("da la píldora del tesoro por puntos; sin puntos o sin existencias, no", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const ref = me as unknown as EntityRef;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const unit = ledgerUnit("good:pill-qi-gathering");
    const treasury = treasuryAccount(org);
    const mine = holderAccount(me as unknown as HolderRef);
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    // Una sola píldora en el tesoro, para ver cuándo se acaba.
    const stock = w.ledger.balance(treasury, unit);
    const move = (from: typeof treasury, to: typeof treasury, amount: number) =>
      w.ledger.post({
        tick: first.tick,
        eventId: first.id,
        transfers: [{ unit, from, to, amount }],
      });
    if (stock > 0) move(treasury, externalAccount("seed"), stock);
    move(externalAccount("seed"), treasury, 1);
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
      w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });
    };
    const exchanges = (from: number) =>
      w.log
        .all()
        .filter((e) => e.kind === SECT_EXCHANGE_EVENT && e.actors[0] === me && e.tick >= from);
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });

    // Sin puntos suficientes: no.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 5, hours: 1, last: life.now });
    rested();
    let from = life.now;
    life.turn(askPill(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({
      what: "pill",
      pill: "qi-gathering",
      refused: "no_points",
    });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("pill_no_points");
    expect(w.ledger.balance(mine, unit)).toBe(0);

    // Con puntos: sale del tesoro a su mano y se descuentan.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 15, hours: 1, last: life.now });
    rested();
    from = life.now;
    life.turn(askPill(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ org, what: "pill", pill: "qi-gathering" });
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(5);
    expect(w.ledger.balance(mine, unit)).toBe(1);
    expect(w.ledger.balance(treasury, unit)).toBe(0);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("pill_bought");

    // El tesoro quedó vacío: no hay.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 15, hours: 1, last: life.now });
    rested();
    from = life.now;
    life.turn(askPill(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ refused: "no_stock" });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("pill_no_stock");
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(15);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
