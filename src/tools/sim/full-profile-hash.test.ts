import { describe, expect, it } from "vitest";
import { runFullProfileSeed } from "./full-profile-run.ts";

// Vida real con FULL_PROFILE (crear una Life tarda ~40 s): perfil de 2 días, un chequeo.
const config = { seeds: [1], days: 2, years: 1, checkEveryDays: 2 };

function hashOf(seed: number) {
  const report = runFullProfileSeed(seed, config);
  if (!("stateHash" in report)) throw new Error(`corrida fallida: ${JSON.stringify(report)}`);
  return report.stateHash;
}

describe("full-profile: StateHash final canónico", () => {
  it("mismo seed da el mismo hash; otro seed da otro", () => {
    const a = hashOf(1);
    const b = hashOf(1);
    const c = hashOf(2);
    expect(a.total).toMatch(/^[0-9a-f]{64}$/);
    expect(b.total).toBe(a.total);
    expect(b.parts).toEqual(a.parts);
    expect(b.tick).toBe(a.tick);
    expect(c.total).not.toBe(a.total);
  }, 600_000);
});
