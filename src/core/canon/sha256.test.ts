import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./index.ts";

const reference = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");

describe("sha256Hex", () => {
  it("coincide con los vectores conocidos", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.each([55, 56, 63, 64, 65, 119, 120, 128, 1000])("en el borde de bloque: %i bytes", (n) => {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    expect(sha256Hex(bytes)).toBe(reference(bytes));
  });

  it("coincide con node:crypto en texto y bytes cualesquiera", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (s) => {
        expect(sha256Hex(s)).toBe(reference(s));
      }),
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (b) => {
        expect(sha256Hex(b)).toBe(reference(b));
      }),
    );
  });
});
