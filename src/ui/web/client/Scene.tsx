// El fondo de la pantalla: el entorno del personaje, borroso, para estar ahí sin distraer. Sale de
// las bandas de `Hud` (momento del día, cielo, adentro o afuera, aldea, bosque, gente que ve) y de
// nada más: si el personaje no ve a nadie, no hay figuras; si está bajo techo, se ve la pieza. Los
// colores de la interfaz (`themeOf`) siguen la misma luz: claros si hay luz, oscuros si no.

import type { CSSProperties } from "react";
import type { Hud } from "../api.ts";

interface Sky {
  readonly top: string;
  readonly bottom: string;
  readonly ground: string;
  readonly far: string;
  readonly glow: string | null;
}

function skyOf(hud: Hud): Sky {
  const grey = hud.sky === "overcast" || hud.sky === "rain" || hud.sky === "snow";
  switch (hud.phase) {
    case "night":
      return {
        top: "#060a1c",
        bottom: "#1a2140",
        ground: "#0b0f17",
        far: "#121828",
        glow: grey ? null : "#cfd8ff",
      };
    case "dawn":
      return grey
        ? { top: "#5d6573", bottom: "#b9a59a", ground: "#3b3a33", far: "#585b5e", glow: null }
        : { top: "#5a6db0", bottom: "#f7c08a", ground: "#4a4630", far: "#6d6a7a", glow: "#ffd9a0" };
    case "dusk":
      return grey
        ? { top: "#3c4250", bottom: "#8d7d78", ground: "#2a2a26", far: "#45474d", glow: null }
        : { top: "#2e3168", bottom: "#ef8f5c", ground: "#33301f", far: "#4f4660", glow: "#ffb070" };
    default:
      if (hud.sky === "snow")
        return { top: "#a9b2ba", bottom: "#e6eaee", ground: "#e9eef2", far: "#b8c0c7", glow: null };
      if (grey)
        return { top: "#7f8a94", bottom: "#c4cbd1", ground: "#5d6a4c", far: "#8d979e", glow: null };
      if (hud.sky === "cloudy")
        return {
          top: "#7fb0d9",
          bottom: "#d9e7f0",
          ground: "#6f8a4a",
          far: "#93a9b8",
          glow: "#fff6d8",
        };
      return {
        top: "#4f9fe3",
        bottom: "#cde9fa",
        ground: "#6f9447",
        far: "#8fb3cc",
        glow: "#fff4c2",
      };
  }
}

/** Las variables de color de la interfaz para la luz de ahora. */
export function themeOf(hud: Hud | undefined): CSSProperties {
  if (!hud) return {};
  const lit = hud.light === "bright";
  const sky = skyOf(hud);
  const warmIndoor = hud.place.indoor;
  const vars: Record<string, string> = lit
    ? {
        "--fg": "#1c232b",
        "--muted": "#4d5864",
        "--panel": "rgba(255, 255, 255, 0.62)",
        "--glass": "rgba(255, 255, 255, 0.45)",
        "--line": "rgba(30, 40, 50, 0.18)",
        "--accent": warmIndoor ? "#8a4b17" : "#1d5f9e",
        "--shade": sky.bottom,
      }
    : {
        "--fg": "#ece6da",
        "--muted": "#a9a294",
        "--panel": "rgba(14, 14, 20, 0.62)",
        "--glass": "rgba(10, 10, 16, 0.42)",
        "--line": "rgba(255, 255, 255, 0.12)",
        "--accent": warmIndoor ? "#e2a35b" : "#9fb8ff",
        "--shade": sky.top,
      };
  return vars as CSSProperties;
}

/** Posiciones fijas para las figuras: siempre las mismas para la misma cantidad. */
const SPOTS = [
  [0.3, 0.98],
  [0.62, 0.92],
  [0.46, 1.05],
  [0.78, 1.0],
  [0.18, 0.9],
  [0.88, 0.94],
] as const;

function Figure({ x, scale, fill }: { x: number; scale: number; fill: string }) {
  return (
    <g transform={`translate(${x * 1600} 860) scale(${scale})`} fill={fill}>
      <circle cx="0" cy="-232" r="34" />
      <path d="M-58 0 C-62 -90 -56 -160 -40 -180 Q0 -200 40 -180 C56 -160 62 -90 58 0 Z" />
    </g>
  );
}

function Houses({ fill, lit }: { fill: string; lit: boolean }) {
  const houses = [
    [80, 260, 170],
    [380, 200, 140],
    [640, 280, 190],
    [1010, 220, 150],
    [1300, 260, 175],
  ] as const;
  return (
    <g fill={fill}>
      {houses.map(([x, w, h]) => (
        <g key={x}>
          <rect x={x} y={700 - h} width={w} height={h} />
          <path d={`M${x - 20} ${700 - h} L${x + w / 2} ${640 - h} L${x + w + 20} ${700 - h} Z`} />
          {lit && (
            <rect
              x={x + w * 0.4}
              y={700 - h * 0.6}
              width={w * 0.18}
              height={h * 0.25}
              fill="#ffcf7a"
              opacity="0.8"
            />
          )}
        </g>
      ))}
    </g>
  );
}

function Trees({ fill }: { fill: string }) {
  const xs = [40, 190, 330, 520, 700, 860, 1040, 1210, 1380, 1530];
  return (
    <g fill={fill}>
      {xs.map((x, i) => (
        <path key={x} d={`M${x} 720 L${x + 70} ${430 - (i % 3) * 60} L${x + 140} 720 Z`} />
      ))}
    </g>
  );
}

function Room({ hud }: { hud: Hud }) {
  const dark = hud.light !== "bright";
  const wall = dark ? "#2a1d16" : "#8b6b4f";
  const floor = dark ? "#1a120d" : "#5e4634";
  const sky = skyOf(hud);
  return (
    <>
      <rect width="1600" height="900" fill={wall} />
      <rect y="640" width="1600" height="260" fill={floor} />
      <rect
        x="1080"
        y="180"
        width="260"
        height="220"
        fill={hud.sky === "unknown" ? sky.bottom : sky.top}
        opacity="0.85"
      />
      <rect x="1080" y="180" width="260" height="220" fill="none" stroke={floor} strokeWidth="18" />
      {/* El fuego del hogar: lo único que alumbra de noche. */}
      <ellipse cx="300" cy="640" rx="260" ry="200" fill="#ff9a3c" opacity={dark ? 0.32 : 0.12} />
      <ellipse cx="300" cy="660" rx="90" ry="60" fill="#ffd27a" opacity={dark ? 0.5 : 0.2} />
    </>
  );
}

export function Scene({ hud }: { hud: Hud | undefined }) {
  if (!hud) return <div className="scene" />;
  const sky = skyOf(hud);
  const indoor = hud.place.indoor;
  const lit = hud.light === "bright";
  const village = hud.place.kinds.includes("village") || hud.place.space !== "open";
  const forest = hud.place.kinds.includes("forest");
  const water = hud.place.kinds.includes("water");
  const people = Math.min(SPOTS.length, hud.people.around);
  const figureFill = indoor ? (lit ? "#3b2a20" : "#0d0907") : lit ? "#2c3440" : "#05070d";
  return (
    <div className="scene" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <title>Entorno</title>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky.top} />
            <stop offset="1" stopColor={sky.bottom} />
          </linearGradient>
        </defs>
        {indoor ? (
          <Room hud={hud} />
        ) : (
          <>
            <rect width="1600" height="900" fill="url(#sky)" />
            {sky.glow && (
              <circle
                cx={hud.phase === "dusk" ? 1300 : hud.phase === "dawn" ? 260 : 1180}
                cy={hud.phase === "day" ? 170 : 470}
                r={hud.phase === "night" ? 50 : 110}
                fill={sky.glow}
              />
            )}
            <path d="M0 620 Q300 520 620 600 T1200 570 T1600 600 V900 H0 Z" fill={sky.far} />
            {forest && <Trees fill={lit ? "#3d5a2e" : "#0a120c"} />}
            {village && <Houses fill={lit ? "#6b5644" : "#0c0d12"} lit={!lit} />}
            <rect
              y="700"
              width="1600"
              height="200"
              fill={water ? (lit ? "#4f86a8" : "#0c1a2a") : sky.ground}
            />
          </>
        )}
        {SPOTS.slice(0, people).map(([x, s], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: las figuras son anónimas, por posición
          <Figure key={i} x={x} scale={s} fill={figureFill} />
        ))}
      </svg>
      {hud.sky === "rain" && <div className="weather rain" />}
      {hud.sky === "snow" && <div className="weather snow" />}
    </div>
  );
}
