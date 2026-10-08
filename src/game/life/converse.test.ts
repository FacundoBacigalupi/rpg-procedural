import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  addMemory,
  callName,
  checkInvariants,
  formMemory,
  HEARD,
  LOCATION,
  MEMORIES,
  PERSON,
  PERSON_NAME,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  relationship,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

function scene(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const mates = living(w.truth).filter(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  );
  const other = mates[0] as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) for (const id of mates) w.truth.set(LOCATION, id, here);
  return { life, w, me, other, mates, house: house as string };
}

const nameOf = (w: ReturnType<typeof scene>["w"], id: AgentId) =>
  callName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] }) ?? "Nadie";

describe("hablar con alguien de la casa", () => {
  it("el oyente contesta con un action.speak suyo, con causa, que el personaje oye", () => {
    const { life, me, other } = scene(7);
    const report = life.turn(say(me, other, "Hola"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
    expect(reply).toBeDefined();
    expect(reply?.actors).toEqual([other, me]);
    expect(reply?.causes[0]?.kind).toBe("state");
    const data = reply?.data as { effect: { text: string; reply: string } };
    expect(data.effect.reply).toBe("greet");
    expect(data.effect.text.length).toBeGreaterThan(0);
  }, 60_000);

  it("de alguien que no conoce dice que no sabe, sin inventar", () => {
    const { life, w, me, other } = scene(7);
    const home = w.truth.get(PERSON, me)?.household;
    const stranger = living(w.truth).find(
      (id) => w.truth.get(PERSON, id)?.household !== home,
    ) as AgentId;
    const report = life.turn(say(me, other, `¿Sabés dónde está ${nameOf(w, stranger)}?`), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["ask.unclear", "ask.unknown"]).toContain(line);
  }, 60_000);

  it("un pedido mueve grano de la casa al personaje sin romper el ledger", () => {
    const { life, w, me, other, house } = scene(7);
    const larder = holderAccount(house as unknown as HolderRef);
    const mine = holderAccount(me as unknown as HolderRef);
    const before = w.ledger.total(grain);
    const stock = w.ledger.balance(larder, grain);
    const got0 = w.ledger.balance(mine, grain);
    const report = life.turn(say(me, other, "Dame un poco de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["request.give", "request.credit", "request.short"]).toContain(line);
    if (line === "request.give" || line === "request.credit") {
      expect(w.ledger.balance(mine, grain)).toBeGreaterThan(got0);
      expect(w.ledger.balance(larder, grain)).toBeLessThan(stock);
    }
    expect(w.ledger.total(grain)).toBe(before);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 60_000);

  it("el rencor del oyente cierra el pedido aunque sea de la casa", () => {
    const { life, w, me, other } = scene(7);
    const dims = {
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      schemaStrength: () => 0,
    };
    const rel = relationship(w.truth.get(RELATIONS, other), me, life.now, dims);
    const toward = { ...(w.truth.get(RELATIONS, other)?.toward ?? {}) };
    toward[me] = { ...rel, dims: { ...rel.dims, resentment: 0.8 } };
    const row = w.truth.get(RELATIONS, other);
    w.truth.set(RELATIONS, other, {
      toward,
      originEventId: row?.originEventId ?? (w.log.all()[0]?.id as never),
    });
    const report = life.turn(say(me, other, "Dame un poco de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(line).toBe("request.refuse.grudge");
  }, 60_000);

  it("un recuerdo doloroso y vívido del personaje enfría el saludo y cierra el pedido", () => {
    const wary = (text: string) => {
      const { life, w, me, other } = scene(7);
      const first = w.log.all()[0];
      const m = formMemory({
        eventId: first?.id as never,
        kind: "combat.fight",
        with: [me],
        place: first?.place as never,
        at: life.now,
        intensity: 0.9,
        valence: -0.9,
      });
      w.truth.set(MEMORIES, other, addMemory(w.truth.get(MEMORIES, other), m, life.now));
      const report = life.turn(say(me, other, text), 1);
      const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
      return (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    };
    expect(wary("Hola")).toBe("greet.wary");
    expect(wary("Dame un poco de grano")).toBe("request.refuse.remembered");
  }, 60_000);

  it("no toma como dicho lo que contradice lo que ve", () => {
    const { life, w, me, other, mates } = scene(7);
    const third = mates.find((id) => id !== other);
    if (!third) return;
    life.turn(say(me, other, `Te cuento que ${nameOf(w, third)} murió`), 1);
    expect(w.truth.get(HEARD, other)?.claims ?? []).toEqual([]);
  }, 60_000);

  it("es determinista", () => {
    const run = () => {
      const { life, me, other } = scene(7);
      life.turn(say(me, other, "Hola"), 1);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 60_000);
});

describe("hablarle a alguien sin decir nada", () => {
  it("el oyente lo toma como un saludo y contesta", () => {
    const { life, me, other } = scene(7);
    const report = life.turn(
      {
        actor: me,
        source: "player",
        root: { kind: "do", verb: "speak", args: [{ role: "to", entity: other }], manner: [] },
        manner: [],
        causes: [{ kind: "state", entity: me, key: "intent" }],
      },
      1,
    );
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
    expect((reply?.data as { effect: { reply: string } } | undefined)?.effect.reply).toBe("greet");
  }, 60_000);
});
