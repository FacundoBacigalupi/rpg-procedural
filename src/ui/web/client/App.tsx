// La pantalla del juego: el chat con la narración a la izquierda y, a la derecha, los paneles del
// personaje, el inventario y la bitácora. Todo el texto lo arma el servidor desde la `PlayerView`;
// acá no se interpreta nada del mundo.

import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { History, Panels, SayResponse, WebState } from "../api.ts";
import { Scene, themeOf } from "./Scene.tsx";
import { TopBar } from "./TopBar.tsx";

interface Line {
  readonly who: "you" | "world";
  readonly text: string;
  /** De la narración guardada: cuándo fue y su lugar en la bitácora. */
  readonly when?: string;
  readonly seq?: number;
  /** Cómo nombra el texto a las personas que el personaje tiene delante. */
  readonly people?: readonly string[];
}

/** «Un viejo» → «el viejo»: cómo se lo nombra para hablarle. */
function addressed(words: string): string {
  const lower = words.charAt(0).toLowerCase() + words.slice(1);
  return lower.replace(/^una /u, "la ").replace(/^un /u, "el ");
}

/** El texto con las personas presentes pintadas; un clic en una escribe «hablo con …». */
function Narration(props: {
  text: string;
  people: readonly string[];
  onPick(words: string): void;
}) {
  const names = [...props.people].filter((n) => n !== "").sort((a, b) => b.length - a.length);
  if (names.length === 0) return <>{props.text}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = props.text.split(new RegExp(`(${escaped.join("|")})`, "u"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: partes fijas de un texto que no cambia
            key={i}
            type="button"
            className="person"
            title={`Hablar con ${addressed(part)}`}
            onClick={() => props.onPick(addressed(part))}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}

const fromHistory = (h: History): Line[] =>
  h.entries.map((e) => ({ who: "world", text: e.text, when: e.when, seq: e.seq }));

const TABS = [
  ["character", "Personaje"],
  ["inventory", "Inventario"],
  ["book", "Deudas"],
  ["people", "Gente"],
  ["hypotheses", "Hipótesis"],
  ["weather", "Cielo"],
  ["recap", "Recuento"],
  ["environment", "Entorno"],
  ["journal", "Bitácora"],
] as const;

/** Ancho de la columna de paneles: lo elige el jugador arrastrando el borde y queda en el navegador. */
const ASIDE_KEY = "aside-width";
const ASIDE_MIN = 240;
const ASIDE_MAX = 900;
const clampAside = (px: number) =>
  Math.round(Math.min(Math.max(px, ASIDE_MIN), Math.min(ASIDE_MAX, window.innerWidth - 320)));

function savedAside(): number {
  try {
    const n = Number(localStorage.getItem(ASIDE_KEY));
    return Number.isFinite(n) && n > 0 ? clampAside(n) : 360;
  } catch {
    return 360;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

export function App() {
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [panels, setPanels] = useState<Panels | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("character");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [more, setMore] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Al subir se piden entradas más viejas: se recuerda la altura para que la vista no salte.
  const prepended = useRef<number | null>(null);
  const loading = useRef(false);
  const [aside, setAside] = useState(savedAside);

  function dragAside(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setAside(clampAside(window.innerWidth - ev.clientX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setAside((w) => {
        try {
          localStorage.setItem(ASIDE_KEY, String(w));
        } catch {
          // sin almacenamiento el ancho dura lo que la página
        }
        return w;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  useEffect(() => {
    call<WebState>("/api/state")
      .then((s) => {
        const past = fromHistory(s.history);
        // La última narración guardada es la escena de ahora: lleva a quienes nombra la apertura.
        const last = past[past.length - 1];
        setLines(
          last
            ? [...past.slice(0, -1), { ...last, people: s.openingPeople }]
            : [{ who: "world", text: s.opening, people: s.openingPeople }],
        );
        setMore(s.history.more);
        setPanels(s);
      })
      .catch((e: unknown) => setLines([{ who: "world", text: `No se pudo abrir la vida: ${e}` }]));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reacciona a las líneas, no a las refs
  useLayoutEffect(() => {
    const el = box.current;
    if (prepended.current !== null && el) {
      el.scrollTop = el.scrollHeight - prepended.current;
      prepended.current = null;
    } else {
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [lines]);

  async function loadOlder() {
    const el = box.current;
    const oldest = lines.find((l) => l.seq !== undefined)?.seq;
    if (!el || !more || loading.current || oldest === undefined) return;
    loading.current = true;
    try {
      const h = await call<History>(`/api/history?before=${oldest}`);
      prepended.current = el.scrollHeight;
      setLines((l) => [...fromHistory(h), ...l]);
      setMore(h.more);
    } catch {
      // sin red local no hay más historia: se reintenta al volver a subir
    } finally {
      loading.current = false;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const line = input.trim();
    if (line === "") return;
    setInput("");
    await play("/api/say", { line }, line);
  }

  async function play(path: string, body: unknown, shown: string) {
    if (busy || over) return;
    setBusy(true);
    setLines((l) => [...l, { who: "you", text: shown }]);
    try {
      const r = await call<SayResponse>(path, body);
      setLines((l) => [...l, { who: "world", text: r.text, people: r.present }]);
      setPanels(r);
      if (r.end !== null) setOver(true);
    } catch (err) {
      setLines((l) => [...l, { who: "world", text: `Error: ${err}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`layout phase-${panels?.hud.phase ?? "day"}`}
      style={{ ...themeOf(panels?.hud), gridTemplateColumns: `minmax(0, 1fr) 6px ${aside}px` }}
    >
      <Scene hud={panels?.hud} />
      <main className="chat">
        <TopBar hud={panels?.hud} now={panels?.now ?? "…"} />
        <div
          className="lines"
          ref={box}
          onScroll={(e) => {
            if (e.currentTarget.scrollTop < 80) void loadOlder();
          }}
        >
          {more && <p className="older">…</p>}
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: las líneas nuevas van al final y las viejas al principio, sin reordenar
            <p key={l.seq ?? `n${i}`} className={l.who}>
              {l.when && <span className="when">{`— ${l.when}\n`}</span>}
              <Narration
                text={l.text}
                people={l.people ?? []}
                onPick={(who) => {
                  setInput(`hablo con ${who}`);
                  field.current?.focus();
                }}
              />
            </p>
          ))}
          <div ref={bottom} />
        </div>
        {!over && panels && panels.options.length > 0 && (
          <div className="options">
            {panels.options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                className={`tone-${o.tone}`}
                title={o.toneLabel}
                aria-label={`${o.label} (${o.toneLabel})`}
                onClick={() => {
                  if (
                    o.confirm &&
                    !window.confirm(`${o.label}
(${o.toneLabel}). ¿Seguro?`)
                  )
                    return;
                  play("/api/choose", { id: o.id }, o.label);
                }}
              >
                <span className={`icon icon-${o.icon}`} aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit}>
          <input
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={over ? "La vida terminó." : "¿Qué hace tu personaje? (ayuda)"}
            disabled={busy || over}
          />
          <button type="submit" disabled={busy || over || input.trim() === ""}>
            {busy ? "…" : "Enviar"}
          </button>
        </form>
      </main>
      {/* biome-ignore lint/a11y/useSemanticElements: un <hr> no toma foco ni arrastre; es un separador movible */}
      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ancho de los paneles"
        aria-valuenow={aside}
        aria-valuemin={ASIDE_MIN}
        aria-valuemax={ASIDE_MAX}
        tabIndex={0}
        onPointerDown={dragAside}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setAside((w) => clampAside(w + 24));
          if (e.key === "ArrowRight") setAside((w) => clampAside(w - 24));
        }}
      />
      <aside>
        <nav>
          {TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </nav>
        <pre>{panels ? panels[tab] : ""}</pre>
      </aside>
    </div>
  );
}
