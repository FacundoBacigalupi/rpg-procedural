import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import type { ProcessDef } from "../../sim/index.ts";
import { ECONOMIC_SERIAL_DOMAIN } from "./economic-batch.ts";
import { lendProcess, repayDoseProcess } from "./lend.ts";
import { pawnDecideProcess } from "./pawndecide.ts";
import { rentsProcess } from "./rents.ts";

// Auditoría de descriptores (perfil2-trades-cross-process): qué procesos de `act` que asientan
// en el ledger comparten el dominio económico y cuáles siguen fuera. Medición, no certificación:
// un proceso fuera del dominio no ve las reservas de los demás dentro de la misma ventana.
const none = {} as never;
const gaps: readonly (readonly [string, () => ProcessDef])[] = [
  ["life.lend", () => lendProcess(none)],
  ["life.repay_dose", () => repayDoseProcess({ goods: [], substances: [] } as never)],
  [
    "life.pawn_decide",
    () =>
      pawnDecideProcess({
        goods: [],
        day: 86400,
        player: "agent:1" as AgentId,
        placeOf: () => none,
      }),
  ],
  ["life.rents", () => rentsProcess({ goods: [] } as never)],
];

describe("auditoría: procesos de act con ledger fuera del dominio económico", () => {
  it.each(gaps)("%s sigue sin serialDomain (hueco conocido)", (id, make) => {
    const p = make();
    expect(p.id).toBe(id);
    expect(p.phase).toBe("act");
    expect(p.serialDomain).not.toBe(ECONOMIC_SERIAL_DOMAIN);
    expect(p.serialGroup).toBeUndefined();
  });
});
