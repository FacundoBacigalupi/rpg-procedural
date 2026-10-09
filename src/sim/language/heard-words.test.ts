import { describe, expect, it } from "vitest";
import { KEPT_HEARD_WORDS, learnHeardWords } from "./heard-words.ts";

describe("palabras de forma oídas", () => {
  it("suma sin repetir y no cambia si no hay nada nuevo", () => {
    const a = learnHeardWords(undefined, ["kel", "mor", "kel"]);
    expect(a?.words).toEqual(["kel", "mor"]);
    expect(learnHeardWords(a, ["mor"])).toBeUndefined();
    expect(learnHeardWords(a, ["tu"])?.words).toEqual(["kel", "mor", "tu"]);
  });

  it("olvida las más viejas", () => {
    const many = Array.from({ length: KEPT_HEARD_WORDS + 3 }, (_, i) => `w${i}`);
    const r = learnHeardWords(undefined, many);
    expect(r?.words).toHaveLength(KEPT_HEARD_WORDS);
    expect(r?.words[0]).toBe("w3");
  });
});
