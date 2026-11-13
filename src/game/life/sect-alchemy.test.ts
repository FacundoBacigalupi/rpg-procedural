// La alquimia de la secta (novel2-alch-sect): cada semana la secta cosecha parte de las hierbas que
// crecen en su sede y el alquimista refina con ellas las píldoras que faltan en el tesoro; lo que se
// quema entra al horno y de ahí salen las píldoras, todo en el libro mayor.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type EntityRef,
  type Event,
  externalAccount,
  HOUR,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { checkInvariants, LOCATION, PLACE, SECT } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { SECT_ALCHEMY_EVENT } from "./herbs.ts";
import { Life } from "./life.ts";
import { SECT_HALL, treasuryAccount } from "./sect-hall.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

interface Brewed {
  readonly org: EntityRef;
  readonly harvested: Record<string, number>;
  readonly refined: readonly { pill: string; attempts: number; made: number; used: number }[];
  readonly qiBack?: number;
}

describe("la alquimia de la secta (novel2-alch-sect)", () => {
  it("cosecha hierbas de la sede y refina las píldoras que faltan en el tesoro", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, life.player, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    if (!w.truth.get(SECT_HALL, org)) throw new Error("sin sede");

    // El tesoro sin píldoras de reunir qi: hay que refinarlas.
    const treasury = treasuryAccount(org);
    const pill = ledgerUnit("good:pill-qi-gathering");
    const herb = ledgerUnit("good:spirit-herb");
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    const stock = w.ledger.balance(treasury, pill);
    if (stock > 0)
      w.ledger.post({
        tick: first.tick,
        eventId: first.id,
        transfers: [{ unit: pill, from: treasury, to: externalAccount("seed"), amount: stock }],
      });

    const from = life.now;
    life.advanceTo(life.now + 8 * 24 * HOUR);
    const brews = w.log.all().filter((e: Event) => e.kind === SECT_ALCHEMY_EVENT && e.tick >= from);
    const brew = brews[0];
    if (!brew) throw new Error("sin alquimia");
    const data = brew.data as unknown as Brewed;
    expect(data.org).toBe(org);
    expect(data.harvested["spirit-grass"] ?? 0).toBeGreaterThan(0);
    const qi = data.refined.find((r) => r.pill === "qi-gathering");
    expect(qi?.attempts ?? 0).toBeGreaterThan(0);
    expect(qi?.made ?? 0).toBeLessThanOrEqual(qi?.attempts ?? 0);
    expect(qi?.used).toBe((qi?.attempts ?? 0) * 20);
    // novel2-alch-qi: el qi de lo que se quemó vuelve a la celda (cada píldora lleva sus 20 g de qi).
    const back = data.refined.reduce(
      (s, r) => s + (r.pill === "qi-gathering" ? (r.attempts - r.made) * 20 : 0),
      0,
    );
    if (data.refined.length === 1) expect(data.qiBack ?? 0).toBeCloseTo(back, 3);
    // Lo refinado está en el tesoro (salvo lo que se canjeó después, que acá nadie canjea).
    const made = brews.reduce(
      (s, b) =>
        s +
        ((b.data as unknown as Brewed).refined.find((r) => r.pill === "qi-gathering")?.made ?? 0),
      0,
    );
    expect(w.ledger.balance(treasury, pill)).toBe(made);
    expect(w.ledger.balance(externalAccount("sect.furnace"), herb)).toBeGreaterThan(0);
    expect(brew.causes).toContainEqual({ kind: "state", entity: org, key: SECT.name });
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
