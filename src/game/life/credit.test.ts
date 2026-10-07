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
  CREDIT,
  type Credit,
  checkInvariants,
  KNOWN_DEEDS,
  LOCATION,
  PERSON,
  worstDeed,
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

/** Un vecino de otra casa, junto al personaje, al que se le pide hasta que fía. */
function lent(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const here = w.truth.get(LOCATION, me);
  const neighbors = living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home);
  let seq = 1;
  for (const n of neighbors) {
    if (here) w.truth.set(LOCATION, n, here);
    const report = life.turn(ask(me, n), seq++);
    const reply = report.events.find((e) => e.actors[0] === n && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    if (line === "request.credit") return { life, w, me, creditor: n, seq };
  }
  throw new Error("ningún vecino fió");
}

const rows = (w: Life["world"]) =>
  w.truth.ids(CREDIT).map((id) => ({ id, credit: w.truth.get(CREDIT, id) as Credit }));

describe("el fiado de aldea", () => {
  it("un vecino que accede deja una deuda con origen y el grano se mueve sin romper el ledger", () => {
    const { w, me, creditor } = lent(7);
    const [row] = rows(w);
    expect(rows(w)).toHaveLength(1);
    expect(row?.credit).toMatchObject({ creditor, debtor: me, status: "open", unit: grain });
    expect(w.truth.get(CREDIT, row?.id as never)?.owed).toBe(row?.credit.principal);
    expect(w.ledger.balance(holderAccount(me as unknown as HolderRef), grain)).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);

  it("devolverle salda la deuda, y no más", () => {
    const { life, w, me, creditor, seq } = lent(7);
    const before = w.ledger.balance(holderAccount(creditor as unknown as HolderRef), grain);
    life.turn(pay(me, creditor), seq);
    expect(rows(w)[0]?.credit).toMatchObject({ status: "settled", owed: 0 });
    expect(
      w.ledger.balance(holderAccount(creditor as unknown as HolderRef), grain),
    ).toBeGreaterThan(before);
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);

  it("pasado el plazo sin pagar, el acreedor reclama y la fama cambia el trato", () => {
    const { life, w, me, creditor } = lent(7);
    // Esperar un mes y medio sin comer mata al personaje: se le corre el plazo en vez de esperar.
    const [row] = rows(w);
    w.truth.set(CREDIT, row?.id as never, {
      ...(row?.credit as Credit),
      due: life.now - 8 * w.clock.day,
    });
    life.advanceTo(life.now + 2 * w.clock.day);
    expect(rows(w)[0]?.credit.status).toBe("defaulted");
    expect(worstDeed(w.truth.get(KNOWN_DEEDS, creditor), me)?.kind).toBe("default");
    expect(w.log.all().some((e) => e.kind === "law.default")).toBe(true);
  }, 120_000);

  it("es determinista", () => {
    const run = () => {
      const { life, w } = lent(7);
      const [row] = rows(w);
      w.truth.set(CREDIT, row?.id as never, {
        ...(row?.credit as Credit),
        due: life.now - 8 * w.clock.day,
      });
      life.advanceTo(life.now + 2 * w.clock.day);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 240_000);
});
