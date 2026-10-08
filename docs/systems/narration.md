# Narrador y capa LLM

> Principio: **el LLM está solo en los bordes.** De un lado traduce lo que escribe el jugador a un borrador de intención; del otro pone en palabras lo que el personaje percibió. Entre los dos bordes todo es simulación determinista. El LLM no decide resultados, no crea entidades, no ve la verdad y no toca el estado. Si mañana no hay red, el juego se sigue pudiendo jugar.

> Estado: **borrador** (2026-10-06).

Depende de: [perception.md](perception.md) (percepts, errores con forma, §11), [information.md](information.md) (creencias del jugador), [actions.md](actions.md) §9, §11 (parser, `IntentDraft`, avisos), [dialogue.md](dialogue.md) §14-§16 (verbalización de actos de habla), [metaphysics.md](metaphysics.md) (vocabulario del mundo), [living-world.md](living-world.md) (léxico generado), [npc-psychology.md](npc-psychology.md) (estado emocional y esquemas del personaje).
Lo usan: [player-loop.md](player-loop.md) (el turno del jugador), [tooling.md](tooling.md) (costos, caché, fixtures), [chronicle.md](chronicle.md) (crónica final y epílogo), [language.md](language.md) (nombres y palabras que el narrador cita).

---

## Principios

1. **Un solo camino de información al LLM.** Todo lo que recibe sale de un constructor de vista del jugador que solo lee percepts, creencias y el estado interno que el personaje siente. Nunca lee `WorldTruth`.
2. **La simulación nunca lee lo que escribe el LLM.** El texto se muestra y se guarda, pero ningún proceso de la sim lo usa como entrada. Por eso el determinismo no depende del LLM: el replay usa los planes ya validados, no el texto.
3. **Todo lo concreto viene de la sim.** Personas, objetos, lugares, nombres, números, sucesos y compromisos están en el pedido; el LLM elige palabras, orden y ritmo.
4. **Lo vago se narra vago y lo equivocado se narra como cierto,** porque así lo vive el personaje (perception §11).
5. **La voz es la del personaje.** El narrador usa las palabras que el personaje conoce, nombra a la gente como él la nombra y ve el mundo con su cultura, su estrato y su estado.
6. **Todo se valida, y siempre hay un plan B.** Cada salida se controla contra una lista blanca; si falla, se regenera, y si vuelve a fallar se usa una plantilla determinista.

---

## 1. Dónde está el LLM

```
texto del jugador
   │
   ▼
[Parser]  ─────────── IntentDraft (Zod) ──► sim: referencias, factibilidad, ActionPlan
                                                │
                                                ▼
                                        scheduler, resolvers, percepts
                                                │
                                                ▼
                                   buildPlayerView()  (único acceso)
                                                │
                     ┌──────────────────────────┼─────────────────────────┐
                     ▼                          ▼                         ▼
               [Narrador]              [Verbalizador]               [Aclaraciones y avisos]
                     │                          │                         │
                     └──────────► [Validador] ◄─┴─────────────────────────┘
                                        │
                                        ▼
                              texto al jugador (y a la bitácora)
```

**Trabajos del LLM** (cada uno con su modelo, su prompt y su validador):

| Trabajo | Entrada | Salida | Tamaño de modelo que pide |
|---|---|---|---|
| Parser de intención | texto, escena percibida, catálogo relevante | `IntentDraft` | el modelo residente con salida restringida (un 7-8B aparte solo si el banco de pruebas lo justifica) |
| Narración de escena | `NarrationRequest` | prosa con referencias marcadas | el modelo residente (12-14B local) |
| Verbalización de habla | `VerbalizationRequest` (dialogue §16) | líneas de diálogo | medio, a veces dentro del mismo pedido de narración |
| Aclaraciones y avisos | candidatos y razones que armó la sim (actions §9) | una pregunta o aviso dentro del mundo | chico |
| Montaje de tiempo saltado | resumen de lo que el personaje vivió en el salto | prosa breve | medio |
| Textos dentro del mundo | proposiciones de una carta, un libro, una inscripción | el texto del objeto | medio |
| Sueños | contenido del sueño que decidió la sim (npc-psychology §15) | prosa onírica | medio |
| Crónica y epílogo | capítulos y hechos de chronicle.md, **con la verdad** | crónica final | el mejor disponible |
| Preguntas fuera del personaje | la pregunta y lo que el personaje sabe | respuesta breve | chico |

Los modelos son configuración, no código: se cambian sin tocar la lógica.

### Proveedores (aprobado 2026-10-06)

```ts
type LlmProvider =
  | { kind: "templates" }                                  // plantillas deterministas (§11): siempre disponibles
  | { kind: "local"; runtime: "ollama" | "llamacpp" | "lmstudio"; model: string; grammar?: boolean }   // modelo abierto en la PC del usuario
  | { kind: "api"; vendor: string; model: string; maxSpendPerSession?: number };                    // opcional, pago por uso

interface LlmConfig {
  jobs: Record<LlmJob, LlmProvider[]>;                     // por trabajo, en orden de preferencia; el último siempre es "templates"
  promptLanguage: "en" | "es";                             // idioma de las instrucciones internas
  outputLanguage: "es" | "en";                             // idioma de la narración
}
```

- **Por defecto todo es local:** modelos abiertos ya hechos, corriendo en la PC del usuario (referencia: RTX 4070 Super de 12 GB, 32 GB de RAM). **Un solo modelo residente de 12-14B cuantizado para parser y narración** (aprobado 2026-10-06, ARCHITECTURE §7.7): en 12 GB no entran dos modelos cargados a la vez y cambiar de modelo en cada turno cuesta segundos. El parser usa el mismo modelo con la salida restringida por el JSON Schema que sale del esquema Zod (`z.toJSONSchema`). El banco de pruebas mide si un parser chico aparte vale el cambio. Proveedores por una interfaz compatible con OpenAI: Ollama primero, servidor de llama.cpp cuando haga falta control fino (gramáticas, caché del prefijo por ranura). Sin costo por uso, sin red.
- **La API es opcional** por trabajo (por ejemplo, solo para la crónica final), con tope de gasto.
- **Idioma:** las instrucciones internas van en inglés (los modelos chicos las siguen mejor); el jugador escribe en español y la narración sale en español. Si en el banco de pruebas el español de un modelo sale mal, la narración puede pasar a inglés por configuración.
- **Banco de pruebas en Fase 1:** las mismas 30-50 escenas narradas con varios modelos locales (y, para comparar, plantillas y alguna API), medidas por tasa de aprobación del validador, latencia y lectura del usuario. El modelo por defecto sale de ahí.
- **Fine-tune propio después de terminar el juego** (Fase 9): un adaptador LoRA sobre el modelo local que gane el banco de pruebas, entrenado con cientos de ejemplos reales del juego (pedido → texto aprobado por el validador y por el usuario). **No se entrena con salidas de Claude** (los términos de Anthropic lo restringen); los ejemplos salen de textos del usuario, de salidas de modelos abiertos ya filtradas y de las plantillas.
- **Nada de esto afecta la simulación:** cambiar de proveedor cambia la prosa, nunca el mundo.

## 2. El muro: la vista del jugador

```ts
// Tipo con marca: solo buildPlayerView puede crearlo.
interface PlayerView {
  readonly __brand: "PlayerView";
  self: SelfView;                            // lo que el personaje siente de sí: cuerpo, emociones, cansancio, cultivo percibido (perception §10)
  scene: SceneView;                          // lugar, hora, luz, clima, tal como se perciben
  percepts: PerceptView[];                   // percepts sin `mistaken` ni campos ocultos
  outcomes: OutcomeView[];                   // resultado de sus acciones como lo percibe (actions §11)
  heard: HeardUtterance[];                   // lo que oyó y entendió (dialogue §3)
  labels: LabelTable;                        // cómo nombra a cada entidad (§3)
  beliefs: BeliefSnippet[];                  // creencias relevantes para la escena: quién es quién, qué sabe del lugar
  lexicon: LexiconView;                      // palabras que conoce (§4)
}
```

- **`buildPlayerView` es el único lugar** que convierte estado en algo que el LLM puede ver. Vive en `src/sim/view/`, es puro y está cubierto por tests de fuga (§13).
- **Se borra lo que el personaje no sabe:** `mistaken`, `margin`, `factors`, ids reales de entidades no identificadas, tiradas, intenciones ajenas no percibidas, valores reales de stats.
- **Los ids que ve el LLM son locales al pedido** (`e1`, `e2`…). La tabla de etiquetas los traduce; así un id real nunca revela que dos figuras "distintas" son la misma persona.

## 3. Etiquetas: cómo nombra el personaje a las cosas

```ts
interface EntityLabel {
  localId: string;                           // e1, e2… solo dentro del pedido
  name?: string;                             // si el personaje lo conoce ("Lin Wei"), con el título que usaría
  description: string;                       // lo que lo identifica para él ("el viejo de la barba gris")
  relation?: string;                         // "tu tío", "la mujer que te robó"
  firstSeen?: boolean;                       // primera vez que aparece: se presenta con descripción
  confidence: number;                        // "creés que es Zhao" vs "es Zhao"
}
```

- **Una entidad se nombra como la nombra el personaje.** Si cree que la figura es Zhao, el narrador dice Zhao; si duda, lo dice con duda; si no sabe quién es, la describe.
- **Dos etiquetas pueden ser la misma entidad** sin que el narrador lo sepa: el desconocido de la posada y el asesino de anoche son `e3` y `e7` si el personaje no los vinculó.
- **Las descripciones salen de campos percibidos** (perception §7): rasgos, ropa, marcas de rango, aura. El LLM las redacta una vez y quedan guardadas (§6) para no contradecirse.

## 4. Vocabulario, léxico y voz

- **Vocabulario del mundo** (metaphysics): cada familia metafísica trae su juego de términos (qi o maná, secta u orden, ruptura o ascenso). El narrador recibe solo los términos de este mundo.
- **Léxico del personaje:** el subconjunto que él conoce. Un campesino que nunca oyó hablar de reinos de cultivo no dice "Fundación": dice "uno de esos inmortales". Las palabras técnicas se aprenden (skills, information) y entran al léxico cuando el personaje las cree.
- **Léxico generado** (living-world; [language.md](language.md) §13): nombres de personas, lugares, plantas y conceptos salen del generador de lenguas. El LLM los cita o usa la traducción que el pedido trae; nunca inventa palabras.
- **Voz del personaje:** cultura, estrato, oficio y educación tiñen la narración (un herrero nota el temple de una hoja; una cortesana, la tela de una túnica). El estado emocional tiñe el tono, no los hechos: con miedo, la narración es tensa, pero no agrega amenazas que no se percibieron.
- **Idioma de la narración:** español por defecto, rioplatense si el modelo lo maneja (configurable; ver Proveedores en §1). Las lenguas del mundo que el personaje no entiende se narran como sonido o con las palabras sueltas que sí entendió (dialogue §3).

## 5. El pedido de narración

```ts
interface NarrationRequest {
  view: PlayerView;
  mode: NarrationMode;                       // §7
  mustMention: LocalRef[];                   // lo que no se puede omitir: un ataque, una herida, una respuesta a su pregunta
  mayMention: LocalRef[];                    // lo que puede usar como ambiente si suma
  ambience: AmbienceView;                    // paleta de ambiente del lugar percibido: sonidos, olores, luz, texturas (§8)
  continuity: ContinuityView;                // §6
  style: StyleSettings;                      // persona gramatical, tiempo verbal, largo, preferencias del usuario
  utterances?: VerbalizationRequest[];       // líneas a verbalizar dentro de la misma escena
}
```

**Salida estructurada:** el narrador devuelve el texto con las referencias marcadas, por ejemplo `{{e3|el viejo}} levanta la vista`. El validador (§9) controla las marcas y después las saca. Así se verifica qué entidades usó sin depender de adivinarlas en la prosa.

## 6. Memoria de narración y continuidad

```ts
interface NarrationMemory {
  descriptions: Map<EntityId, string[]>;     // cómo se describió a alguien o algo (rasgos ya establecidos), en el idioma del jugador
  places: Map<PlaceId, string[]>;            // cómo se describió un lugar la primera vez
  recent: string[];                          // los últimos N fragmentos narrados, textuales
  summaries: ChapterSummary[];               // resúmenes de la narración vieja, hechos sobre el texto ya mostrado
  motifs: string[];                          // imágenes recurrentes que el jugador ya vio (el cuervo sobre la pagoda)
}
```

- **Lo ya dicho se respeta:** si la tía tenía "ojos cansados", no pasa a tener "mirada viva" salvo que algo cambie en la sim.
- **Los resúmenes se arman solo con texto que el jugador ya leyó,** así nunca meten información nueva.
- **Las descripciones se guardan por entidad real** (del lado del motor) pero se entregan por etiqueta local: si el personaje no sabe que dos figuras son la misma, no recibe las descripciones de una para la otra.
- **La memoria de narración no es la memoria del personaje.** Lo que el personaje recuerda sale de npc-psychology; si su recuerdo se deformó, la narración de un recuerdo usa el recuerdo deformado, no el texto viejo.

## 7. Estilo y tono por situación

```ts
type NarrationMode =
  | "scene"          // exploración y descripción
  | "action"         // pelea, persecución, accidente: frases cortas, sin pausas descriptivas
  | "dialogue"       // la charla manda; poca descripción entre líneas
  | "introspection"  // el personaje piensa, recuerda, siente
  | "montage"        // tiempo saltado: semanas o años en un párrafo
  | "dream"
  | "aftermath";     // después de algo grave: el cuerpo, el silencio, lo que quedó
```

- **El modo sale de la sim** (hay una pelea, hubo un salto de tiempo, el personaje se durmió), no lo elige el LLM.
- **El largo se ajusta por modo y novedad:** un lugar nuevo se describe más; uno conocido, casi nada. El usuario puede pedir más o menos detalle en cualquier momento (`meta`).
- **El tono de la familia metafísica** (xianxia, magia occidental…) entra en el prompt fijo; el del momento sale de la emoción del personaje y del modo.
- **Lo importante no se resalta si el personaje no lo sabe:** nada de "algo te dice que esto va a importar". Sin presagios del narrador.

## 8. Ambiente y detalles: qué puede agregar el LLM

- **Detalles que se pueden usar** (gente, objetos, salidas, huellas, cosas que se pueden tocar, tomar o investigar) **solo si están en el pedido.** Si el narrador menciona una puerta, la puerta existe en la sim.
- **Textura sin consecuencias** (el olor a humedad, la madera gastada, el viento en los pinos) sale de la `ambience` del lugar, que arma la sim con el bioma, el clima, la hora y el contenido del sitio. El LLM elige qué usar de esa paleta.
- **Si el jugador quiere interactuar con algo que el narrador mencionó,** existe: el validador garantiza que todo lo accionable tiene referencia.

## 9. Validación de la salida

En orden:
1. **Formato:** la estructura parsea; las marcas de referencia apuntan a etiquetas del pedido.
2. **Lista blanca:** nombres propios, números, lugares y términos del vocabulario aparecen en el pedido o en el léxico del personaje. Se detectan con las marcas, con una lista de nombres del mundo (todos los nombres generados, para cazar fugas) y con reglas simples (cifras, mayúsculas).
3. **Cobertura:** todo lo de `mustMention` aparece.
4. **Prohibiciones:** no declara resultados que no ocurrieron, no habla con el jugador como juego, no usa términos que el personaje no conoce, no revela intenciones ajenas como hechos.
5. **Largo** dentro del rango del modo.

Si falla: **se regenera una vez** con el error explicado; si vuelve a fallar, **plantilla determinista** (§11). Cada falla queda en un registro para mejorar prompts (tooling).

## 10. El parser de intención

Complementa actions §9:
- **Contexto que recibe:** el subconjunto del catálogo relevante para la escena (verbos posibles con lo que hay alrededor, más los siempre disponibles), la escena percibida con etiquetas, las últimas intenciones y lo que el personaje dijo, sus planes en curso y posturas.
- **Esquema:** `IntentDraft` validado con Zod; las referencias van como descripciones (actions §4), nunca como ids reales.
- **Aclaraciones:** la sim decide si hace falta preguntar y arma los candidatos; el LLM redacta la pregunta dentro del mundo ("¿al viejo de la barba o al muchacho de la entrada?").
- **Lo que entra al replay es el plan validado,** no el texto ni la salida cruda del parser. Mismo seed + mismos planes = mismo mundo.
- **Ejemplos:** casos de prueba y ejemplos de pocos tiros en `content/llm/parser-examples/`, revisados a mano.

## 11. Plantillas y modo sin red

- **Narrador de plantillas:** una plantilla por tipo de percept, resultado y acto de habla, en `content/llm/templates/`, en español, con variantes elegidas por rng con clave. Es pobre pero correcto: nunca rompe las reglas.
- **Parser sin red:** una gramática de comandos en español ("ir a la herrería", "hablar con el viejo: ¿viste a mi hermana?", "atacar al bandido con la espada") que produce el mismo `IntentDraft`.
- **El juego completo se puede jugar sin red,** con menos gracia. Las plantillas también son el narrador de los tests y de la sim headless.

## 12. Costos, caché y latencia

- **Local primero:** con modelos locales no hay costo por token; lo que importa es la latencia (modelo chico para el parser, narración en streaming) y no tener la GPU ocupada de más.
- **Prompt caching:** el prefijo fijo (reglas, estilo, vocabulario del mundo, léxico del personaje, voz) se cachea, tanto en la API como en el runtime local (caché de contexto); lo variable va al final.
- **Presupuesto por turno** de tokens por trabajo, configurable; el registro de costos va a tooling.
- **Streaming:** la narración se muestra a medida que llega, pero se valida por párrafos antes de mostrarse; si un párrafo falla, se corta ahí y se reemplaza.
- **Caché de textos dentro del mundo:** una carta o un libro se redacta una vez y el texto queda guardado con el objeto (las copias heredan el texto con sus cambios, chronicle). Los NPCs leen las proposiciones, no el texto.
- **Nada del LLM en el camino de la sim headless:** las corridas de historia y calibración no llaman al LLM.

## 13. Crónica y modo inspector: los dos lugares donde se ve la verdad

- **La crónica final** (chronicle.md) y el **inspector** son los únicos pedidos que pueden llevar verdad. Usan un constructor separado (`buildTruthView`) y un canal visualmente distinto. Nunca se mezclan con la narración del personaje.
- **El jugador vivo no ve la crónica de la verdad.** Se genera al morir (o al terminar la partida).

## 14. El jugador y el narrador

- El jugador lee prosa en segunda persona, presente, con voseo (configurable).
- Los avisos y aclaraciones son del mundo del personaje (actions §11); los comandos `meta` (guardar, más detalle, inspector) tienen su propio canal.
- El jugador puede pedir **"mirar de nuevo"** o **"recordar"**: son acciones del personaje (observar cuesta tiempo; recordar usa su memoria), no relecturas del texto.
- El jugador puede **releer el texto ya mostrado** en la bitácora, que es solo texto: no da información nueva.

## 15. Escala (LOD)

La narración existe solo para el jugador. En escena se narra cada intercambio; en saltos de tiempo, montaje desde lo que el personaje vivió; fuera del personaje (otras regiones, historia), no se narra nada salvo en la crónica.

## 16. Implementación por fase

- **Fase 0 (hecha):** cliente LLM con `MockLLM`; interfaz de trabajos y proveedores intercambiables; validador vacío. En código: `llm/client` (`OpenAiCompatibleClient`), `llm/config` (`LlmConfig` con cadena por trabajo que termina en `templates`), `llm/jobs` (`LlmJobs`: regenerar una vez con el error, pasar al siguiente proveedor si está caído), `llm/parser` (`parseIntent` con el JSON Schema del `IntentDraft`) y `llm/narrator` (`narrate`, `verbalize`).
- **Fase 1:** `buildPlayerView` mínimo (percepts nada/vago/identificado, etiquetas simples), narrador de escena y de acción, parser con esquema y aclaraciones, plantillas y modo sin red, lista blanca de nombres, caché del prefijo.
- **Fase 2:** léxico del personaje, voz por cultura y estrato, memoria de narración y continuidad, modo introspección, verbalización integrada a la escena.
- **Fase 3:** montaje para saltos de tiempo, textos dentro del mundo, sueños.
- **Fase 4:** vocabulario de cultivo por escuela; percepción interna y de cultivo narrada con incertidumbre.
- **Fase 1 (además):** proveedor local (Ollama o similar) con gramática JSON para el parser; banco de pruebas de modelos.
  - **Hecho, el parser.** Hay dos esquemas por catálogo, y los tests verifican que acepten y rechacen lo mismo:
    - `structuralDraftFor` va como `response_format`. Es una variante de `do` por verbo, con sus roles, el tipo de argumento y los modos como literales, más las plantillas. Solo admite `do`, `seq`, `until` y `template`. El JSON Schema tiene menos de 20k caracteres.
    - `intentDraftFor` es el `IntentDraft` más `draftCatalogProblems`. Una unión no explica por qué rechaza, este sí: "move has no role \"where\" (roles: to)". Ese mensaje vuelve al modelo cuando regenera.
  - **El prompt.** Las reglas van en inglés y el texto del jugador en español. El orden es: reglas, una línea por verbo con roles y modos, las plantillas, los ejemplos `shot` como pares usuario/asistente, y al final la escena, las intenciones recientes y el texto. Todo menos lo del final es fijo por catálogo y se puede cachear.
  - **Las respuestas.** Pueden traer `<think>` o un cerco Markdown; `jsonPayload` los saca antes de parsear.
  - **Hablar en una secuencia.** Cuando hablar es un paso de una secuencia, se usa el verbo `speak` con `content`, porque `speech` va antes del plan.
  - **El banco (`npm run llm-bench`).** Puntúa por campo: tipo, pasos, roles, referencias por palabras como `resolveRef`, habla, descartado y sin verbo. Dos borradores que dan el mismo plan valen lo mismo.
  - **El cambio de modelo.** `--swap` alterna una narración del residente con un parseo y compara contra parsear con el mismo residente; la diferencia es el costo del cambio por turno. Para que el residente no se descargue, Ollama tiene que correr con `OLLAMA_KEEP_ALIVE=-1`.
  - **Resultados (2026-10-07, RTX 4070 Super 12 GB, Ollama):**

    | modelo | válido | acierta | medio | p95 | tok/s |
    |---|---|---|---|---|---|
    | qwen3:4b | 100% | 73% | 0,74 s | 1,59 s | 120 |
    | qwen3:14b | 100% | 63% | 1,08 s | 2,15 s | 44 |
    | gemma3:12b (antes de los arreglos) | 97% | 57% | 2,06 s | 6,43 s | 28 |

    - **Razonamiento apagado.** qwen3 piensa antes de contestar: ~3000 tokens y 25-30 s por parseo. El cliente local manda `reasoning_effort: "none"` (`NO_THINKING` en `llm/jobs`); `think: false` no hace nada en la API compatible con OpenAI. `think: true` en el proveedor (o `--think` en el banco) lo vuelve a prender.
    - **Tope de tokens.** `PARSER_MAX_TOKENS = 768`: el ejemplo más largo son ~150 tokens, y sin tope la salida restringida a veces entraba en bucle hasta el timeout.
    - **Esquema estructural más estricto que el genérico:** la clase de cada referencia (`person`/`group`, `place`, `object`/`lot` según el rol) y el `is` de `until` son obligatorios. Los modelos los omitían.
    - **Ejemplos que más rindieron:** uno con un verbo sin sus roles opcionales (los modelos inventaban "espero 1 segundo"; la regla escrita sola no alcanzó) y uno con `speak` con destinatario y contenido en un solo paso. Con eso el 4b pasó de 60% a 73% y el 14b de 57% a 63%.
    - **Decisión:** qwen3:14b residente para parser y narración, como estaba aprobado. El 4b parsea mejor y 3 veces más rápido, y 2,5 + 9,3 GB podrían entrar juntos en 12 GB; si `--swap` (sin medir todavía) da un costo chico, el parser pasa al 4b.
    - **Fallas que quedan:** `until` con una hora del día sale como duración fija; el parentesco va como rasgo y no como `relation`; `unmapped` con palabras que sí se mapearon. Parte es el puntaje estricto, no el modelo.
- **Fase 1, el narrador (hecho):**
  - **La vista.** `game/view` tiene `buildPlayerView(ViewInput)`, que arma una `PlayerView` con marca de tipo: sin la marca no se compila. Parte de los percepts del jugador (tira si llega uno de otra mente), de los `SelfReport` de sus pasos, de la escena y de los conocidos (nombre y relación).
    - Cada conocido tiene una sola etiqueta `eN`. Un desconocido tiene una etiqueta nueva en cada percept, porque el personaje no sabe si es el mismo.
    - La figura va estructurada (`{sex, age}`), no como una frase. La seguridad va en tres bandas (`sure`/`likely`/`unsure`) y la luz y la hora como bandas.
    - No pasan ids reales, errores, confianzas, márgenes ni factores. Un test lo verifica sobre el JSON.
    - En Fase 1 la vista no lleva creencias ni lo oído de segunda mano: eso entra con el bucle del jugador.
  - **El pedido.** `llm/narration` tiene `narrationRequest(view, style, ambience)`, que calcula el modo (escena/acción), lo que hay que nombrar (`mustMention`: las etiquetas de los resultados y los percepts claros) y lo que se puede nombrar.
    - `narratorSystem(style)` depende solo del estilo, así que el prefijo se cachea igual entre turnos (hay un test de eso).
    - El pedido de cada turno va como JSON en el mensaje del usuario.
    - Las texturas de ambiente salen de `content/llm/ambience/` con `ambienceOf`, que filtra por tipo de lugar, espacio, adentro, hora y luz.
  - **El validador.** `llm/validate` tiene `validateNarration`. Revisa las marcas `{{eN|palabras}}` (formato e ids existentes) y la lista blanca: una mayúscula fuera de inicio de oración tiene que estar en el léxico, en los nombres de las etiquetas o entre comillas. También revisa:
    - que no se filtren nombres del mundo (`worldNames`) ni cifras que no estén citadas;
    - que una marca no lleve el nombre de otra etiqueta;
    - que estén todas las de `mustMention`;
    - que no aparezcan palabras de meta-juego (jugador, tirada, HP…);
    - el largo, según modo × detalle.

    Los problemas van en inglés y vuelven al modelo cuando regenera.
  - **El narrador.** `narrate(jobs, request, {templates, rng})` pide, valida y regenera una vez. Si no pasa, o si no hay modelo, cae a las plantillas. Devuelve el texto sin marcas, el texto marcado y de dónde salió.
  - **Las plantillas.** Están en `content/llm/templates/es.json`, en segunda persona, presente y con voseo. `llm/templates` (`TemplateBook`, `renderView`) arma el mismo formato marcado, así que pasa por el mismo validador: un test lo corre sobre todos los efectos, percepts y señales del cuerpo con 3 seeds. Las variantes las elige el rng con la clave del turno, así el replay da la misma prosa.
  - **El parser sin red.** `llm/grammar` (`parseCommand`) es una gramática de comandos en español. Entiende verbos del catálogo, secuencias con "y"/"después", "hasta que…", duraciones, modos, referencias ("mi tío" como `relation`), habla citada o con "que", metas y preguntas fuera del personaje. Saca 36 de los 39 ejemplos del parser; los que faltan necesitan la escena o las intenciones recientes. `parseIntentOrGrammar` la usa cuando la cadena del trabajo llega a las plantillas, validando con el mismo esquema.
  - **Falta:** las aclaraciones del parser, la memoria de continuidad y medir `--swap` con el narrador real.
- **Fase 7-8:** crónica y epílogo con el mejor modelo disponible; léxico generado completo ([language.md](language.md)).
- **Fase 9:** fine-tune LoRA propio con ejemplos reales del juego.

## Tests

- **Fugas:** con un mundo de prueba lleno de verdades ocultas (un disfraz, un veneno, una identidad falsa, un percept equivocado), ningún `PlayerView` contiene esos datos. Se prueba sobre el constructor, sin LLM.
- **Marca de tipo:** el cliente del narrador solo acepta `PlayerView`; un test de tipos falla si se le pasa estado crudo.
- **Validador:** un corpus de salidas con entidades inventadas, cifras, nombres de otros lugares o términos desconocidos es rechazado; un corpus correcto pasa.
- **Plantillas:** cada tipo de percept, resultado y acto de habla tiene plantilla; todas pasan el validador.
- **Determinismo:** la sim con narrador real y con plantillas produce el mismo mundo.
- **Replay:** reproducir una partida desde seed y planes guardados da el mismo estado sin llamar al LLM.
- **Parser:** los ejemplos de `content/llm/parser-examples/` producen el `IntentDraft` esperado (con fixtures grabados para no gastar red en CI).

## Decisiones tomadas en este borrador (revisables)

- **Un único constructor de vista con tipo de marca** como muro entre la verdad y el LLM.
- **Ids locales por pedido** y etiquetas como las nombra el personaje.
- **Salida con referencias marcadas** para validar sin adivinar.
- **Ambiente desde una paleta de la sim;** lo accionable solo desde el pedido.
- **Regenerar una vez y después plantilla;** juego completo sin red.
- **El replay usa planes validados,** no texto.
- **Crónica e inspector con un constructor de verdad separado.**

## Decisiones (aprobado 2026-10-06)
- **Segunda persona, presente, con voseo,** configurable.
- **Lo accionable solo desde la sim; la textura, de la paleta de ambiente** que arma la sim. Todo lo que el narrador menciona existe.
- **Largo:** corto en acción y diálogo, más largo en lugares nuevos; "más detalle" y "más breve" quedan como preferencia del usuario.
- **Modelos locales ya hechos por defecto,** proveedor intercambiable por trabajo, API opcional, banco de pruebas en Fase 1 y fine-tune propio al terminar el juego. Instrucciones en inglés; narración en español si el modelo lo maneja bien.
- **Un modelo residente para parser y narración** (2026-10-06, revisión del stack): ver §1.

## Preguntas abiertas

- Calibración: largo por modo; tamaño de la ventana de texto reciente; cada cuánto resumir; presupuesto de tokens por turno; qué tan estricta es la detección de nombres; cuántos ejemplos de parser hacen falta.

## Ampliación (2026-10-08): no repetir lo que ya está en el panel

El `NarrationRequest` recibe qué estados de ambiente ya están en el panel de entorno (player-loop) y el narrador solo los menciona si cambian o si la escena gira alrededor de ellos. Menos tokens y menos descripciones repetidas. Las etiquetas de las opciones sugeridas y el monólogo de "pensar" usan el mismo muro: solo lo que el personaje cree.
