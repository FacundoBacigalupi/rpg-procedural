import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, ledgerUnit, loadContent } from "../../core/index.ts";
import { poolConserved } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  COOP_CONTRIBUTED_EVENT,
  COOP_FAILED_EVENT,
  COOP_FOUNDED_EVENT,
  COOP_JOINED_EVENT,
  COOP_SETTLED_EVENT,
  coopAccount,
  coopRows,
} from "./coop.ts";
import { Life } from "./life.ts";
import { COMMITMENTS } from "./loans.ts";

const DAY = 86400;
const must = (): never => {
  throw new Error("falta el proyecto");
};

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop: apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("proyectos cooperativos de la aldea (coop)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (coop: boolean, days: number) => {
    const l = Life.create(3, content, coop ? { council: {}, coop: {} } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("apagado deja el hash de develop, sin proyectos ni eventos", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(coopRows(off.world.truth)).toEqual([]);
    expect(off.world.log.all().some((e) => e.kind === COOP_FOUNDED_EVENT)).toBe(false);
  });

  it("coop sin council falla", () => {
    expect(() => Life.create(3, content, { coop: {} })).toThrow(/council/);
  });

  it("determinista", () => {
    expect(run(true, 20).hash().total).toBe(run(true, 20).hash().total);
  });

  it("el cabeza funda la obra, la gente se suma y aporta del hogar con el pool conservado", () => {
    const l = run(true, 30);
    const kinds = (k: string) => l.world.log.all().filter((e) => e.kind === k);
    expect(kinds(COOP_FOUNDED_EVENT)).toHaveLength(1);
    const rows = coopRows(l.world.truth);
    expect(rows).toHaveLength(1);
    const { project } = rows[0]?.row ?? must();
    expect(kinds(COOP_JOINED_EVENT).length).toBeGreaterThan(0);
    expect(project.participants.length).toBeGreaterThan(1);
    expect(kinds(COOP_CONTRIBUTED_EVENT).length).toBeGreaterThan(0);
    expect(poolConserved(project.pool)).toBe(true);
    // todo evento del proyecto tiene causas
    for (const e of l.world.log.all().filter((x) => x.kind.startsWith("coop."))) {
      expect(e.causes.length).toBeGreaterThan(0);
    }
    // el ledger y el pool dicen lo mismo
    const bal = l.world.ledger.balance(coopAccount(project), ledgerUnit(project.pool.good)) ?? 0;
    expect(bal).toBe(project.pool.balance);
  });

  it("al vencer cierra: reparte o reintegra y la cuenta del proyecto queda en el saldo del pool", () => {
    const l = run(true, 60);
    const { project, settled } = coopRows(l.world.truth)[0]?.row ?? must();
    expect(settled).toBe(true);
    const kinds = l.world.log.all().map((e) => e.kind);
    expect(kinds.includes(COOP_SETTLED_EVENT) || kinds.includes(COOP_FAILED_EVENT)).toBe(true);
    expect(poolConserved(project.pool)).toBe(true);
    const bal = l.world.ledger.balance(coopAccount(project), ledgerUnit(project.pool.good)) ?? 0;
    expect(bal).toBe(project.pool.balance);
  });

  it("el reparto vive como Commitment: una obligación por participante, con lo aportado", () => {
    const l = run(true, 30);
    const { project, commitment } = coopRows(l.world.truth)[0]?.row ?? must();
    const c = l.world.truth.get(COMMITMENTS, (commitment ?? must()) as never);
    expect(c?.kind).toBe("project-share");
    expect(c?.obligations).toHaveLength(project.participants.length);
    const performed = (c?.obligations ?? []).reduce((a, o) => a + o.performed, 0);
    expect(performed).toBe(project.participants.reduce((a, x) => a + x.contributed, 0));
    expect(c?.originEventId).toBe(project.originEventId);
  });
});
