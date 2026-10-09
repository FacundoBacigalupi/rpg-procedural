import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  HARVEST,
  LOCATION,
  PERSON,
  ROTTED,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { OPEN_DEALS } from "./converse.ts";
import { Life } from "./life.ts";
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const grain = ledgerUnit("good:grain");

const say = (actor: AgentId, to: AgentId, text: string): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "speak",
    args: [
      { role: "to", entity: to },
      { role: "content", text },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

/** Un vecino con grano de sobra y sin espigas, junto al personaje, que sí tiene espigas. */
function neighbor(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const mine = w.truth.get(PERSON, me)?.household;
  const npc = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household !== mine,
  ) as AgentId;
  const home = w.truth.get(PERSON, npc)?.household as string;
  const larder = holderAccount(home as unknown as HolderRef);
  const first = w.log.all()[0] as NonNullable<ReturnType<typeof w.log.all>[number]>;
  const post = (transfers: Parameters<typeof w.ledger.post>[0]["transfers"]) =>
    w.ledger.post({ tick: first.tick, eventId: first.id, transfers });
  const rows = w.ledger.holdings(larder).filter((h) => h.amount > 0);
  post(
    rows.map((h) => ({
      unit: h.unit,
      from: larder,
      to: externalAccount(ROTTED),
      amount: h.amount,
    })),
  );
  post([{ unit: grain, from: externalAccount(HARVEST), to: larder, amount: 30000 }]);
  const pocket = holderAccount(me as unknown as HolderRef);
  // El personaje trae espigas (una fuente de siembra del ledger).
  const extra = "gleanings";
  const extraUnit = ledgerUnit("good:gleanings");
  post([{ unit: extraUnit, from: externalAccount("seed"), to: pocket, amount: 4000 }]);
  return { life, w, me, npc, larder, pocket, extra, extraUnit };
}

describe("ofertas de los NPC al personaje", () => {
  it("el vecino propone un trueque, queda abierto y al aceptar se mueve por el ledger", () => {
    const { life, w, me, npc, larder, pocket, extra, extraUnit } = neighbor(7);
    const hour = Math.floor(w.clock.day / 24);
    for (let d = 0; d < 24 * 40 && !w.truth.get(OPEN_DEALS, npc); d++) {
      const here = w.truth.get(LOCATION, me);
      if (here) w.truth.set(LOCATION, npc, here);
      life.advanceTo(life.now + hour);
    }
    const open = w.truth.get(OPEN_DEALS, npc);
    expect(open?.with).toBe(me);
    const pitch = w.log
      .all()
      .find((e) => e.kind === "action.speak" && e.actors[0] === npc && e.actors[1] === me);
    expect((pitch?.data as { effect: { reply: string } }).effect.reply).toBe("offer.pitch");
    expect(open?.deal.gives?.good).toBe("grain");
    expect(open?.deal.gets?.good).toBe(extra);

    const here = w.truth.get(LOCATION, me);
    if (here) w.truth.set(LOCATION, npc, here);
    const gave = open?.deal.gives?.grams ?? 0;
    const got = open?.deal.gets?.grams ?? 0;
    const grainBefore = w.ledger.balance(pocket, grain);
    const total = w.ledger.total(grain);
    const report = life.turn(say(me, npc, "Trato hecho"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === npc);
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    if (line === "accept.thanks") {
      expect(w.ledger.balance(pocket, grain)).toBe(grainBefore + gave);
      expect(w.ledger.balance(larder, extraUnit)).toBe(got);
      expect(w.truth.get(OPEN_DEALS, npc)).toBeUndefined();
    } else {
      expect(w.ledger.balance(pocket, grain)).toBe(grainBefore);
    }
    expect(w.ledger.total(grain)).toBe(total);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);

  it("es determinista", () => {
    const run = () => {
      const { life, w, me, npc } = neighbor(7);
      for (let d = 0; d < 48; d++) {
        const here = w.truth.get(LOCATION, me);
        if (here) w.truth.set(LOCATION, npc, here);
        life.advanceTo(life.now + Math.floor(w.clock.day / 24));
      }
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
