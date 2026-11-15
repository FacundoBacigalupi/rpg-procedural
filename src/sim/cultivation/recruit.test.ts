import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import {
  afterPoached,
  chooseOffer,
  offeredRank,
  POACH_RESENTMENT,
  RECRUIT_INNER_QUALITY,
} from "./recruit.ts";

const tie: OrgTie = {
  formal: ["rival"],
  sentiment: { trust: 0.3, respect: 0.4, fear: 0.2, resentment: 0.2 },
  believedStrength: { elders: 2, disciples: 10, topStage: 3 },
  grievances: [],
  originEventId: "event:1" as EventId,
  history: [],
};

describe("la competencia por discípulos (novel4-recruit-choice)", () => {
  it("la segunda ofrece interno a los de raíz alta que ya citó la otra", () => {
    const high = { elements: ["fire"], quality: RECRUIT_INNER_QUALITY };
    const low = { elements: ["fire"], quality: RECRUIT_INNER_QUALITY - 0.01 };
    expect(offeredRank(high, true)).toBe("inner");
    expect(offeredRank(low, true)).toBe("outer");
    expect(offeredRank(high, false)).toBe("outer");
  });

  it("elige el mejor rango, después la más cerca, y si no se queda", () => {
    expect(chooseOffer({ rank: "outer", days: 2 }, { rank: "inner", days: 9 })).toBe("switch");
    expect(chooseOffer({ rank: "inner", days: 9 }, { rank: "outer", days: 1 })).toBe("stay");
    expect(chooseOffer({ rank: "outer", days: 5 }, { rank: "outer", days: 3 })).toBe("switch");
    expect(chooseOffer({ rank: "outer", days: 3 }, { rank: "outer", days: 3 })).toBe("stay");
  });

  it("la que lo pierde guarda la ofensa una vez", () => {
    const ev = "event:7" as EventId;
    const once = afterPoached(tie, ev);
    expect(once.sentiment.resentment).toBeCloseTo(0.2 + POACH_RESENTMENT);
    expect(once.grievances).toEqual([ev]);
    expect(once.history).toEqual([ev]);
    expect(afterPoached(once, ev)).toBe(once);
  });
});
