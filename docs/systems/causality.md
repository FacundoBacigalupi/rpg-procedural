# Causalidad — el modelo del mundo

> Principio: **en este mundo no ocurren eventos. Ocurren procesos, y los eventos son su rastro.**

> Estado: §1-§8 **decididos**; §9-§11 son una **ampliación en borrador** (2026-10-05): las presiones como objeto con fuentes, umbrales, chispas y descargas; el inspector con mapa de presiones y preguntas al grafo; contrafácticos deterministas solo en herramientas. Lo usan: todos los sistemas de simulación y worldgen.

Un juego procedural normal tiene tablas del tipo "10% de chance de ataque de bandidos". Acá eso está prohibido. Los bandidos atacan porque existen personas concretas que se volvieron bandidos por razones concretas, tienen hambre, saben que esa aldea es débil y está cerca. El dado se tira, pero se tira **sobre una situación**, nunca para crear la situación.

---

## 1. Las cinco leyes de la causalidad

### Ley 1 — Nada se genera de la nada (procedencia)
Toda entidad (persona, item, técnica, secta, ruina, rumor) tiene un **origen**: el evento que la creó.
- Una píldora existe porque un alquimista la refinó con hierbas concretas.
- Una técnica existe porque alguien la creó (o la derivó de otra). Es un objeto de conocimiento con autor, copias y portadores.
- Una herencia en una cueva existe porque un cultivador murió o la escondió ahí.
- Un genio existe porque nació de dos padres concretos, con una tirada genética concreta.

**Invariante testeable:** no hay entidades huérfanas. `entity.originEventId` siempre apunta a un evento que existe (salvo las condiciones iniciales del seed).

### Ley 2 — Conservación
Las cosas no aparecen ni desaparecen: se transforman o se mueven.
- **Bienes y dinero:** si alguien gana plata, alguien la pagó. Si un tesoro está en una ruina, es porque nadie lo sacó.
- **Qi:** es un recurso físico finito por región. Los cultivadores lo **consumen**. Una región sobreexplotada se agota (ver §3).
- **Personas:** la población cambia solo por nacimientos, muertes y migraciones.
- **Conocimiento:** una técnica se pierde cuando muere su último portador y se destruye su último registro. Puede reaparecer si alguien encuentra un manuscrito… porque el manuscrito existe.

### Ley 3 — Los eventos se producen por presión, no por azar
Las causas se acumulan como **presiones** (hambre, resentimiento, ambición, sobrepoblación, agotamiento de qi, deuda, miedo). Cuando una presión sube, aumenta la probabilidad de que un agente actúe. El azar decide el **cuándo exacto** y el **cómo sale**, no el **si tiene sentido**.

```
P(acción) = f(presión, personalidad, oportunidad, conocimiento)
```

Esto da la sensación correcta: en retrospectiva todo parece inevitable, pero en el momento sorprende.

### Ley 4 — Los agentes actúan según lo que creen, no según la verdad
Un NPC decide con su **conocimiento** (incompleto, atrasado, distorsionado). Gran parte del drama sale de errores: la secta ataca porque creyó un rumor falso; el bandido roba al viajero que parecía mortal y era Core Formation.

### Ley 5 — Todo evento registra sus causas
Cada `Event` guarda `causes: CauseRef[]`: los eventos previos, presiones y creencias que lo produjeron. Esto forma un **grafo causal** del mundo.

Sirve para:
- el inspector ("¿por qué pasó esto?" → recorrer el grafo hacia atrás),
- los rumores y la historia contada por NPCs ("la secta cayó porque…"),
- el narrador, que puede explicar consecuencias sin inventarlas,
- testear que nada ocurra sin causa.

---

## 2. Qué está permitido que sea aleatorio

| Permitido | Prohibido |
|---|---|
| Condiciones iniciales del seed (geología, cosmología, constantes del mundo) | Tablas de "eventos aleatorios" que crean situaciones |
| Variación individual: genética, rasgos innatos, mutaciones de raíz espiritual | Spawnear items, bestias o NPCs porque "hace falta contenido" |
| Resultado de una acción ya decidida (tirada de resolución) | Que la suerte del jugador cree tesoros (la suerte modifica tiradas, no la realidad) |
| Ruido ambiental de bajo nivel: clima local, pequeñas fluctuaciones | Eventos que no tocan el estado del mundo |
| Elegir entre opciones casi empatadas de un agente | |

Regla práctica: **el azar elige entre posibilidades que el estado del mundo ya permite.**

---

## 3. Las capas de causa (de abajo hacia arriba)

Cada capa se apoya en la de abajo. Un cambio abajo se propaga hacia arriba.

```
7. Historia / cultura      ← memoria colectiva, ideologías, rivalidades heredadas
6. Organizaciones          ← familias, clanes, sectas, naciones como agentes
5. Agentes                 ← NPCs con necesidades, rasgos, creencias, objetivos
4. Información             ← quién sabe qué, rumores, propagación
3. Economía / demografía   ← producción, escasez, precios, nacimientos, muertes, migración
2. Ecología                ← plantas, bestias espirituales, poblaciones, cadenas tróficas
1. Física + metafísica     ← geología, clima, hidrología, flujo de qi, venas espirituales
0. Leyes del mundo (seed)  ← constantes: cuánto qi hay, cómo funciona el cultivo, el cielo
```

### Capa 0–1: el qi se comporta como agua
En vez de ser una "estadística de zona", el qi es un **campo físico**:
- Se origina en **fuentes** (venas espirituales en la geología, puntos de convergencia, cuerpos celestes según la cosmología).
- **Fluye y se acumula** como la hidrología: valles, picos y cuevas lo concentran.
- **Se consume**: cultivar, refinar píldoras, formar arrays y crecer plantas espirituales gastan qi.
- **Se regenera** lento desde las fuentes.

Consecuencias que salen solas, sin escribirlas:
- Las sectas se ubican sobre venas porque los fundadores buscaron qi.
- Una secta que crece demasiado agota su montaña → declive, migración o guerra por otra vena.
- Una era de "recuperación espiritual" es literalmente el qi regenerándose tras siglos de sobreexplotación (o tras un cataclismo).
- Un lugar con qi inusual está ahí porque hay algo debajo, y ese algo es descubrible.

### Capa 2: ecología con poblaciones
Plantas y bestias tienen poblaciones por región que crecen, compiten y se comen. Las bestias espirituales necesitan qi y presas.
- Si los aldeanos sobrerecolectan hierbas, las hierbas desaparecen y suben los precios.
- Si cazan al depredador, los herbívoros arrasan cultivos.
- Si el qi sube, aparecen bestias más fuertes migrando desde otras zonas, que antes no podían vivir ahí.

### Capa 3: economía y demografía
Cada asentamiento produce, consume y comercia. **La escasez es el motor más grande de causalidad**: hambre → migración, robo, bandidaje, revueltas, venta de hijos a sectas, guerras.

### Capa 4: información
Los hechos viajan por contactos (comerciantes, viajeros, discípulos, espías) con retraso y distorsión. Que un evento sea conocido o no es parte de la causalidad: una masacre que nadie conoce no genera venganza.

### Capas 5–6: agentes y organizaciones
Toman decisiones por utilidad a partir de presiones y creencias (ver VISION). Las organizaciones son agentes compuestos: deciden a través de sus líderes y facciones, no con una IA abstracta. Una secta no "declara la guerra": su anciano ambicioso convence al consejo porque la vena se agota y tiene un rencor personal. Detalle en [organizations.md](organizations.md).

### Capa 7: historia y cultura
Los eventos importantes se vuelven **memoria colectiva**: festivales, odios entre pueblos, tabúes ("no se entra al valle norte"), leyendas (a veces falsas). La cultura cambia el comportamiento de los agentes, y así cierra el ciclo.

---

## 4. Ejemplo de cadena causal completa

Nada de esto está escrito a mano: sale de las reglas.

```
[seed]  Falla geológica al norte → vena de qi de metal en el Monte Hierro
  ↓
[año -400] Cultivador errante con afinidad metal la encuentra (buscaba qi; su conocimiento lo guió)
  ↓     funda una escuela → crece → Secta del Filo de Hierro
[año -250] La secta sobrecultiva: el qi del monte baja 40%
  ↓     presión: escasez de qi + ancianos ambiciosos
[año -180] Guerra contra la Secta Nube Azur por la vena del Lago Jade
  ↓     la ciudad de Yunshan, en medio, es arrasada → ruinas
  ↓     el anciano Wu muere en las ruinas con su anillo espacial (conservación: el anillo sigue ahí)
[año -180→0] Los sobrevivientes de Yunshan migran a Qingshui → odio cultural hacia el Filo de Hierro
  ↓     la región, sin cultivadores que consuman, recupera qi lentamente
[año 0]  Vos nacés en Qingshui. Tu abuela cuenta que "el valle de las ruinas está maldito"
         (memoria colectiva: hubo muertes; además el qi residual atrae bestias → el tabú tiene base real)
  ↓
Si vas a las ruinas, el anillo de Wu está ahí porque nadie que lo supiera sobrevivió.
Si lo usás en público, alguien del Filo de Hierro puede reconocer el sello de Wu…
```

---

## 5. El problema técnico: escala y "zoom" consistente

Simular todo a máximo detalle durante 1000 años es imposible. La solución es **la misma causalidad a distintas resoluciones**:

### 5.1 La historia es la simulación, corrida rápida
No hay un "generador de historia" separado con eventos inventados. La historia se produce corriendo **las mismas reglas en modo agregado**:
- Resolución alta (cerca del jugador): individuos, días, acciones concretas.
- Resolución baja (lejos o en el pasado): poblaciones, organizaciones, años; las personas son estadísticas salvo las importantes (Tier 3).

Las reglas agregadas tienen que ser **coherentes** con las individuales (p.ej. la tasa de bandidaje agregada ≈ lo que resultaría de simular individuos con esa escasez). Se puede calibrar corriendo ambas versiones y comparando.

### 5.2 Materialización consistente
Cuando el jugador llega a una zona que existía solo como estadística, se generan individuos que **respeten el pasado registrado**:
- Si hubo una hambruna hace 20 años, la pirámide de edades tiene un hueco y algunos tienen rasgos adquiridos por esa hambruna.
- Si la aldea odia al Filo de Hierro, ese odio está en sus creencias.
- Cada NPC materializado recibe una biografía resumida generada desde los eventos de su lugar, no inventada.

Una vez materializado, **es un hecho**: queda guardado y ya no puede contradecirse.

### 5.3 Detalle diferido ("se fija al mirar")
Hay cosas que no hace falta decidir hasta que alguien mire (qué hay exactamente en la cueva). Se pueden dejar **sin resolver**, con restricciones (qué tuvo que pasar ahí) y resolverlas al observarlas. Esto solo se permite si el resultado respeta las restricciones del grafo causal. Si nadie murió ahí, no puede haber herencia.

---

## 6. El jugador no tiene canales especiales

Tus acciones entran al mundo por **los mismos canales** que las de cualquier NPC: cambian estado, crean eventos con causas, generan memorias y rumores. No hay scripts de "reacción al jugador". Si un NPC reacciona a vos es porque tu acción le llegó (la vio, se la contaron) y le movió una presión.

---

## 7. Karma como mecánica literal (decidido: sí → [heaven-karma.md](heaven-karma.md))

En el xianxia, el karma (因果, "causa y efecto") es parte de la metafísica del mundo. Ya que el grafo causal existe, se puede volver **física del mundo**:
- Los hilos kármicos son los enlaces del grafo entre agentes (deudas, muertes, salvaciones).
- Ciertas técnicas o cultivadores muy fuertes pueden **percibir** esos hilos (adivinación, detectar quién mató a alguien: [divination.md](divination.md)).
- Las tribulaciones celestiales pueden escalar según la deuda kármica acumulada.

Encaja perfecto con la temática y no rompe la regla: no inventa nada, solo **lee** lo que ya pasó.

---

## 8. Implicancias de implementación

- `Event { id, time, type, actors, location, outcome, data, emissions, causes: CauseRef[] }` (quién lo percibe se calcula: ver [perception.md](perception.md))
- `CauseRef = { kind: 'event' | 'pressure' | 'belief' | 'state', ref, weight }`
- Toda entidad tiene `originEventId`.
- Los sistemas se escriben como **procesos**: `precondiciones(estado) → presión → decisión/tirada → cambios de estado + eventos con causas`.
- Ledger de conservación para bienes, dinero y qi por región, con tests de que los totales cuadren.
- Inspector: comando `why <eventId>` que recorre el grafo causal hacia atrás, más el mapa de presiones y los demás comandos de §10.
- Tests de invariantes: no hay huérfanos, la conservación cuadra, los eventos no tienen causas vacías (salvo el seed), y hay determinismo.
- El grafo crece mucho, así que hace falta **compactarlo**: los eventos viejos y poco importantes se resumen en eventos agregados que heredan sus enlaces.

---

## 9. Presiones como objeto

La Ley 3 dice que los eventos nacen de presiones. Para que el inspector las muestre y los tests las verifiquen, una presión es un objeto con forma fija, aunque cada sistema la calcule a su manera.

```ts
type PressureKind =
  | "hunger" | "debt" | "resentment" | "grievance" | "ambition" | "fear" | "overcrowding"
  | "qiDepletion" | "qiSurplus" | "succession" | "legitimacy" | "heavenDeficit" | "pathogenLoad"
  | "priceStress" | "beastHunger" | "faith" | "custom";

interface Pressure {
  id: PressureId;
  kind: PressureKind;
  scope: { kind: "agent" | "household" | "community" | "org" | "cell" | "region"; ref: EntityId };
  value: number;                         // 0..1, normalizada por tipo
  trend: number;                          // derivada reciente: sube o baja
  sources: CauseRef[];                    // de qué sale: eventos, estados, creencias, otras presiones
  discharges: DischargeRef[];             // procesos que la pueden descargar (motín, migración, robo, guerra, ruptura)
  lastDischarge?: EventId;
  system: SystemId;                       // quién la calcula (economy, social-structure, heaven-karma...)
}

interface DischargeRef {
  process: ProcessId;                     // el proceso del sistema que la usa como entrada
  threshold: number;                      // dónde empieza a ser probable
  hazard: number;                         // probabilidad por tick que el proceso le asigna con el estado actual
  blockers: CauseRef[];                   // lo que la frena: miedo a la represión, falta de líder, falta de armas
}
```

- **Las presiones son derivadas, no verdad aparte.** Cada sistema las calcula con una función pura del estado (hambre de un hogar = reservas, precios, deudas y miembros; resentimiento de una comunidad = relaciones con superiores concretos y con la categoría). Se cachean por tick para el inspector y para los procesos, pero borrarlas y recalcularlas da lo mismo.
- **Descarga.** Un proceso lee la presión y decide con la forma de la Ley 3: `hazard = f(presión − umbral, personalidad, oportunidad, conocimiento)` con una curva suave (sigmoide por tipo en `content/`). La tirada usa `rng.fork(process, scope, tick)`. El evento que sale guarda en `causes` un `CauseRef { kind: "pressure", ref, weight }` con el valor que tenía en ese momento.
- **Chispas.** Un evento puntual (una ejecución injusta, un precio que se dispara, un rumor) baja el umbral efectivo por un rato. Así se distingue la causa de fondo (la presión acumulada) del disparador (la chispa), y el inspector muestra los dos.
- **Alivio.** Descargar baja la presión (el motín consigue granos, la migración vacía bocas), pero no siempre del todo, y la descarga crea presiones nuevas (represión → miedo y agravio).
- **Presiones que se componen.** Una presión puede tener otras como fuente: el hambre de la región sale del hambre de los hogares; el agravio de una aldea alimenta la legitimidad del estado. El grafo de presiones es parte del grafo causal.
- **Nadie en el mundo ve una presión.** Los agentes perciben señales (precios, caras, rumores) y forman creencias; lo que deciden lo deciden sobre lo que creen (Ley 4). La adivinación por lectura metafísica puede leer presiones reales ([divination.md](divination.md) §3: el futuro como proyección de presiones).

## 10. El inspector: mapa de presiones y preguntas al grafo

El inspector (`tools/`, modo god) lee la verdad sin restricciones. Nunca corre dentro de la simulación ni la modifica.

```ts
interface PressureMapQuery {
  kind?: PressureKind[];
  area: RegionId | CellId[] | "world";
  scale: "cell" | "community" | "region";
  at: Tick;                               // un tick pasado si hay snapshot, o el actual
}

interface PressureMapCell {
  ref: EntityId;
  values: Partial<Record<PressureKind, number>>;
  trend: Partial<Record<PressureKind, number>>;
  topDischarges: { process: ProcessId; hazard: number }[];   // lo más probable que pase acá
}
```

Comandos:

| Comando | Qué muestra |
|---|---|
| `why <eventId>` | El grafo hacia atrás: eventos, presiones, creencias y estados que lo produjeron, con pesos |
| `effects <eventId>` | El grafo hacia adelante: qué causó, hasta una profundidad |
| `pressures <área> [tipo]` | El mapa: capas por tipo sobre la grilla hex (calor por valor, flechas por tendencia), con zoom de región a hogar |
| `pressure <id>` | El árbol de fuentes de una presión y sus descargas posibles con hazard y bloqueos |
| `hazard <área>` | Lo más probable que pase en ese lugar en el próximo período, ordenado por hazard × impacto |
| `plans <agente \| org>` | Proyectos e intrigas activas ([schemes.md](schemes.md)), con lo que cada participante sabe |
| `believes <agente> <hecho>` | Qué cree un agente sobre algo, con fuente y confianza, al lado de la verdad |
| `whatif <eventId> --years N` | Contrafáctico (§11) |
| `timeline <área \| entidad>` | Presiones y eventos en el tiempo: cómo subió el hambre antes del motín |

- **Snapshots.** El mapa de un tick pasado necesita snapshots de presiones (cada N ticks y en cada descarga grande); entre medio se interpola o se recalcula desde el log.
- **Lo mismo para la crónica.** La crónica final ([chronicle.md](chronicle.md)) puede usar el mapa para contar "el valle estaba por estallar cuando llegaste". Es el único momento, fuera del inspector, en que se muestra.

## 11. Contrafácticos

`whatif` responde "¿qué habría pasado si esto no ocurría?" corriendo una **rama** de la simulación desde un snapshot anterior al evento, con el evento quitado (o una acción del jugador cambiada).

- **Determinista:** la rama usa los mismos streams del RNG (`rng.fork` por proceso, entidad y tick), así que todo lo que no depende del evento quitado sale igual. La diferencia entre la rama y la historia real es el **efecto causal** del evento.
- **Solo en herramientas.** Nunca corre durante una partida para decidir nada, ni se le muestra al jugador salvo en el modo inspector. Si la crónica debería usarlo para medir el legado queda como pregunta abierta.
- **Costoso:** corre en modo agregado (LOD bajo) y con horizonte acotado. Sirve para depurar ("¿la hambruna salía igual sin la guerra?") y para calibrar.

## Tests
- Sin huérfanos: todo `originEventId` apunta a un evento que existe (salvo el seed).
- Conservación: los ledgers de bienes, dinero y qi cuadran por región y en el total.
- Ningún evento sin causas (salvo el seed y las acciones del jugador, que tienen como causa su intención).
- Determinismo: mismo seed y mismas acciones → mismo log de eventos, byte a byte.
- Presiones: recalcular desde el estado da el mismo valor que el caché; toda descarga registra la presión con su valor.
- Ningún evento de tipo "descarga" ocurre con su presión por debajo del umbral mínimo del tipo (no hay motines sin agravio).
- Contrafáctico: una rama sin cambios reproduce la historia real exactamente; quitar un evento sin efectos posteriores no cambia nada.
- El inspector nunca escribe en `WorldTruth`.

---

## Decisiones (2026-10-05)
1. **Representación del qi:** el planeta se divide en una grilla de regiones (celdas hexagonales sobre la esfera). Cada celda tiene un nivel de qi que fluye hacia sus vecinas, se acumula en valles y cuevas, y baja cuando alguien lo consume. No se simula como fluido continuo.
2. **Historia:** no es un número fijo de años; se simula por relevancia, como un embudo de resolución creciente con olvido entre épocas. Ver [deep-history.md](deep-history.md).
3. **Karma:** sí, literal. Ver [heaven-karma.md](heaven-karma.md).
4. **El Cielo:** existe como agente-ley; cultivar es rebelarse contra él y las rupturas traen tribulaciones. Ver [heaven-karma.md](heaven-karma.md).
5. **Tamaño:** un planeta entero (geografía sobre esfera). Salir del planeta queda abierto, posiblemente vía ascensión. `Realm` se modela como entidad dentro de una cosmología mayor para no cerrar la puerta.
6. **Presiones derivadas, no guardadas como verdad:** cada sistema las calcula con una función pura del estado y se cachean; toda descarga registra la presión con su valor en `causes` (§9).
7. **Inspector y contrafácticos solo en `tools/`:** leen la verdad, nunca escriben en ella ni corren durante una partida (§10, §11).

## Preguntas abiertas
- ¿La crónica debería usar contrafácticos para medir el legado ("sin vos, el valle habría...")? Propuesta: no por defecto (es caro y especulativo para el jugador); como mucho, una opción del archivo de vidas que corre en modo agregado.
- Calibración: intervalo de snapshots de presiones; curvas de hazard por tipo de descarga; cuánto baja el umbral una chispa y por cuánto tiempo.
