// El tesoro de la secta (novel-sect-duty-treasury): la secta tiene su tenencia de grano y cobre en
// el ledger; llega a la carne con una dotación (la despensa más una reserva), cada semana le entra el
// tributo de la fuente externa `sect.upkeep` y de ahí se paga la despensa de la sede. Si el tesoro no
// alcanza, la despensa queda corta y se anota cuánto.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type EntityRef,
  type Event,
  HOUR,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  COPPER,
  checkInvariants,
  HARVEST_GOOD,
  LOCATION,
  PLACE,
  SECT,
  SECT_MEMBER,
  SECT_STIPEND_EVENT,
  STIPEND_BY_RANK,
  STIPEND_EVERY_DAYS,
  stipendShares,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import {
  SECT_HALL,
  SECT_HALL_EVENT,
  SECT_TRIBUTE_EVENT,
  SECT_UPKEEP_EVENT,
  treasuryAccount,
} from "./sect-hall.ts";
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

describe("el tesoro de la secta", () => {
  it("la dotación llena el tesoro, la despensa sale de ahí y cada semana entra tributo", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const treasury = treasuryAccount(org);
    const of = (kind: string) => w.log.all().filter((e: Event) => e.kind === kind);

    w.truth.set(LOCATION, life.player, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    const hall = w.truth.get(SECT_HALL, org);
    if (!hall) throw new Error("sin sede");
    const larder = holderAccount(hall.house as unknown as HolderRef);
    const [endowment] = of(SECT_TRIBUTE_EVENT);
    const [born] = of(SECT_HALL_EVENT);
    expect(endowment?.data).toMatchObject({ org, endowment: true, coin: COPPER });
    expect(endowment?.causes).toEqual([{ kind: "event", event: born?.id }]);
    const [stocked] = of(SECT_UPKEEP_EVENT);
    if (!endowment || !stocked) throw new Error("sin dotación");
    expect(stocked.causes).toEqual([{ kind: "event", event: endowment.id }]);
    const grams = (stocked.data as { grams: number }).grams;
    expect(grams).toBeGreaterThan(0);
    expect(stocked.data).not.toHaveProperty("short");
    // La reserva queda en el tesoro: lo que entró menos lo que pasó a la despensa.
    const given = (endowment.data as { grams: number }).grams;
    expect(w.ledger.balance(treasury, HARVEST_GOOD)).toBe(given - grams);
    expect(w.ledger.balance(treasury, COPPER)).toBe((endowment.data as { amount: number }).amount);
    expect(w.ledger.balance(larder, HARVEST_GOOD)).toBeGreaterThan(0);

    // Una semana y un poco: entra el tributo y sale lo que comieron.
    life.advanceTo(life.now + 8 * w.clock.day);
    const tributes = of(SECT_TRIBUTE_EVENT);
    expect(tributes.length).toBe(2);
    const weekly = tributes[1];
    expect(weekly?.data).not.toHaveProperty("endowment");
    expect(weekly?.causes).toEqual([{ kind: "state", entity: org, key: SECT.name }]);
    const paid = of(SECT_UPKEEP_EVENT).filter((e) => e.tick === weekly?.tick);
    for (const e of paid) expect(e.causes).toEqual([{ kind: "event", event: weekly?.id }]);
    expect(w.ledger.balance(treasury, COPPER)).toBeGreaterThan(
      (endowment.data as { amount: number }).amount,
    );
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 180_000);

  it("el sueldo es por rango; si el cobre no alcanza, todos cobran la misma fracción", () => {
    expect(STIPEND_BY_RANK.outer).toBeLessThan(STIPEND_BY_RANK.inner);
    expect(stipendShares([30, 60], 100)).toEqual({ shares: [30, 60], ratio: 1 });
    expect(stipendShares([30, 60], 45)).toEqual({ shares: [15, 30], ratio: 0.5 });
    expect(stipendShares([30, 60], 0)).toEqual({ shares: [0, 0], ratio: 0 });
  });

  it("al mes, cada miembro en la sede cobra su sueldo del tesoro y el personaje lo nota", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(LOCATION, me, { hex });
    const purse = holderAccount(me as unknown as HolderRef);
    const before = w.ledger.balance(purse, COPPER);
    life.advanceTo(life.now + 2 * HOUR);
    // Sin esperar un mes (sin agua ni comida, el personaje no duraría): el último pago fue hace uno.
    const born = w.truth.get(SECT_HALL, org);
    if (!born) throw new Error("sin sede");
    w.truth.set(SECT_HALL, org, { ...born, paid: life.now - STIPEND_EVERY_DAYS * w.clock.day });
    const from = life.now;
    life.advanceTo(life.now + 2 * HOUR);
    const paid = w.log.all().filter((e) => e.kind === SECT_STIPEND_EVENT);
    expect(paid.length).toBe(1);
    const [pay] = paid;
    if (!pay) throw new Error("sin sueldo");
    const i = pay.actors.indexOf(me);
    expect(i).toBeGreaterThanOrEqual(0);
    const shares = (pay.data as { shares: number[] }).shares;
    expect(shares[i]).toBe(STIPEND_BY_RANK.outer);
    expect(pay.data).not.toHaveProperty("cut");
    expect(w.ledger.balance(purse, COPPER)).toBeGreaterThanOrEqual(before + STIPEND_BY_RANK.outer);
    // La gente de la sede cobra por su rango.
    const hall = w.truth.get(SECT_HALL, org);
    for (const { person } of hall?.people ?? []) expect(pay.actors).toContain(person);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("stipend_paid");
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 300_000);
});
