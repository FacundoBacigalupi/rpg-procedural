import { describe, expect, it } from "vitest";
import { FULL_PROFILE, GAME_CONTENT_KINDS, Life } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { DEMOGRAPHY } from "../../sim/index.ts";
import { profileCoverage } from "./full-profile.ts";

// Auditoría perfil2-directed-coverage (solo medición, sin tocar la sim): las oportunidades que el perfil
// por defecto ofrece al abrir la vida. Mide que "cero concepciones en 270 días" es esperable con la curva
// normal (no un defecto), y que viaje y dormidos no existen al inicio: dependen de los escenarios dirigidos
// (journey/sleep-coverage) o de `errands`/`sleepers` durante la corrida.
describe("auditoría de cobertura dirigida del perfil por defecto (perfil2-directed-coverage)", () => {
  const content = loadContentDir("content", GAME_CONTENT_KINDS);
  const demography = content.get(DEMOGRAPHY, "human.preindustrial-village");
  if (!demography) throw new Error("sin demografía");

  it.each([1, 2, 3])(
    "seed %i: hay parejas elegibles, la concepción esperada es baja pero positiva y no hay viaje ni sueño iniciales",
    (seed) => {
      const life = Life.create(seed, content, FULL_PROFILE);
      const snap = profileCoverage(
        life.world.truth,
        life.now,
        life.world.clock,
        demography.fertility,
      );
      expect(snap.conceptionEligibleCouples).toBeGreaterThan(0);
      expect(snap.conceptionEligibleCouples).toBeLessThanOrEqual(snap.fertileCouples);
      const perYear = snap.fertileCouplesByAge.reduce(
        (sum, entry) => sum + entry.couples * entry.annualRate,
        0,
      );
      expect(perYear).toBeGreaterThan(1);
      expect(perYear).toBeLessThan(3);
      // Poisson: probabilidad de cero concepciones en 270 días (~0,25-0,30 en estas seeds).
      const pZero270 = Math.exp((-perYear * 270) / 365);
      expect(pZero270).toBeGreaterThan(0.1);
      expect(snap.activePregnancies).toBe(0);
      expect(snap.npcJourneys).toBe(0);
      expect(snap.asleepPeople).toBe(0);
    },
    120_000,
  );
});
