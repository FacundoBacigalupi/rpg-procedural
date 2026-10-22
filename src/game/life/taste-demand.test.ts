import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  LOCATION,
  PERSON,
  type Preference,
  TASTES_OF,
  type TasteDef,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { Life, type LifeOptions } from "./index.ts";
import { living } from "./world.ts";

// Gustos en la demanda (psy-tastes-demand): con `tasteDemand`, el gusto de quien compra corre lo
// máximo que paga por los bienes que nombra `demandGoods`. Apagado, el trato no los mira.

const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
// El grano del trato se vuelve lo que satisface lo dulce.
const content = loadContent(
  GAME_CONTENT_KINDS,
  sources("content").map((s) =>
    s.kind === "tastes"
      ? {
          ...s,
          data: (s.data as TasteDef[]).map((d) =>
            d.id === "sweet" ? { ...d, demandGoods: [...d.demandGoods, "grain"] } : d,
          ),
        }
      : s,
  ),
);

const sweet = (valence: number): Preference => ({
  domain: "food.flavor",
  item: "sweet",
  valence,
  strength: 0.9,
  originEventIds: [],
  acquired: false,
});

/** Lo que paga el jugador por un kilo de grano al primer vecino con quien cierra el trato. */
function pricePaid(options: LifeOptions, valence: number | undefined): number | undefined {
  const life = Life.create(2, content, options);
  const w = life.world;
  const me = life.player;
  if (valence !== undefined) {
    const prev = w.truth.get(TASTES_OF, me);
    w.truth.set(TASTES_OF, me, {
      preferences: [sweet(valence)],
      chosen: [],
      originEventId: prev?.originEventId as never,
    });
  }
  const home = w.truth.get(PERSON, me)?.household;
  const here = w.truth.get(LOCATION, me);
  let seq = 1;
  for (const n of living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home)) {
    if (here) w.truth.set(LOCATION, n, here);
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: {
        kind: "do",
        verb: "trade",
        args: [
          { role: "with", entity: n },
          { role: "what", text: "1 kilo de grano" },
        ],
        manner: [],
      },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const ev = life.turn(plan, seq++).events.find((e) => e.kind === "action.trade");
    const d = ev?.data as
      | { effect?: { deal?: boolean; grams?: number; coins?: number } }
      | undefined;
    if (d?.effect?.deal && (d.effect.grams ?? 0) > 0) {
      expect(w.ledger.audit()).toEqual([]);
      return (d.effect.coins ?? 0) / (d.effect.grams as number);
    }
  }
  return undefined;
}

describe("gustos en la demanda (opt-in)", () => {
  it("lo que gusta se paga más y lo que da asco menos, con el mismo vecino", () => {
    const on: LifeOptions = { tasteDemand: true };
    const loved = pricePaid(on, 0.9);
    const neutral = pricePaid(on, undefined);
    const loathed = pricePaid(on, -0.9);
    expect(loved).toBeDefined();
    expect(neutral).toBeDefined();
    expect(loathed).toBeDefined();
    expect(loved as number).toBeGreaterThanOrEqual(neutral as number);
    expect(loathed as number).toBeLessThanOrEqual(neutral as number);
    expect(loved as number).toBeGreaterThan(loathed as number);
  }, 240_000);

  it("apagado, el gusto no mueve el precio", () => {
    expect(pricePaid({}, 0.9)).toEqual(pricePaid({}, -0.9));
  }, 240_000);

  it("encendido no mueve el hash de develop y es determinista", () => {
    const plain = loadContent(GAME_CONTENT_KINDS, sources("content"));
    expect(Life.create(3, plain, { tasteDemand: true }).hash().total).toBe(BASE_HASH);
    const run = () => {
      const l = Life.create(3, plain, { tasteDemand: true });
      l.advanceTo(l.now + 10 * l.world.clock.day);
      return l.hash().total;
    };
    expect(run()).toBe(run());
  }, 600_000);
});
