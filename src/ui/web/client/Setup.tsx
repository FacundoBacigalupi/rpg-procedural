// La pantalla de inicio de una vida nueva: familia del mundo, modo, seed y, en modo novela, el
// personaje. Solo arma la elección; el servidor la valida y genera el mundo.

import { type FormEvent, useState } from "react";
import type { SetupChoice, SetupInfo } from "../api.ts";

const FAMILY_LABEL: Readonly<Record<string, string>> = {
  xianxia: "Xianxia: cultivo, sectas y el Cielo",
};
const MODE_LABEL: Readonly<Record<string, string>> = {
  realista: "Realista: naces donde toque, como cualquiera",
  novela: "Novela: elegís algo del personaje",
};

export function Setup({ info, onStarted }: { info: SetupInfo; onStarted: () => void }) {
  const [world, setWorld] = useState(info.defaults.world);
  const [mode, setMode] = useState(info.defaults.mode);
  const [seed, setSeed] = useState(
    info.defaults.seed === undefined ? "" : String(info.defaults.seed),
  );
  const [sex, setSex] = useState("");
  const [familia, setFamilia] = useState("");
  const [age, setAge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const novel = mode === "novela";
    const choice: SetupChoice = {
      world,
      mode,
      ...(seed.trim() !== "" ? { seed: Number(seed) } : {}),
      ...(novel && sex !== "" ? { sex: sex as NonNullable<SetupChoice["sex"]> } : {}),
      ...(novel && familia !== ""
        ? { familia: familia as NonNullable<SetupChoice["familia"]> }
        : {}),
      ...(novel && age.trim() !== "" ? { age: Number(age) } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(choice),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="setup">
      <form onSubmit={submit}>
        <h1>Una vida nueva</h1>
        <fieldset disabled={busy}>
          <legend>Mundo</legend>
          {info.families.map((f) => (
            <label key={f} className="choice">
              <input
                type="radio"
                name="world"
                value={f}
                checked={world === f}
                onChange={() => setWorld(f)}
              />
              {FAMILY_LABEL[f] ?? f}
            </label>
          ))}
          <p className="hint">Las demás familias llegan cuando tengan su contenido.</p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Modo</legend>
          {info.modes.map((m) => (
            <label key={m} className="choice">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {MODE_LABEL[m] ?? m}
            </label>
          ))}
        </fieldset>
        {mode === "novela" && (
          <fieldset disabled={busy}>
            <legend>Personaje</legend>
            <label>
              Sexo
              <select value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Cualquiera</option>
                {info.sexes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Familia
              <select value={familia} onChange={(e) => setFamilia(e.target.value)}>
                <option value="">Cualquiera</option>
                {info.familias.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Edad al empezar
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="desde la infancia"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </label>
          </fieldset>
        )}
        <fieldset disabled={busy}>
          <legend>Seed</legend>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="al azar"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </fieldset>
        {error !== null && (
          <p className="error">
            {error}
            {mode === "novela" && ". Probá con otra seed o con menos condiciones."}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Generando el mundo…" : "Empezar"}
        </button>
      </form>
    </main>
  );
}
