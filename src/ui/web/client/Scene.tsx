// El fondo de la pantalla: el entorno del personaje, borroso, para estar ahí sin distraer. Sale de
// las bandas de `Hud` (momento del día, cielo, adentro o afuera, aldea, bosque, gente que ve) y de
// nada más: si el personaje no ve a nadie, no hay figuras; si está bajo techo, se ve la pieza. Los
// colores de la interfaz (`themeOf`) siguen la misma luz: claros si hay luz, oscuros si no.
//
// Todo se pinta con los colores de día (varios tonos por cosa: piel, pelo, ropa, paredes, techos) y
// encima va una capa de luz según la hora y el cielo; lo que alumbra (ventanas, el fuego del hogar)
// se pinta después de esa capa para que brille.

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

/** La capa de luz sobre la escena pintada de día: color y cuánto tapa. */
function shadeOf(hud: Hud): { color: string; opacity: number } {
  const grey = hud.sky === "overcast" || hud.sky === "rain" || hud.sky === "snow";
  if (hud.place.indoor) {
    if (hud.light === "dark") return { color: "#05030a", opacity: 0.72 };
    if (hud.light === "dim") return { color: "#0d0812", opacity: 0.45 };
    return { color: "#000", opacity: grey ? 0.12 : 0 };
  }
  switch (hud.phase) {
    case "night":
      return { color: "#040818", opacity: 0.74 };
    case "dawn":
      return { color: "#3a2a4a", opacity: 0.3 };
    case "dusk":
      return { color: "#3a1c2a", opacity: 0.38 };
    default:
      return { color: "#4a5560", opacity: grey ? 0.2 : 0 };
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

// ---------------------------------------------------------------------------------------------
// Gente

/** Posiciones fijas para las figuras: siempre las mismas para la misma cantidad. */
const SPOTS = [
  [0.3, 0.98],
  [0.62, 0.92],
  [0.46, 1.05],
  [0.78, 1.0],
  [0.18, 0.9],
  [0.88, 0.94],
] as const;

/** Tonos de ropa de aldea (tintes vegetales, lino, cáñamo) y de piel y pelo. */
const ROBES = ["#6d4c3d", "#4f6b5a", "#8a6a3f", "#5a5f7a", "#7d5a6a", "#a08a68"] as const;
const SASHES = ["#b5763c", "#3f4e63", "#8c3b30", "#c9b27a", "#3e5b45", "#5d3f52"] as const;
const SKINS = ["#c99a72", "#b88760", "#d8ad85", "#a8774f", "#c08d66", "#d2a079"] as const;
const HAIRS = ["#1e1712", "#2b211a", "#3a2c22", "#151110", "#5a5048", "#2a1d17"] as const;

type Look = Hud["people"]["figures"][number];

/** Tamaño por edad: un niño llega a la cintura de un adulto. */
const AGE_SCALE: Record<NonNullable<Look["age"]>, number> = {
  child: 0.6,
  youth: 0.9,
  adult: 1,
  elder: 0.95,
};

/** La ropa según se lee: fina con colores vivos y ribete, gastada apagada y con remiendo. */
function robeOf(
  i: number,
  attire: string | undefined,
): { robe: string; trim?: string; patch?: boolean } {
  const robe = ROBES[i % ROBES.length] as string;
  if (attire === "fine") return { robe: FINE[i % FINE.length] as string, trim: "#d8b65a" };
  if (attire === "worn") return { robe: WORN[i % WORN.length] as string, patch: true };
  return { robe };
}

const FINE = ["#7a2f3a", "#2f4f7a", "#3f6b4a", "#6a3f7a"] as const;
const WORN = ["#6b6258", "#5c5a50", "#74685a", "#585248"] as const;

/**
 * Una persona vista, con lo que la mirada leyó de ella: tamaño y pelo por edad (canas en los
 * viejos, el niño con dos rodetes), el peinado por sexo y la ropa por su marca. De quien apenas
 * se nota no se sabe nada: queda una sombra sin rasgos.
 */
function Figure({
  i,
  x,
  scale,
  look,
}: {
  i: number;
  x: number;
  scale: number;
  look: Look | undefined;
}) {
  const shadow = look?.age === undefined && look?.sex === undefined;
  const { robe, trim, patch } = shadow ? { robe: "#1d1b22" } : robeOf(i, look?.attire);
  const sash = shadow ? robe : SASHES[(i * 2 + 1) % SASHES.length];
  const skin = shadow ? robe : SKINS[(i * 5 + 2) % SKINS.length];
  const elder = look?.age === "elder";
  const child = look?.age === "child";
  const female = look?.sex === "female";
  const hair = shadow ? robe : elder ? "#a9a49c" : HAIRS[(i * 3) % HAIRS.length];
  const lean = elder ? 7 : ((i % 3) - 1) * 4;
  const size = scale * (look?.age ? AGE_SCALE[look.age] : 1);
  return (
    <g
      transform={`translate(${x * 1600} 860) scale(${size}) rotate(${lean} 0 -120)`}
      opacity={shadow ? 0.55 : 1}
    >
      <ellipse cx="0" cy="4" rx="70" ry="12" fill="#000" opacity="0.18" />
      {/* Túnica larga que se abre abajo, con las mangas anchas. */}
      <path
        d="M-62 0 C-66 -70 -58 -150 -42 -182 Q0 -204 42 -182 C58 -150 66 -70 62 0 Z"
        fill={robe}
      />
      {trim && <path d="M-62 0 L62 0 L60 -10 L-60 -10 Z" fill={trim} />}
      {patch && <rect x="12" y="-60" width="22" height="18" rx="3" fill="#000" opacity="0.18" />}
      <path
        d="M-44 -176 C-80 -150 -84 -96 -70 -70 L-50 -74 C-56 -110 -50 -146 -36 -164 Z"
        fill={robe}
      />
      <path d="M44 -176 C80 -150 84 -96 70 -70 L50 -74 C56 -110 50 -146 36 -164 Z" fill={robe} />
      <circle cx="-62" cy="-70" r="11" fill={skin} />
      <circle cx="62" cy="-70" r="11" fill={skin} />
      <path d="M-14 -190 L0 -150 L14 -190 Z" fill={skin} opacity="0.9" />
      <rect x="-44" y="-112" width="88" height="14" rx="5" fill={sash} />
      <path
        d="M-40 -2 C-30 -60 -20 -120 -8 -176"
        stroke="#000"
        strokeOpacity="0.12"
        strokeWidth="6"
        fill="none"
      />
      <rect x="-9" y="-212" width="18" height="22" fill={skin} />
      {female && !child && (
        // Pelo largo que cae por la espalda.
        <path
          d="M-30 -240 C-40 -200 -36 -170 -26 -150 L26 -150 C36 -170 40 -200 30 -240 Z"
          fill={hair}
        />
      )}
      <ellipse cx="0" cy="-236" rx="30" ry="34" fill={skin} />
      <path d="M-31 -238 C-32 -276 32 -276 31 -238 C22 -258 -22 -258 -31 -238 Z" fill={hair} />
      {child ? (
        // Dos rodetes de niño.
        <>
          <circle cx="-22" cy="-266" r="10" fill={hair} />
          <circle cx="22" cy="-266" r="10" fill={hair} />
        </>
      ) : female ? (
        // Rodete bajo con una horquilla.
        <>
          <ellipse cx="0" cy="-262" rx="20" ry="12" fill={hair} />
          {!shadow && <rect x="-24" y="-265" width="48" height="3" fill="#c9b27a" />}
        </>
      ) : (
        // Moño arriba.
        <circle cx="0" cy="-272" r="13" fill={hair} />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Afuera

const HOUSES = [
  { x: 60, w: 260, h: 170, wall: "#c9b48f", roof: "#6b4a34" },
  { x: 380, w: 200, h: 140, wall: "#b9a37d", roof: "#7a5a3a" },
  { x: 640, w: 280, h: 190, wall: "#d2bf9b", roof: "#5e4a3e" },
  { x: 1010, w: 220, h: 150, wall: "#bfa889", roof: "#80603f" },
  { x: 1300, w: 260, h: 175, wall: "#c6b08a", roof: "#5a4335" },
] as const;

function Houses({ smoke }: { smoke: boolean }) {
  return (
    <g>
      {HOUSES.map(({ x, w, h, wall, roof }, i) => (
        <g key={x}>
          {/* Paredes de barro con zócalo de piedra, techo de paja con alero. */}
          <rect x={x} y={700 - h} width={w} height={h} fill={wall} />
          <rect x={x} y={680} width={w} height={20} fill="#8d8478" />
          <rect x={x} y={700 - h} width={w} height={h} fill="url(#wallShade)" />
          <path
            d={`M${x - 26} ${706 - h} L${x + w / 2} ${636 - h} L${x + w + 26} ${706 - h} Z`}
            fill={roof}
          />
          <path
            d={`M${x - 26} ${706 - h} L${x + w + 26} ${706 - h} L${x + w + 18} ${716 - h} L${x - 18} ${716 - h} Z`}
            fill="#000"
            opacity="0.2"
          />
          <rect
            x={x + w * 0.12}
            y={700 - h * 0.62}
            width={w * 0.2}
            height={h * 0.62}
            fill="#4a3526"
          />
          <rect
            x={x + w * 0.62}
            y={700 - h * 0.7}
            width={w * 0.17}
            height={h * 0.22}
            fill="#2a2420"
          />
          {i % 2 === 0 && (
            <rect x={x + w * 0.74} y={650 - h} width={w * 0.07} height={44} fill="#7d7166" />
          )}
          {smoke && i % 2 === 0 && (
            <g fill="#d8d8d8" opacity="0.35">
              <circle cx={x + w * 0.78} cy={600 - h} r="16" />
              <circle cx={x + w * 0.8} cy={565 - h} r="22" />
              <circle cx={x + w * 0.76} cy={520 - h} r="28" />
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

/** Las ventanas que alumbran de noche: van encima de la capa de luz. */
function LitWindows() {
  return (
    <g fill="#ffcf7a">
      {HOUSES.map(({ x, w, h }) => (
        <g key={x}>
          <rect
            x={x + w * 0.62}
            y={700 - h * 0.7}
            width={w * 0.17}
            height={h * 0.22}
            opacity="0.85"
          />
          <ellipse cx={x + w * 0.7} cy={700 - h * 0.6} rx={w * 0.3} ry={h * 0.35} opacity="0.12" />
        </g>
      ))}
    </g>
  );
}

const TREES = [40, 190, 330, 520, 700, 860, 1040, 1210, 1380, 1530] as const;

function Trees() {
  return (
    <g>
      {TREES.map((x, i) => {
        const top = 430 - (i % 3) * 60;
        const dark = i % 2 === 0 ? "#2f4a26" : "#3a5a2c";
        return (
          <g key={x}>
            <rect x={x + 62} y={top + 160} width="18" height={720 - top - 160} fill="#4a3424" />
            <ellipse cx={x + 70} cy={top + 170} rx="85" ry="70" fill={dark} />
            <ellipse cx={x + 50} cy={top + 110} rx="60" ry="55" fill="#4d7236" />
            <ellipse cx={x + 95} cy={top + 80} rx="50" ry="48" fill="#5d8540" />
            <ellipse cx={x + 70} cy={top + 30} rx="38" ry="36" fill="#6c9549" />
          </g>
        );
      })}
    </g>
  );
}

function Clouds({ dense }: { dense: boolean }) {
  const puffs = dense ? [120, 420, 760, 1080, 1400] : [260, 900];
  return (
    <g fill="#ffffff" opacity={dense ? 0.55 : 0.75}>
      {puffs.map((x, i) => (
        <g key={x}>
          <ellipse cx={x} cy={150 + (i % 2) * 70} rx="160" ry="46" />
          <ellipse cx={x + 70} cy={124 + (i % 2) * 70} rx="90" ry="50" />
          <ellipse cx={x - 60} cy={136 + (i % 2) * 70} rx="70" ry="38" />
        </g>
      ))}
    </g>
  );
}

function Outside({ hud, sky }: { hud: Hud; sky: Sky }) {
  const village = hud.place.kinds.includes("village") || hud.place.space !== "open";
  const forest = hud.place.kinds.includes("forest");
  const water = hud.place.kinds.includes("water");
  return (
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
      {(hud.sky === "cloudy" || hud.sky === "overcast" || hud.sky === "rain") && (
        <Clouds dense={hud.sky !== "cloudy"} />
      )}
      <path
        d="M0 600 Q260 470 560 560 T1120 520 T1600 560 V900 H0 Z"
        fill="#7d93a3"
        opacity="0.6"
      />
      <path d="M0 640 Q300 560 620 620 T1200 600 T1600 620 V900 H0 Z" fill="#6f8a64" />
      {forest && <Trees />}
      {village && (
        <Houses smoke={hud.air === "cold" || hud.air === "bitter" || hud.air === "cool"} />
      )}
      <rect y="700" width="1600" height="200" fill={water ? "#4f86a8" : "#7a8a4e"} />
      <rect y="700" width="1600" height="200" fill="url(#groundShade)" />
      {village && !water && (
        <path
          d="M560 900 C640 800 700 740 780 700 L860 700 C900 760 960 820 1080 900 Z"
          fill="#b39f7c"
          opacity="0.7"
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Adentro

function Room({ hud, sky }: { hud: Hud; sky: Sky }) {
  return (
    <>
      {/* Paredes de barro, piso de tierra apisonada, vigas de madera. */}
      <rect width="1600" height="900" fill="#a88a66" />
      <rect width="1600" height="900" fill="url(#wallShade)" />
      <rect y="640" width="1600" height="260" fill="#6e5440" />
      <rect y="630" width="1600" height="18" fill="#4e3a2b" />
      {[0, 400, 800, 1200].map((x) => (
        <rect key={x} x={x + 180} y="0" width="34" height="640" fill="#5b4330" />
      ))}
      <rect y="40" width="1600" height="30" fill="#4e3a2b" />
      {/* La ventana: el cielo de afuera, si se ve. */}
      <rect
        x="1080"
        y="180"
        width="260"
        height="220"
        fill={hud.sky === "unknown" ? sky.bottom : sky.top}
      />
      <rect
        x="1080"
        y="180"
        width="260"
        height="220"
        fill="none"
        stroke="#4e3a2b"
        strokeWidth="18"
      />
      <rect x="1203" y="180" width="14" height="220" fill="#4e3a2b" />
      {/* Estante con cuencos y vasijas, una mesa baja. */}
      <rect x="640" y="300" width="300" height="14" fill="#4e3a2b" />
      <ellipse cx="690" cy="290" rx="28" ry="14" fill="#9a6a45" />
      <path d="M760 300 C750 250 800 240 810 270 C820 240 860 250 850 300 Z" fill="#7a5a44" />
      <ellipse cx="900" cy="288" rx="22" ry="16" fill="#c2a27a" />
      <rect x="620" y="560" width="380" height="26" fill="#5b4330" />
      <rect x="650" y="586" width="20" height="70" fill="#4e3a2b" />
      <rect x="950" y="586" width="20" height="70" fill="#4e3a2b" />
      {/* El hogar: piedras con el fuego adentro (el fuego va sobre la capa de luz). */}
      <path d="M170 650 Q300 560 430 650 Z" fill="#6f6a64" />
      <ellipse cx="300" cy="652" rx="140" ry="22" fill="#5a5550" />
    </>
  );
}

function Hearth({ dark }: { dark: boolean }) {
  return (
    <g>
      <ellipse cx="300" cy="620" rx="320" ry="240" fill="#ff9a3c" opacity={dark ? 0.28 : 0.1} />
      <path
        d="M260 650 C250 610 280 590 290 560 C300 600 330 600 340 650 Z"
        fill="#ff8a2a"
        opacity="0.9"
      />
      <path d="M280 650 C276 620 296 610 300 590 C306 615 322 620 320 650 Z" fill="#ffd27a" />
    </g>
  );
}

export function Scene({ hud }: { hud: Hud | undefined }) {
  if (!hud) return <div className="scene" />;
  const sky = skyOf(hud);
  const indoor = hud.place.indoor;
  const shade = shadeOf(hud);
  const dark = hud.light !== "bright";
  const village = hud.place.kinds.includes("village") || hud.place.space !== "open";
  const people = Math.min(SPOTS.length, hud.people.around);
  return (
    <div className="scene" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <title>Entorno</title>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky.top} />
            <stop offset="1" stopColor={sky.bottom} />
          </linearGradient>
          <linearGradient id="wallShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.18" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="groundShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {indoor ? <Room hud={hud} sky={sky} /> : <Outside hud={hud} sky={sky} />}
        {SPOTS.slice(0, people).map(([x, s], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: las figuras son anónimas, por posición
          <Figure key={i} i={i} x={x} scale={s} look={hud.people.figures[i]} />
        ))}
        {shade.opacity > 0 && (
          <rect width="1600" height="900" fill={shade.color} opacity={shade.opacity} />
        )}
        {indoor && hud.place.fire !== false && <Hearth dark={dark} />}
        {!indoor && village && dark && <LitWindows />}
      </svg>
      {hud.sky === "rain" && <div className="weather rain" />}
      {hud.sky === "snow" && <div className="weather snow" />}
    </div>
  );
}
