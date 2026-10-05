# Psicología de NPCs

> Estado: **borrador de diseño**. Depende de [causality.md](causality.md) (procedencia, creencias vs verdad) y de [heaven-karma.md](heaven-karma.md) (karma y demonios internos).

## Idea central

Un NPC es **temperamento innato + todo lo que le pasó**, interpretado a su manera. Nada de su mente es aleatorio en el momento: si alguien es desconfiado, hay eventos concretos (y un temperamento) que lo explican, y el inspector puede mostrarlos.

```
genética (padres + varianza de seed)
        │
        ▼
  TEMPERAMENTO ──────────┐
        │                │ filtra
        ▼                ▼
   evento real ──► INTERPRETACIÓN ──► emoción ahora
                         │            memoria episódica
                         │            cambio en relaciones
                         │            (si es formativo) cambio en esquemas y valores
                         ▼
              ESQUEMAS + VALORES + RELACIONES + MEMORIAS
                         │
                         ▼
               objetivos en capas → utilidad → acción → nuevos eventos
```

Las mismas reglas valen para el jugador, salvo que sus decisiones las toma el jugador.

## 1. Temperamento (innato)

Seis ejes continuos en [-1, 1]. Están fijos desde el nacimiento y solo cambian ante eventos extremos (ver demonios internos y desviación de qi).

| Eje | Bajo | Alto |
|---|---|---|
| `reactivity` | Imperturbable | Emocionalmente volátil |
| `sociability` | Solitario | Busca gente |
| `curiosity` | Prefiere lo conocido | Busca lo nuevo |
| `control` | Impulsivo | Disciplinado, planifica |
| `warmth` | Frío, dominante | Empático, cooperativo |
| `boldness` | Cauto, evita riesgos | Temerario |

Además tiene **aptitudes**: `intellect`, `perception`, `willpower` y `memory`. El talento de cultivo (raíces espirituales) va en el doc de cultivo.

**Herencia.** Cada eje sale del promedio de los padres más varianza, usando `rng.fork("genetics")`, con heredabilidad de ~0.5. Los hijos de dos padres impulsivos tienden a serlo, pero no siempre. El evento de nacimiento es el `originEventId` del temperamento.

## 2. Lo adquirido: esquemas, valores, hábitos

### Esquemas (creencias nucleares sobre el mundo y uno mismo)
Son proposiciones con fuerza en [0, 1] y la lista de eventos que las formaron:

- `world_is_dangerous` — el mundo es peligroso
- `people_are_untrustworthy` — no se puede confiar en la gente
- `strength_is_worth` — valgo lo que valgo por mi fuerza
- `family_first` — la familia es lo primero
- `heaven_is_just` / `heaven_is_cruel` — el Cielo es justo / cruel
- `effort_pays` — el esfuerzo rinde
- `i_am_unworthy` — no valgo nada
- …(catálogo cerrado en `content/`, ampliable)

### Valores (qué le importa)
Son pesos normalizados sobre `power`, `safety`, `family`, `knowledge`, `freedom`, `justice`, `wealth`, `status`, `pleasure`, `tradition`, `immortality`. Se derivan de temperamento + cultura de origen + esquemas, y se ajustan con eventos formativos.

### Cómo se forma lo adquirido
Cada evento que el NPC vive y le resulta **intenso** puede mover esquemas y valores:

```
Δ = intensidad × plasticidad(edad) × susceptibilidad(temperamento) × dirección(interpretación)
```

- **Plasticidad**: alta en la infancia y baja en la adultez. Para un cultivador de 800 años es casi nula, salvo traumas enormes. Esto da que los viejos sean "duros" y que los traumas infantiles marquen de por vida.
- **Susceptibilidad**: por ejemplo, alta `reactivity` amplifica los eventos negativos.
- **Crianza**: los padres son la mayor fuente de eventos formativos tempranos (cuidado, abandono, violencia, enseñanza). La crianza no es un modificador abstracto: son **eventos de crianza** que la simulación genera según cómo son los padres y su situación (pobreza, guerra, deudas).

**Ejemplo.** Al padre de Li Wei lo hiere un discípulo de una secta, y la familia queda endeudada con los Zhao.
- El evento se interpreta con su temperamento (`boldness` alto, `warmth` medio).
- Sube `strength_is_worth` y el valor `power`.
- Nace un resentimiento hacia el discípulo y su secta, y una relación de deuda con los Zhao.
- Se crea un vínculo kármico (heridor → familia del herido).
- Queda una memoria intensa, semilla de un posible demonio interno.

Todo lo anterior apunta al mismo evento.

### Hábitos y habilidades
Son lo que hizo repetidamente (cazar, mentir, meditar). Salen de las acciones registradas, no se asignan.

## 3. Interpretación (appraisal)

Es el paso clave: **el mismo evento produce efectos distintos en NPCs distintos.**

`appraise(npc, perceivedEvent) → { emotions, valence, intensity, blame, schemaUpdates, relationshipDeltas }`

- Solo recibe lo que el NPC **percibió** o le contaron (ver [causality.md](causality.md)), nunca la verdad.
- A quién culpa depende de sus creencias. Con `people_are_untrustworthy` alto tiende a atribuir mala intención.
- Es determinista: temperamento + esquemas + relaciones + el evento percibido.

## 4. Emociones (corto plazo)

Las emociones son `fear`, `anger`, `sadness`, `joy`, `shame`, `guilt`, `envy` y `love`, cada una con intensidad. Decaen en horas o días según `reactivity`.

- Modulan las decisiones del momento: con ira se toman más riesgos y con miedo se huye.
- El **estrés** crónico es un acumulador lento. Si se sostiene, mueve esquemas como un evento formativo.
- **Contagio emocional:** las emociones **percibidas** en otros entran a la interpretación como un evento más. Su peso depende de `sociability`, de la relación con quien la muestra y de cuántos la muestran. Así se dan el pánico en una batalla, la euforia en un festival o la furia de una turba. Los grupos de tier 0 tienen un humor colectivo que se mueve con la misma regla, en agregado.

## 5. Memoria episódica

```ts
interface Memory {
  id: MemoryId;
  owner: NpcId;
  eventId: EventId;          // el evento real (la verdad), para el inspector
  perceived: PerceivedEvent; // lo que el NPC cree que pasó (puede diferir)
  source: "witnessed" | "told" | "inferred";
  toldBy?: NpcId;
  intensity: number;         // emocional, al formarse
  valence: number;           // -1..1
  salience: number;          // decae; si baja de un umbral → se comprime
  confidence: number;        // cuánto cree que fue así
  distortion: number;        // cuánto se alejó `perceived` del original
  lastRecalled: Time;
}
```

- **Degradación:** la `salience` cae con el tiempo. Recordar una memoria (pensarla, contarla, ver algo relacionado) la refuerza. Las memorias muy intensas casi no decaen (memorias "flash").
- **Distorsión:** cada vez que se recuerda o se cuenta, los detalles derivan hacia los esquemas de quien recuerda (el desconfiado recuerda más malicia). Usa `rng.fork("memory", npcId)`, así que es determinista, y se registra para que el inspector muestre "recuerda X, pero pasó Y".
- **Compresión:** una memoria olvidada no desaparece sin rastro. Queda como resumen (*gist*): "los Zhao nos humillaron". Sus efectos en relaciones y esquemas ya se aplicaron.
- **Memoria vs conocimiento:** la memoria es episódica ("vi a Wu robar"). Las **creencias** semánticas ("Wu es ladrón", "hay una veta en el Monte Hierro") viven en `sim/knowledge`. Una memoria puede generar creencias. Los rumores y la propagación van en el doc de información.

## 6. Relaciones

Son asimétricas: lo que A siente por B no es lo que B siente por A.

```ts
interface Relationship {
  from: AgentId;   // NPC, jugador
  to: AgentId;     // NPC, jugador, organización, el Cielo
  trust: number; respect: number; affection: number; fear: number;
  attraction: number; gratitude: number; jealousy: number; resentment: number;
  familiarity: number; dependency: number;
  debts: DebtRef[];          // deudas concretas (dinero, favores, vida) — van al ledger
  bonds: BondLabel[];        // parent, child, spouse, master, disciple, sworn_sibling, rival…
  history: EventId[];        // eventos que la moldearon
}
```

- Cada cambio proviene de una interpretación de un evento. No hay deriva aleatoria.
- **Decaimiento hacia la línea base** por dimensión: `familiarity` decae rápido sin contacto. `resentment` decae lento, y más lento todavía en quien tiene esquemas de venganza.
- Los **vínculos** (`bonds`) son institucionales o declarados: nacen de eventos como un casamiento, tomar un discípulo o un juramento. Las dimensiones son continuas y pueden contradecir al vínculo: un padre al que se teme y no se quiere.
- Las relaciones con **organizaciones** y con el **Cielo** usan la misma estructura. Así funcionan el odio a una secta o la fe.
- La relación con el jugador **no es especial**.

## 7. Motivación y decisión

### Necesidades
`hunger`, `rest`, `safety`, `social` y `cultivation` (qi, recursos). Suben con el tiempo y bajan al satisfacerse. Son la capa "inmediata".

### Objetivos en capas
| Capa | Ejemplo | De dónde sale |
|---|---|---|
| Núcleo | Volverse inmortal, proteger a la familia, venganza | Valores + esquemas + eventos formativos |
| Largo plazo | Entrar a la Secta del Río Sereno | Plan para un objetivo núcleo, según creencias |
| Mediano | Pagar la deuda con los Zhao | Situación + relaciones |
| Corto | Cazar esta semana | Medio para un objetivo de arriba |
| Inmediato | Comer, huir, dormir | Necesidades + emociones |

Todo objetivo tiene `originEventId`. Por ejemplo, "venganza contra X" nace cuando una memoria con `resentment` alto cruza un umbral que depende de `warmth`, `control` y del esquema `strength_is_worth`. Ningún NPC "decide ser villano" al azar.

### Utilidad
Para cada acción candidata, del **mismo catálogo que usa el jugador**:

```
U(a) = Σ_obj  peso(obj) × contribución(a, obj) × P_éxito_creída(a)
       − riesgo_creído(a) × aversión(boldness, miedo)
       + modificadores emocionales + coherencia con valores
```

- La `P_éxito` y el riesgo salen de **creencias**, no de la verdad. Así el NPC se equivoca de forma creíble.
- Elige con `softmax` sobre U usando `rng.fork("decision", npcId)`: casi siempre la mejor opción, a veces la segunda. La temperatura depende de `control`.
- Planificación simple (encadenar acciones hacia un objetivo) en Fase 3. HTN o GOAP más adelante si hace falta.

### Planes contra otros (intrigas)
Cuando el objetivo de un NPC choca con otra persona (un rival por el mismo afecto, alguien que tiene el favor que él quiere, un estorbo, una víctima con algo valioso), puede armar un **plan multi-paso** que usa a otros NPCs, información falsa y trampas. Eso está en [schemes.md](schemes.md).

### Coherencia con valores (disonancia)
Actuar contra un valor propio, por ejemplo robar valorando `justice`, genera `guilt`, y si se repite mueve esquemas o alimenta un demonio interno. Esto permite caídas morales graduales: alguien que roba por hambre una y otra vez termina creyendo que "el mundo es así".

## 8. Diálogo

La **simulación** decide el acto de habla: amenazar, mentir, halagar, negarse, contar un secreto, pedir ayuda. Lo elige por utilidad, como cualquier acción. Una mentira es una decisión del sim con un contenido concreto (qué creencia falsa intenta instalar).

El **LLM** solo lo verbaliza. Recibe:
- el acto de habla y su contenido;
- un resumen de la personalidad (temperamento, 2–3 esquemas fuertes);
- las memorias relevantes del NPC sobre el interlocutor;
- la relación con quien le habla;
- el estado emocional actual.

El LLM nunca decide qué sabe o qué quiere el NPC.

## 9. Demonios internos (心魔) y corazón del Dao

```ts
interface InnerDemon {
  owner: NpcId;
  theme: "hatred" | "guilt" | "fear" | "obsession" | "regret" | "desire" | "despair";
  strength: number;
  roots: Array<MemoryId | KarmicBondId | SchemaKey>;  // de qué se alimenta
}
```

- **Se forman** cuando una herida queda sin resolver: memorias intensas negativas, vínculos kármicos no saldados ([heaven-karma.md](heaven-karma.md)) o disonancia repetida con los propios valores. Se calculan del estado psicológico; no aparecen al azar.
- **Se alimentan** cuando algo dispara las raíces: ver al asesino, volver al lugar, repetir la culpa.
- **Se resuelven** con cierre real: vengarse, ser perdonado, reparar, o aceptar mediante meditación prolongada (una acción de cultivo con costo de tiempo). Resolver la raíz puede saldar el vínculo kármico, y viceversa.
- **Efectos:**
  - En rupturas y tribulaciones: la prueba del demonio interno tiene dificultad `f(strength)`. Fallar provoca desviación de qi, locura (cambios bruscos de esquemas, incluso del temperamento) o la muerte.
  - En el día a día, cuando se activan: emociones intrusivas y decisiones que contradicen la utilidad "racional".
- **Los demonios hablan.** En meditación profunda, rupturas y tribulaciones, el narrador los manifiesta como voces o visiones. Se arman **solo** con sus raíces reales: las memorias (distorsionadas como las recuerda el dueño), las personas involucradas y la culpa o el odio concretos. El demonio sabe lo mismo que su dueño, nunca la verdad del mundo. Puede mentir, retorcer recuerdos y tentar: lo que dice lo decide la sim (qué raíz ataca, qué ofrece) y el LLM lo verbaliza.
- **Corazón del Dao (道心):** estabilidad = convicción (claridad de los objetivos núcleo) × coherencia (actuar según los propios valores). Resiste a los demonios. Un cultivador cruel pero coherente puede tener un Dao firme; uno bondadoso que se traiciona, no.

## 9b. El cultivo altera la psique

Las técnicas y los caminos de cultivo pueden modificar la psicología, siempre con procedencia (el evento en que se aprendió o practicó la técnica):

- **Supresión emocional** (estilo 无情道, Dao sin emociones): baja la intensidad de las emociones y el peso de `warmth`. Protege contra ciertos demonios (apego, miedo) pero debilita relaciones y abre otros (vacío, desesperanza).
- **Amplificación:** técnicas demoníacas o de sangre que aumentan `anger` o el deseo y dan poder a cambio.
- **Efectos acumulativos:** practicar una técnica durante años mueve esquemas y valores como un evento formativo crónico.
- **Desviación de qi:** puede provocar cambios bruscos de temperamento.

Se modela como modificadores activos `{ source: TechniqueId, originEventId, effects }` sobre temperamento, emociones y valores. El detalle va en el doc de cultivo.

## 10. Escala: cuánta psicología por tier

Los tiers son los de [VISION.md](../VISION.md).

| Tier | Qué se guarda | Cómo se actualiza |
|---|---|---|
| 0 — estadística | Distribuciones de temperamento y valores por población; humor colectivo (miedo, descontento) | Agregado, por eventos que afectan a la población |
| 1 — generado al acercarse | Temperamento, 2–3 esquemas, relaciones con familia, memorias resumidas | Se **materializa** coherente con la estadística y con la historia registrada |
| 2 — activo en la zona | Modelo completo; memorias acotadas a las top-N por saliencia | Decisión diaria, interpretación de eventos percibidos |
| 3 — importante | Modelo completo + objetivos núcleo + demonios | Siempre simulado, a menor frecuencia lejos del jugador |
| 4 — conectado al jugador | Todo, sin límite de memorias | Máxima resolución, nunca se degrada |

- **Materializar (0 → 1):** el temperamento sale de la población y de los padres si existen. Lo adquirido sale de una **biografía sintetizada**: eventos de vida coherentes con lo que la historia agregada registró ("hubo hambruna hace 10 años", "su aldea perdió una guerra"), procesados con las mismas reglas de formación. Esos eventos quedan registrados y pasan a ser verdad, según la regla de detalle diferido de [causality.md](causality.md).
- **Bajar de tier:** comprimir memorias a resúmenes, conservar las relaciones fuertes, guardar el resto como estadística. Un NPC que interactuó con el jugador nunca baja de tier 4.

## 11. Implementación por fases

- **Fase 1:** temperamento + emociones básicas + relación con el jugador (`trust`, `fear`, `affection`). Alcanza para que la aldea reaccione distinto según quién sea cada uno.
- **Fase 2:** interpretación completa, memorias (degradación, distorsión, compresión), relaciones multidimensionales, esquemas, diálogo con actos de habla.
- **Fase 3:** objetivos en capas, utilidad offscreen, crianza → rasgos adquiridos, herencia de temperamento.
- **Fase 4 (cultivo):** demonios internos, corazón del Dao, pruebas en rupturas.
- **Fase 5 (LOD):** tiers, materialización por biografía sintetizada.

Tests clave:
- Mismo seed → misma psicología.
- Todo esquema, objetivo, relación y demonio tiene causas trazables (sin huérfanos).
- La interpretación de eventos nunca lee la verdad.
- Memorias: la saliencia es monótona sin recuerdo y la distorsión está acotada.

## Decisiones tomadas en este borrador (revisables)
- Temperamento de **6 ejes propios** en lugar de Big Five literal: más legible para el juego y fácil de mapear.
- Esquemas y valores en **catálogo cerrado** (en `content/`), no texto libre generado por LLM, para mantener el determinismo y la inspección.
- Decisión por **utilidad + softmax**, no árboles de comportamiento.
- Sí al contagio emocional, sí a los demonios que hablan (solo con sus raíces), sí a las técnicas que alteran la psique.

## Preguntas abiertas
- ¿Cuántas memorias por NPC de tier 2 (top-N)? Calibrar con la sim headless.
