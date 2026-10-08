import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  defaultDeltas,
  giveDeltas,
  LOCATION,
  type Mind,
  PERSON,
  RELATIONS,
  type Relations,
  repaidDeltas,
  tendDeltas,
  tradeDeltas,
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

const plan = (
  actor: AgentId,
  verb: string,
  args: Extract<ActionPlan["root"], { kind: "do" }>["args"],
): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb, args, manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("cómo cambia una relación por el trato y la ayuda", () => {
  it("recibir un regalo agradece y confía más cuanto más grande; devolver agradece menos", () => {
    const big = giveDeltas("receiver", 1000);
    const small = giveDeltas("receiver", 50);
    expect(big.gratitude ?? 0).toBeGreaterThan(small.gratitude ?? 0);
    expect(big.gratitude ?? 0).toBeGreaterThan(0);
    const back = giveDeltas("receiver", 1000, true);
    expect(back.gratitude ?? 0).toBeLessThan(big.gratitude ?? 0);
    expect(back.trust ?? 0).toBeGreaterThan(big.trust ?? 0);
  });

  it("sacar ventaja en el trato enoja al otro; ceder lo hace agradecer", () => {
    const sharp = tradeDeltas("other", 0.3);
    const even = tradeDeltas("other", 0);
    const generous = tradeDeltas("other", -0.3);
    expect(sharp.resentment ?? 0).toBeGreaterThan(0);
    expect(sharp.trust ?? 0).toBeLessThan(even.trust ?? 0);
    expect(even.trust ?? 0).toBeGreaterThan(0);
    expect(generous.gratitude ?? 0).toBeGreaterThan(0);
  });

  it("curar bien acerca al curado; curar mal no mueve más que la familiaridad", () => {
    const well = tendDeltas("cared", 0.9);
    expect(well.gratitude ?? 0).toBeGreaterThan(0);
    expect(well.dependency ?? 0).toBeGreaterThan(0);
    expect(Object.keys(tendDeltas("cared", 0))).toEqual(["familiarity"]);
  });

  it("devolver sube la confianza del acreedor; no pagar la baja, más si ya desconfiaba poco", () => {
    expect(repaidDeltas("creditor").trust ?? 0).toBeGreaterThan(0);
    const blank: Mind = { schemas: {}, formative: [], originEventId: 1 as never };
    const lost = defaultDeltas("creditor", blank);
    expect(lost.trust ?? 0).toBeLessThan(0);
    expect(lost.resentment ?? 0).toBeGreaterThan(0);
  });
});

describe("la aldea se trata", () => {
  const ask = (me: AgentId, to: AgentId) =>
    plan(me, "speak", [
      { role: "to", entity: to },
      { role: "content", text: "Dame un poco de grano" },
    ]);
  const pay = (me: AgentId, to: AgentId) =>
    plan(me, "give", [
      { role: "to", entity: to },
      { role: "what", text: "grano" },
    ]);
  /** Pide grano a los vecinos hasta que uno fía; paga y devuelve lo que sienten. */
  function borrowAndPay() {
    const life = Life.create(7, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const here = w.truth.get(LOCATION, me);
    let seq = 1;
    for (const n of living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home)) {
      if (here) w.truth.set(LOCATION, n, here);
      const report = life.turn(ask(me, n), seq++);
      const asked = report.events.find((e) => e.actors[0] === n && e.kind === "action.speak");
      const line = (asked?.data as { effect: { reply: string } } | undefined)?.effect.reply;
      if (line !== "request.credit") continue;
      const toward = (a: AgentId, b: AgentId) =>
        (w.truth.get(RELATIONS, a) as Relations | undefined)?.toward[b];
      const lent = { creditor: toward(n, me), debtor: toward(me, n) };
      const paid = life.turn(pay(me, n), seq).events.find((e) => e.kind === "action.give");
      return { w, me, n, lent, after: { creditor: toward(n, me), debtor: toward(me, n) }, paid };
    }
    throw new Error("ningún vecino fió");
  }

  it("fiar y devolver mueven la confianza del acreedor y la gratitud del deudor, citando los eventos", () => {
    const { w, lent, after, paid } = borrowAndPay();
    expect(lent.debtor?.dims.gratitude ?? 0).toBeGreaterThan(0);
    expect(lent.creditor?.dims.trust ?? 0).toBeGreaterThan(0);
    expect(paid).toBeDefined();
    expect(after.creditor?.history).toContain(paid?.id);
    expect(after.creditor?.dims.trust ?? 0).toBeGreaterThan(lent.creditor?.dims.trust ?? 0);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 180_000);

  it("es determinista", () => {
    const run = () => JSON.stringify(borrowAndPay().after);
    expect(run()).toBe(run());
  }, 360_000);
});
