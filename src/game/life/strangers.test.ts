import { describe, expect, it } from "vitest";
import type { Tick } from "../../core/index.ts";
import {
  rememberStranger,
  STRANGER_CAPACITY,
  type Strangers,
  strangersSeenBefore,
} from "./strangers.ts";

const DAY = 86_400;
const t = (n: number) => n as Tick;
const seen = (hex: number, figure = "male:adult") => ({ hex, figure, confidence: 0.6 });

describe("extraños como impresiones", () => {
  it("el mismo extraño el mismo día se refuerza en una sola impresión", () => {
    let s: Strangers | undefined;
    s = rememberStranger(s, seen(3), t(100), DAY);
    s = rememberStranger(s, seen(3), t(200), DAY);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]?.times).toBe(2);
    expect(s.items[0]?.salience).toBeGreaterThan(0.5);
  });

  it("al día siguiente se lo reconoce como el desconocido de ayer", () => {
    const s = rememberStranger(undefined, seen(3), t(100), DAY);
    expect(strangersSeenBefore(s, "male:adult", t(100), DAY)).toHaveLength(0);
    expect(strangersSeenBefore(s, "male:adult", t(DAY + 100), DAY)).toHaveLength(1);
    expect(strangersSeenBefore(s, "female:adult", t(DAY + 100), DAY)).toHaveLength(0);
  });

  it("con el tiempo se olvidan y la capacidad saca primero lo que menos pesa", () => {
    let s: Strangers | undefined;
    for (let h = 0; h < STRANGER_CAPACITY + 5; h++)
      s = rememberStranger(s, seen(h), t(100 + h), DAY);
    expect(s?.items).toHaveLength(STRANGER_CAPACITY);
    expect(strangersSeenBefore(s, "male:adult", t(60 * DAY), DAY)).toHaveLength(0);
  });
});
