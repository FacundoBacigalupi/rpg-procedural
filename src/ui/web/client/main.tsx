import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SetupInfo } from "../api.ts";
import { App } from "./App.tsx";
import { Setup } from "./Setup.tsx";
import "./style.css";

/** Con vida, el juego; sin vida en el guardado, la pantalla de inicio. */
function Root() {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/setup")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        setInfo((await res.json()) as SetupInfo);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);
  if (error !== null) return <p className="error">No se pudo abrir la vida: {error}</p>;
  if (info === null) return null;
  if (info.started === true) return <App />;
  return <Setup info={info} onStarted={() => setInfo({ ...info, started: true })} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Root />);
