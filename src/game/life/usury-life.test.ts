import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type HolderRef,
  holderAccount,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { householdsOf } from "./spoilage.ts";

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

describe("usura con caso comunitario en la vida (opt-in)", () => {
  it("un préstamo disfrazado que la aldea tasa de más se falla: credit.usury_ruled", () => {
    const probe = Life.create(1, content, {});
    const homes = householdsOf(probe.world.truth).map((h) => h as unknown as string);
    const lender = homes[0] as string;
    const borrower = homes[1] as string;
    const held = probe.world.ledger
      .holdings(holderAccount(lender as unknown as HolderRef))
      .filter((h) => h.amount > 1);
    const unit = held.find((h) => h.unit.startsWith("good:"))?.unit;
    if (!unit) throw new Error("sin bien prestable");
    const life = Life.create(1, content, {
      loanSeeds: [
        {
          id: "u1",
          lender,
          borrower,
          good: unit.slice("good:".length),
          principal: 1,
          rate: 0.5,
          startDay: 0,
          termDays: 30,
        },
      ],
      loanEnforcement: { community: "village" },
      loanUsury: {
        prohibits: () => true,
        available: ["gift"],
        suspicion: { tolerance: 0.05, believedValue: (_t, _o, pr) => pr },
        communityCase: { delayDays: 2 },
      },
    });
    life.advanceTo((life.now + 6 * life.world.clock.day) as Tick);
    const kinds = life.world.log.all().map((e) => e.kind);
    expect(kinds).toContain("credit.usury_ruled");
  }, 120_000);
});

describe("interestNorm + loanSeeds + loanUsury derivado (opt-in)", () => {
  function build(variants: Record<string, number>) {
    const probe = Life.create(1, content, {});
    const homes = householdsOf(probe.world.truth).map((h) => h as unknown as string);
    const lender = homes[0] as string;
    const borrower = homes[1] as string;
    const unit = probe.world.ledger
      .holdings(holderAccount(lender as unknown as HolderRef))
      .filter((h) => h.amount > 1)
      .find((h) => h.unit.startsWith("good:"))?.unit;
    if (!unit) throw new Error("sin bien prestable");
    return Life.create(1, content, {
      loanSeeds: [
        {
          id: "u1",
          lender,
          borrower,
          good: unit.slice("good:".length),
          principal: 1,
          rate: 0.5,
          startDay: 0,
          termDays: 30,
        },
      ],
      loanEnforcement: { community: "village" },
      interestNorm: {
        variants,
        tolerance: 0.05,
        communityCase: { delayDays: 2 },
      },
    });
  }

  it("la norma que prohíbe da credit.usury_ruled; la libre, no", () => {
    const kinds = (variants: Record<string, number>) => {
      const life = build(variants);
      life.advanceTo((life.now + 6 * life.world.clock.day) as Tick);
      return life.world.log.all().map((e) => e.kind);
    };
    expect(kinds({ forbidden: 1 })).toContain("credit.usury_ruled");
    expect(kinds({ free: 1 })).not.toContain("credit.usury_ruled");
  }, 240_000);

  it("sin las opciones nuevas, Life.create da el mismo hash que con {} explícito", () => {
    const a = Life.create(1, content);
    const b = Life.create(1, content, {});
    expect(a.hash()).toEqual(b.hash());
    expect(a.world.log.all().some((e) => e.kind.startsWith("credit."))).toBe(false);
  }, 120_000);
});
