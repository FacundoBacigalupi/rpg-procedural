import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  ledgerUnit,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  CREDIT,
  type Credit,
  INNATE,
  LOCATION,
  LOT_QUALITY,
  PERSON,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { optInParts } from "./create.ts";
import { Life } from "./index.ts";
import { SCAM_DEBT_FULL, scamNeedOf } from "./scampolicy.ts";
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

function indebted(debtor: AgentId, creditor: AgentId): Credit {
  return {
    kind: "credit",
    creditor,
    debtor,
    unit: grain,
    principal: SCAM_DEBT_FULL,
    owed: SCAM_DEBT_FULL,
    lent: 0 as Tick,
    due: 1e9 as Tick,
    status: "open",
    history: [],
  };
}

/** Compra un kilo de grano de baja calidad a cada vecino; devuelve las monedas pagadas por kilo. */
function buyFromEveryone(
  seed: number,
  scam: boolean,
): { prices: number[]; qualities: number[]; hash: unknown } {
  const life = Life.create(seed, content, scam ? { scam: true } : {});
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const here = w.truth.get(LOCATION, me);
  const prices: number[] = [];
  const qualities: number[] = [];
  let seq = 1;
  for (const n of living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home)) {
    if (here) w.truth.set(LOCATION, n, here);
    w.truth.set(LOT_QUALITY, n, { [grain]: 0.2 });
    // Tramposo de temperamento (poca voluntad, mucha audacia).
    const innate = { ...w.truth.get(INNATE, n) };
    for (const t of w.traits) {
      if (t.id === "willpower") innate[t.id] = t.mean - 3 * t.sd;
      if (t.id === "boldness") innate[t.id] = t.mean + 3 * t.sd;
    }
    w.truth.set(INNATE, n, innate);
    // Endeudado hasta el tope: la necesidad empuja a inflar (misma deuda en las dos corridas).
    w.truth.set(CREDIT, `commitment:${9000 + seq}` as never, indebted(n, me));
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: {
        kind: "do",
        verb: "trade",
        args: [
          { role: "with", entity: n },
          { role: "what", text: "8 kilos de grano" },
        ],
        manner: [],
      },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const ev = life.turn(plan, seq++).events.find((e) => e.kind === "action.trade");
    const d = ev?.data as
      | { effect?: { deal?: boolean; grams?: number; coins?: number; quality?: number } }
      | undefined;
    if (d?.effect?.deal && (d.effect.grams ?? 0) > 0) {
      qualities.push(d.effect.quality ?? -1);
      prices.push((d.effect.coins ?? 0) / ((d.effect.grams ?? 1) / 1000));
    }
  }
  expect(w.ledger.audit()).toEqual([]);
  return { prices, qualities, hash: life.hash() };
}

describe("estafa en la vida (opt-in)", () => {
  it("apagada por defecto: las partes no cambian", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ scam: true })).toEqual({ scam: true });
  });

  it("trato de punta a punta: con la estafa encendida el comprador paga de más, el lote sigue real y el ledger cuadra", () => {
    const off = buyFromEveryone(2, false);
    const on = buyFromEveryone(2, true);
    expect(off.prices.length).toBeGreaterThan(0);
    expect(on.prices.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    process.stderr.write(`${JSON.stringify([off.prices, on.prices])}\n`);
    expect(mean(on.prices)).toBeGreaterThan(mean(off.prices));
    // El lote cambia de manos con su calidad real, no con la ofrecida.
    expect(on.qualities.every((q) => q === 0.2)).toBe(true);
    expect(buyFromEveryone(2, true).hash).toEqual(on.hash);
  }, 240_000);

  it("la necesidad sale del hambre y de la deuda viva", () => {
    const who = "agent:1" as AgentId;
    const rows = new Map<string, unknown>();
    const body = { plan: "none" } as unknown;
    const truth = {
      ids: (t: { name: string }) => (t.name === CREDIT.name ? [...rows.keys()] : []),
      get: (t: { name: string }, id: string) =>
        t.name === CREDIT.name ? rows.get(id) : t.name === BODY_STATE.name ? body : undefined,
    } as unknown as ReadonlyWorldTruth;
    const need = scamNeedOf([]);
    expect(need(truth, who)).toBe(0);
    rows.set("commitment:1", {
      kind: "credit",
      creditor: "agent:2",
      debtor: who,
      unit: grain,
      principal: SCAM_DEBT_FULL / 2,
      owed: SCAM_DEBT_FULL / 2,
      lent: 0 as Tick,
      due: 100 as Tick,
      status: "open",
      history: [],
    });
    expect(need(truth, who)).toBeCloseTo(0.5, 10);
    rows.set("commitment:2", { ...(rows.get("commitment:1") as object), owed: SCAM_DEBT_FULL });
    expect(need(truth, who)).toBe(1);
  });
});
