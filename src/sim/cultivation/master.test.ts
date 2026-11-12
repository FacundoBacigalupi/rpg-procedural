import { describe, expect, it } from "vitest";
import {
  discipleWorth,
  GUIDE_GAIN_PER_STAGE,
  GUIDE_MAX_GAP,
  GUIDE_PREP_PER_STAGE,
  MAX_DISCIPLES,
  type MasterAsk,
  masterAccepts,
  masterGuide,
  NO_GUIDE,
} from "./master.ts";

const ask = (over: Partial<MasterAsk> = {}): MasterAsk => ({
  sameOrg: true,
  rank: "inner",
  hasMaster: false,
  talent: 0.6,
  stage: 2,
  points: 50,
  regard: 0.3,
  disciples: 0,
  ...over,
});

describe("la guía del maestro (novel2-master-guide)", () => {
  it("guía el que está y le lleva tramos, con tope; si no, nada", () => {
    expect(masterGuide({ present: false, masterStage: 4, discipleStage: 0 })).toEqual(NO_GUIDE);
    expect(masterGuide({ present: true, masterStage: 1, discipleStage: 1 })).toEqual(NO_GUIDE);
    const one = masterGuide({ present: true, masterStage: 2, discipleStage: 1 });
    const far = masterGuide({ present: true, masterStage: 9, discipleStage: 0 });
    expect(one).toEqual({ gain: 1 + GUIDE_GAIN_PER_STAGE, prep: GUIDE_PREP_PER_STAGE });
    expect(far).toEqual(
      masterGuide({ present: true, masterStage: GUIDE_MAX_GAP, discipleStage: 0 }),
    );
    expect(far.gain).toBeGreaterThan(one.gain);
  });
});

describe("masterAccepts (novel2-master-bond)", () => {
  it("toma a uno de su secta que vale lo suficiente", () => {
    expect(masterAccepts(ask())).toMatchObject({ kind: "accepted" });
  });
  it("niega por orden: otra secta, ya tiene maestro, no hay lugar, rencor", () => {
    expect(masterAccepts(ask({ sameOrg: false, hasMaster: true }))).toEqual({
      kind: "refused",
      refused: "not_member",
    });
    expect(masterAccepts(ask({ hasMaster: true, disciples: MAX_DISCIPLES }))).toMatchObject({
      refused: "has_master",
    });
    expect(masterAccepts(ask({ disciples: MAX_DISCIPLES, regard: -1 }))).toMatchObject({
      refused: "full",
    });
    expect(masterAccepts(ask({ regard: -0.5 }))).toMatchObject({ refused: "grudge" });
  });
  it("sin talento medido ni aporte, no alcanza; con más discípulos es más exigente", () => {
    const { talent: _, ...untested } = ask({ stage: 0, points: 0, regard: 0 });
    expect(masterAccepts(untested)).toMatchObject({ refused: "unworthy" });
    const middling = ask({ talent: 0.5, stage: 1, points: 30, regard: 0.2 });
    expect(masterAccepts(middling).kind).toBe("accepted");
    expect(masterAccepts({ ...middling, disciples: 2 })).toMatchObject({ refused: "unworthy" });
  });
  it("un externo vale menos que un interno igual", () => {
    expect(discipleWorth(ask({ rank: "outer" }))).toBeLessThan(discipleWorth(ask()));
  });
});
