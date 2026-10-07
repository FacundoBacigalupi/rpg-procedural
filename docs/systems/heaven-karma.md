# El Cielo y el Karma

> Nota: este doc describe la **familia xianxia**. Otras familias de mundos cambian estas reglas; ver [metaphysics.md](metaphysics.md).

> Decisión (2026-10-05): **el Cielo existe**, y cultivar es ir en su contra. Romper reinos dispara tribulaciones. **El karma es real** y es parte de la física del mundo.

Ver también [causality.md](causality.md): el karma es el grafo causal hecho metafísica.

> Estado: §1-§2 **decididos**; §3-§10 son una **ampliación en borrador** (2026-10-05): la atención del Cielo como recurso finito que reparte por saliencia, zonas ciegas y velos, la tribulación como evento físico con energía que se puede interceptar y robar, la retribución como inclinación acotada de las tiradas (también las de los enemigos del deudor), el mérito (功德) como el lado positivo del libro, y la fortuna colectiva (气运) como algo que se deriva de personas y de tierra, no de un favor del Cielo.

Depende de: [causality.md](causality.md) (el karma es el grafo causal hecho metafísica; el azar solo elige entre posibilidades), [cultivation.md](cultivation.md) (umbrales, transgresión, rupturas, fundamento, §14 volver a tener cuerpo), [spirits.md](spirits.md) (el ciclo, las Fuentes, espíritus anclados), [metaphysics.md](metaphysics.md) (qué mundos tienen Cielo y karma), [planet-gen.md](planet-gen.md) (venas, campo de qi, fuerza del Cielo en la cosmología), [elements.md](elements.md) (el rayo de tribulación como derivado, campos), [perception.md](perception.md) (lo que se ve de una tribulación; leer karma), [npc-psychology.md](npc-psychology.md) (demonios internos, creencias que guían la conducta), [contracts.md](contracts.md) (juramentos y su peso en el libro), [living-world.md](living-world.md) (calamidades, bestias, desastres con causa). Lo usan: [cultivation.md](cultivation.md) (tribulaciones, límite de vida), [contracts.md](contracts.md) (ejecutor kármico, atención finita), [divination.md](divination.md) (lectura de karma, reacción del Cielo, velos), [secret-realms.md](secret-realms.md) (el Cielo ve menos adentro), [war.md](war.md) (deudas de sangre en masa, atención sobre los campos de batalla), [state.md](state.md) (el Cielo no elige dinastías; 气运 de naciones), [organizations.md](organizations.md) (§15: karma y 气运 de organizaciones), [family-lineage.md](family-lineage.md) (deudas que pasan al linaje), [crafts.md](crafts.md) (formaciones que ocultan, materiales de rayo), [chronicle.md](chronicle.md) (karma abierto y cobro en el epílogo), [spirits.md](spirits.md) (el cobro en las Fuentes).

## Principios
1. **El libro siempre lee la verdad; la acción gasta atención.** Registrar karma no cuesta nada y no se esconde de verdad (solo se tapa de la lectura de otros). Actuar (tribulaciones, retribución, calamidades) cuesta atención, que es finita.
2. **El Cielo solo actúa con sus herramientas.** Nunca crea entidades ni hechos de la nada: inclina el azar entre lo que el estado ya permite, dispara tribulaciones con energía que sale del campo, cobra en las Fuentes.
3. **Toda acción del Cielo es un evento con causa.** Cada tribulación, cada inclinación de tirada y cada calamidad registra en `causes` la deuda, la transgresión o el desequilibrio que la provocó.
4. **El Cielo no elige.** No tiene favoritos, no elige dinastías ni elegidos. La fortuna colectiva sale de personas y de tierra; el mérito sale de actos.
5. **Lo que se cree no es lo que es.** Cada cultura tiene su teoría del Cielo, del mérito y de la fortuna; los NPC actúan según la suya, y la regla real se descubre con el mismo mecanismo que cualquier ley (discovery).
6. **Determinista.** La atención se reparte con una función pura del estado; las tiradas inclinadas usan el mismo stream del RNG (`rng.fork("heaven", tick)`) con pesos modificados, nunca tiradas extra.

---

## 1. El Cielo como agente

El Cielo (天道, el Dao Celestial) no es un dios con personalidad humana. Es un **agente-ley**: tiene objetivos, actúa solo a través de las leyes del mundo y sus acciones también quedan registradas como eventos con causas. No hace milagros arbitrarios.

### Qué quiere
- **Mantener el ciclo:** nacer, envejecer, morir, volver al ciclo. Todo ser tiene un **límite de vida** asignado.
- **Mantener el equilibrio del qi:** el qi del mundo vuelve al Cielo y circula.

### Por qué el cultivo es una rebelión
Cultivar es **robarle al Cielo**: absorber qi que no te corresponde y estirar una vida más allá de su límite. Cada reino roto es una deuda más grande con el orden natural.

### Cómo actúa (sus únicas herramientas)
| Herramienta | Cuándo | Qué depende de |
|---|---|---|
| **Tribulación** | Al romper ciertos reinos (los que cruzan un "umbral de transgresión") | Tamaño del salto, karma acumulado, talento (los genios atraen más atención), atención actual del Cielo sobre la región (§3, §5) |
| **Límite de vida** | Siempre | Reino de cultivo, constitución, técnicas, karma (el desgaste del cuerpo es otro reloj: [body-health.md](body-health.md) §10) |
| **Retribución kármica** | Cuando una deuda kármica es enorme | Inclina tiradas (las del deudor y las de quienes lo enfrentan, §6) o dispara calamidades. Nunca crea entidades de la nada: usa lo que ya existe (bestias cercanas, enemigos reales, el clima) |
| **Demonios internos** | En rupturas y meditación profunda | Memorias traumáticas, culpa y deudas kármicas del propio cultivador (enlace con psicología) |
| **Cobro en las Fuentes** | Cuando un alma cruza las Fuentes Amarillas | Esencia refinada, años de más y karma neto del alma (ver abajo) |
| **Calamidades** | Desequilibrio grave de qi en una región (sobreexplotación, arrays prohibidos) | Deslaves de qi, sequías espirituales, mutaciones de bestias |

### El cobro en las Fuentes
Cruzar las Fuentes Amarillas (spirits §3b) es **saldar la cuenta con el Cielo**. Antes de volver a nacer, al alma se le **muele lo que no era suyo**, y lo molido vuelve al ciclo (conservación: el qi y la sustancia del alma no desaparecen, vuelven al Cielo y al mundo).

```ts
interface SoulToll {
  refinedEssence: number;      // esencia que el cultivo fijó en el alma por encima de lo mortal
  stolenYears: number;         // años vividos más allá del límite natural
  netKarma: number;            // deudas menos méritos (功德, §7) todavía abiertos en el libro
  total: number;               // lo que se cobra, en la misma unidad que la fuerza del alma
}
```

- **Gradual, sin frontera:** un mortal pasa casi entero (no tomó nada). Un cultivador de los primeros umbrales pierde parte del alma: renace más débil y sin recuerdos. Uno alto, con mucho robado y mucha deuda, puede **disolverse del todo** (形神俱灭): si el cobro alcanza la fuerza del alma, no queda nada que renazca.
- **El mérito descuenta:** las deudas saldadas en vida y los méritos (vidas salvadas, deudas de vida a favor, obras para el ciclo) bajan el cobro. Un cultivador que pagó lo que debía pasa mejor que uno que lo robó todo.
- **Lo que sobrevive renace:** la fuerza que queda después del cobro decide cuánto resiste la sopa del olvido (spirits §3d). Por eso los recuerdos de vidas pasadas son raros en los cultivadores fuertes: pagan con eso.
- **Solo se cobra a quien cruza.** El alma que evita las Fuentes (espíritu anclado, renacer a propósito, posesión, cuerpo construido: cultivation §14) no paga, pero tampoco salda: su karma sigue abierto y su cuenta crece. Por eso los cultivadores fuertes temen la muerte y buscan técnicas de evasión, méritos o maneras de saldar antes de morir: es un motor de sus decisiones (npc-psychology: utilidad).
- **Creencias, no verdad:** las culturas creen cosas distintas sobre las Fuentes (que el mérito se compra con ofrendas, que los inmortales no mueren nunca, que el juicio lo hace un rey de los infiernos). Lo que un NPC cree es lo que guía su conducta; la regla real se puede descubrir (discovery).
- **Variante por mundo:** en algunos mundos el ciclo **rechaza** a los cultivadores (metaphysics §6): el alma que cultivó no puede cruzar y solo le quedan ser espíritu, evadir o disiparse.

### La fuerza del Cielo varía por mundo (y explica la era)
El estado del Cielo es una **variable del seed que también evoluciona**:
- **Cielo fuerte:** las tribulaciones son brutales, el techo de cultivo es bajo y los cultivadores son escasos. Da un mundo temprano o reprimido.
- **Cielo debilitado** (por una guerra antigua contra inmortales, por qi robado durante milenios): se cultiva fácil y hay inmortales. Es una era dorada, pero quizás inestable.
- **Cielo en recuperación:** viene después de un cataclismo, la cultivación se cierra de a poco y los viejos maestros mueren en sus tribulaciones.

Así la era del mundo **tiene causa**: no es un dial aleatorio, es el resultado de la relación histórica entre los cultivadores y el Cielo.

### Lo que los mortales creen del Cielo
Nadie conoce la verdad completa. Cada cultura tiene su **interpretación** (religión, filosofía, tabúes), que forma parte de sus creencias. Algunas pueden estar equivocadas. Las sectas pueden tener doctrinas opuestas sobre cómo engañar, apaciguar o desafiar al Cielo.

### Ascensión
Romper el último reino del planeta = **dejar el mundo** hacia un plano superior. Es la "salida" del planeta. El diseño deja `Realm` como una entidad dentro de una cosmología mayor, pero **por ahora solo existe un planeta**. Qué hay arriba, cómo es la ascensión como evento y qué pasa con la partida está en [cosmology.md](cosmology.md) §4-§7: ascender termina la vida en este mundo.

---

## 2. Karma

El karma son **enlaces entre agentes** creados por eventos. Lo registra el Cielo y lo percibe quien tenga las técnicas adecuadas.

```
KarmicBond {
  from, to            // agentes (personas, a veces organizaciones)
  kind                // life_debt, blood_debt, master_disciple, oath, betrayal, kinship, grace, theft...
  weight              // magnitud
  polarity            // deuda que el 'from' tiene con el 'to', o al revés
  originEventId       // el evento que lo creó (procedencia)
  resolved?           // si se saldó
}
```

### Cómo se crea
Solo con eventos reales. Algunos ejemplos:
- Matar a alguien deja una deuda de sangre con la víctima, y por extensión con su linaje y su maestro. **El peso depende de la causa y de la víctima** (aprobado 2026-10-06):
  - matar por codicia o por gusto pesa entero;
  - en defensa propia o de otros, el peso es mínimo;
  - si la víctima carga mucho karma negativo (asesino, tirano, ladrón de vidas), el peso también es mínimo, porque el Cielo no castiga cobrar una deuda que ya existía; si no fuera así, habría que perdonar a todos, y eso es más peligroso;
  - rematar a quien se rindió o a un indefenso inocente pesa más que el caso base.
  El Cielo pesa con la **verdad** de la causa y del karma de la víctima, no con lo que el matador cree: quien mata a un inocente creyéndolo culpable carga la deuda completa.
- Salvar una vida crea una deuda de vida a tu favor.
- Romper un juramento genera un karma fuerte y casi siempre atrae retribución. Cómo los compromisos (juramentos, contratos, vínculos solemnes) alimentan este libro, con peso según solemnidad, consentimiento y sinceridad reales, está en [contracts.md](contracts.md) §9.
- Tomar discípulos crea un vínculo maestro–discípulo que se hereda en las dos direcciones.
- Robar la herencia de un muerto te ata a su karma, incluidos sus enemigos.
- El parentesco de sangre crea vínculos `kinship` desde la concepción, sepan o no los involucrados quién es su padre; cómo se heredan las deudas al linaje está en [family-lineage.md](family-lineage.md) §5 y §8.

### Cómo se salda
- Pagar la deuda: devolver el favor o salvar a quien te salvó.
- Que se cumpla la venganza: la deuda de sangre se cobra.
- El tiempo y la muerte de todos los involucrados: el vínculo se debilita, pero las deudas enormes se heredan al linaje.

### Qué afecta
- **Tribulaciones:** más karma negativo hace que sean más fuertes.
- **Demonios internos:** el karma no saldado alimenta los demonios en las rupturas.
- **Suerte:** las deudas grandes inclinan tiradas, acotadas y solo con atención (§6; nunca crean cosas).
- **Percepción:** adivinadores y técnicas kármicas pueden **leer** los enlaces: quién mató a alguien, a quién le debés, si alguien te miente sobre su pasado.
- **Comportamiento:** los cultivadores que creen en el karma lo usan al decidir ("no lo mato, no quiero esa deuda antes de mi tribulación").

### Regla
El karma **solo lee** el grafo causal y **solo actúa** a través de las herramientas del Cielo. No es una excusa para que pasen cosas sin causa: si te llega una retribución, la causa es tu deuda y el evento queda registrado.

---

## 3. La atención del Cielo

El Cielo registra todo, pero no puede **actuar** sobre todo a la vez. Su atención es un recurso finito que reparte cada tick (de la escala que corresponda) entre lo que más reclama.

```ts
interface HeavenState {
  strength: number;                          // §1: la fuerza del Cielo en este mundo y era (evoluciona)
  attentionCapacity: number;                 // sale de strength: un Cielo herido atiende menos cosas a la vez
  allocations: AttentionAllocation[];
  wounds: HeavenWound[];                     // daños históricos que crean zonas ciegas (§4)
}

interface AttentionAllocation {
  target: AgentId | RegionId;
  salience: number;                          // cuánto reclama (abajo)
  share: number;                             // fracción de la capacidad que recibe este tick
  reasons: AttentionReason[];                // con eventos como causas
}

type AttentionReason =
  | { kind: "transgression"; thresholdId: ThresholdId }   // una ruptura en curso o inminente
  | { kind: "karmic_debt"; bonds: KarmicBondId[] }         // deudas enormes sin saldar
  | { kind: "qi_imbalance"; region: RegionId; deficit: number } // sobreexplotación (§6)
  | { kind: "cycle_evasion"; soul: SoulId }                // almas que evitan las Fuentes, longevidad robada
  | { kind: "prying"; reader: AgentId }                    // quien espía asuntos del Cielo (divination §6)
  | { kind: "mass_death"; event: EventId };                // guerras, masacres, calamidades: el ciclo desbordado
```

- **Saliencia:** sale del tamaño de la transgresión (umbral, talento, velocidad), del peso de las deudas abiertas, del déficit de qi de una región, de cuánto tiempo lleva alguien evadiendo el ciclo. Lo más grande se lleva más atención.
- **Reparto:** proporcional a la saliencia con rendimientos decrecientes; lo que queda por debajo de un mínimo no recibe nada ese tick (el Cielo "no llega"). Es una función pura del estado.
- **Qué cambia la atención:** la **fuerza de la tribulación** (cultivation §6: la "atención actual del Cielo sobre la región"), la **prontitud** de la retribución (§6) y la **magnitud** de las calamidades. No cambia el registro: el karma de lo que pasa sin atención se anota igual y se cobra después.
- **Saturación:** en una era de oro con miles de rupturas, en una guerra con masacres, en una calamidad, la atención se reparte fina: las tribulaciones de los demás bajan un poco, las deudas esperan. Los cultivadores lo saben (o lo creen): romper durante una gran guerra es una estrategia, y algunos **provocan** distracciones para romper tranquilos (schemes).
- **Memoria del Cielo:** lo que no se atendió no se olvida. La deuda sigue en el libro y la saliencia crece con el tiempo hasta que la atención llega. Postergar no es escapar.
- **La atención se percibe a medias:** los sensibles notan "el cielo pesado" sobre un lugar (perception: un canal más, con ruido), las nubes de tribulación se ven desde lejos, los adivinos la leen (divination). Nadie ve el reparto completo.

## 4. Zonas ciegas y velos

Lugares y cosas donde la atención del Cielo **no llega o llega débil**. Nunca tapan el registro: tapan la acción.

| Tipo | Por qué | Efecto |
|---|---|---|
| **Reinos secretos** | La barrera separa el espacio (secret-realms §9) | El karma se anota; las tribulaciones esperan a la salida |
| **Heridas del Cielo** | Una guerra antigua contra inmortales, un artefacto que lo hirió, una calamidad que rompió el ciclo local (`HeavenWound`, deep-history) | Región donde la capacidad local es baja: se cultiva con menos tribulación y la retribución tarda; atrae cultivadores, sectas y sus problemas |
| **Formaciones de ocultamiento** (遮天) | Grafos sobre el campo que desvían o enmascaran la saliencia (crafts) | Cuestan esencia continua; se rompen, se agotan, se detectan; esconden una ruptura un tiempo |
| **Artefactos y técnicas de velo** | Tapan la firma de un alma o de sus hilos | Bajan la saliencia de una persona; también tapan la lectura de karma de otros (divination §6) |
| **Lugares extremos** | Yin profundo, el fondo del mar, el corazón de una tormenta de qi | Atención reducida por la física del campo; peligrosos por sí mismos |

```ts
interface HeavenWound {
  region: RegionId;
  depth: number;                             // cuánto baja la capacidad local
  healing: number;                           // ritmo al que el Cielo la cierra (más rápido si es fuerte)
  originEventId: EventId;                    // la guerra, el artefacto, la calamidad
}
```

- **Postergar con costo:** lo que pasa adentro de una zona ciega se cobra al salir. La verdad: no hay interés por haber esperado, pero sí por todo lo que se acumuló mientras tanto (más karma, más transgresión). Las culturas creen distintas cosas (que salir es peor, que adentro se escapa para siempre).
- **Las zonas ciegas tienen dueño:** se vuelven territorio disputado (sectas, refugios de demoníacos, ermitaños que viven siglos ahí), con consecuencias sociales y económicas (secret-realms, organizations).
- **Las heridas se cierran:** con un Cielo fuerte rápido, con uno débil quizás nunca; cerrarse puede caer como una ola de tribulaciones postergadas sobre todos los que se refugiaban ahí.

## 5. La tribulación como evento físico

Una tribulación no es un castigo abstracto: es un **evento físico** con energía, forma, duración y lugar (cultivation §6).

```ts
interface Tribulation {
  target: AgentId;
  cause: { threshold: ThresholdId; karma: KarmicBondId[]; attentionShare: number };
  waves: TribulationWave[];                  // rayos, fuego del corazón, viento que disuelve, pruebas del corazón
  energy: number;                            // total: sale del campo (el Cielo concentra qi del cielo y la región; conservación)
  area: RegionId;                            // dónde cae: el lugar elegido para romper
  participants: AgentId[];                   // quien ayuda, quien estorba, quien roba (§5b)
  originEventId: EventId;                    // el intento de ruptura
}

interface TribulationWave {
  kind: "lightning" | "heart_fire" | "dissolving_wind" | "heart_trial" | "custom";
  element: ElementVector;                    // elements: el rayo es un derivado
  energy: number;
  targeting: "target" | "participants" | "area";
}
```

- **Energía con origen:** el Cielo junta qi de la columna de cielo y de la región para formar la tribulación. La región queda temporalmente empobrecida; las tribulaciones grandes dejan secuelas (suelos quemados, qi de rayo residual, bestias espantadas).
- **Atacar y templar:** cada ola daña lo que golpea (cuerpo, meridianos, alma, artefactos) y, si se aguanta, **templa** (cultivation §7: la calidad de la ruptura). Por eso los genios quieren tribulaciones fuertes y los débiles las temen.
- **Visible:** las nubes se juntan horas o días antes; todos ven el fenómeno (perception), y llegan curiosos, oportunistas, ladrones y enemigos.

### 5b. Robar el rayo de una tribulación ajena
El rayo de tribulación es energía pura y templadora. Se puede **interceptar**:
- **Cómo:** pararse en la zona y atraerlo (pararrayos de formación, artefactos de metal y madera, técnicas de cuerpo de rayo), o capturarlo en materiales (crafts: madera golpeada por rayo, núcleos de rayo).
- **Lo que gana el ladrón:** templado del cuerpo o del alma, material de forja raro, a veces comprensión del Dao del rayo (discovery: insight).
- **Lo que pierde el dueño:** menos templado (ruptura de menor calidad) o, si el robo es torpe, una ola que llega desordenada y más peligrosa.
- **Lo que paga el ladrón:** entrar en la tribulación es **ser parte de ella**. La atención del Cielo lo incluye: las olas siguientes pueden apuntarle (`targeting: "participants"`), y su propia transgresión y karma se suman al cálculo. Además, roba a alguien que estaba en su momento más vulnerable: deuda kármica con el dueño (y un enemigo seguro si sobrevive).
- **Ayudar también es entrar:** el maestro que recibe olas por su discípulo, la secta que pone una formación. Comparten riesgo y karma (cultivation §6), pero con polaridad inversa: el dueño queda en deuda con ellos.

## 6. La retribución como inclinación de las tiradas

El Cielo cobra deudas y desequilibrios **inclinando el azar**: nunca agrega hechos, solo cambia los pesos entre lo que el estado ya permite (causality §5, Regla 5).

```ts
interface FortuneTilt {
  debtor: AgentId;                           // a quién se le cobra
  magnitude: number;                         // acotada: nunca vuelve probable lo imposible
  scope: TiltScope[];                        // qué tiradas toca
  cause: KarmicBondId[] | QiDebtId;          // la deuda que la justifica
  attentionShare: number;                    // sin atención no hay inclinación
}

type TiltScope =
  | "debtor_rolls"                           // sus propias tiradas: accidentes, rupturas, búsquedas
  | "opponent_rolls"                         // las tiradas de quien actúa contra él: el enemigo que lo busca lo encuentra, el golpe entra
  | "environment_rolls";                     // bestias, clima, derrumbes cerca: lo que ya podía pasar pasa más cerca

interface QiDebt {
  debtor: AgentId | OrgId;                   // quien saca más de lo que la región repone
  region: RegionId;
  amount: number;                            // déficit acumulado sobre la reposición natural (planet-gen)
  originEventIds: EventId[];                 // formaciones de drenaje, cosechas de tesoros, matanza de bestias espirituales
}
```

- **Sobreexplotar:** drenar una vena, arrasar los tesoros naturales de una región, matar bestias espirituales en masa, formaciones que chupan el campo. El déficit sobre la reposición natural es una `QiDebt`. Una organización que lo hace por orden reparte la deuda entre quienes ordenaron y ejecutaron (organizations §15).
- **A favor de los enemigos:** la inclinación más fuerte no es la mala suerte del deudor sino la **buena suerte de quien lo enfrenta**: el rival que lo busca encuentra la pista, la emboscada no se descubre, la bestia que defiende su territorio llega a tiempo. Así el Cielo actúa a través de agentes reales con motivos reales.
- **Acotada:** `magnitude` tiene un techo por mundo y era; un 1 en 1000 no se vuelve seguro. Mover un poco muchas tiradas es la forma: el deudor nota que "nada le sale".
- **Sin atención no hay inclinación:** en zonas ciegas, en eras saturadas, la deuda espera (§3).
- **Se salda:** devolver el qi (restaurar la vena, plantar, sembrar tesoros jóvenes, liberar bestias), pagar a los dañados, o que el cobro se cumpla (una calamidad que cae sobre el deudor y lo arruina).
- **Calamidades:** cuando el déficit de una región es enorme, la descarga ya no es inclinación sino evento (deslave de qi, sequía espiritual, mutación de bestias: living-world), que cae sobre la región entera, culpables e inocentes. Las calamidades no apuntan; la gente igual las lee como castigo.

## 7. Mérito (功德)

El lado positivo del libro: lo que se hizo **a favor del ciclo y del equilibrio**.

```ts
interface Merit {
  holder: AgentId;
  amount: number;
  sources: { kind: MeritKind; eventId: EventId; weight: number }[];
}

type MeritKind =
  | "life_saved"                             // salvar vidas (más si había costo propio)
  | "cycle_restored"                         // liberar espíritus anclados, cerrar una herida, enterrar a los muertos
  | "balance_restored"                       // restaurar venas, sellar una calamidad, frenar a un sobreexplotador
  | "debt_paid"                              // saldar deudas propias
  | "provision";                             // sostener vidas a escala: un dique, un granero en una hambruna, una medicina compartida
```

- **Qué hace:** descuenta en el cobro de las Fuentes (§1), amortigua tribulaciones (menos energía en las olas de castigo, no en las de templado) y reduce la inclinación de las tiradas por deudas.
- **Lee la verdad:** cuenta el acto y sus consecuencias reales, no la fama. Salvar a alguien para usarlo pesa menos (sinceridad real, como en contracts §9); el santo de fama que en secreto masacró tiene la cuenta que tiene.
- **No se compra:** las ofrendas, los templos y las donaciones valen solo si sostienen vidas de verdad. Muchas culturas creen otra cosa (comprar mérito, perdones), y ese mercado de creencias es parte de la economía religiosa (living-world: religiones; [spirits.md](spirits.md) §11).
- **No se transfiere:** el mérito de un ancestro no limpia a los nietos; las deudas enormes sí pasan al linaje (§2). Es asimétrico a propósito: el Cielo cobra más fácil que lo que paga.
- **Visible a medias:** en algunos mundos el mérito grande se percibe (un aura dorada para quien ve karma); en otros es invisible. Parámetro del mundo (metaphysics).

## 8. Fortuna colectiva (气运)

En xianxia se habla de la fortuna de una secta, de un clan, de una nación. Acá **no es un favor del Cielo** (el Cielo no elige, principio 4): es una **cantidad derivada** de cosas reales.

```ts
interface CollectiveFortune {
  holder: OrgId | PolityId;
  land: number;                              // 地运: el qi de las venas y lugares que controla (planet-gen), y su salud
  people: number;                            // 人运: el balance kármico de quienes lo sostienen y actúan en su nombre
  heavenTilt: number;                        // la suma de las inclinaciones (§6) que caen sobre sus miembros en sus asuntos
  derivedAt: Tick;                           // se recalcula, no se guarda como verdad independiente
}
```

- **Tierra (地运):** las venas, los valles de qi, los tesoros naturales del territorio. Es física: se conquista, se drena, se cuida. Una nación que pierde su vena principal (por guerra, por agotamiento, por una formación enemiga que la desvía) pierde algo real: menos cultivadores, menos tesoros, peores cosechas espirituales. Las "venas de dragón" (龙脉) de las culturas son esto más la creencia.
- **Gente (人运):** el agregado del karma y el mérito de los miembros y de los que actúan en su nombre, más los vínculos de la población con ella (gratitud real por protección, deudas de sangre por masacres). No es karma de la organización (organizations §15: el karma es de personas): es la **suma** de las personas, que se puede leer como un todo.
- **Efecto:** es solo la suma de lo que ya existe. Una secta con muchos miembros endeudados sufre la inclinación de todos ellos en sus asuntos comunes (sus expediciones fallan, sus enemigos aciertan); una con mérito y venas sanas prospera porque tiene recursos y menos cobro. No hay un dado de fortuna aparte.
- **Robar fortuna:** en las culturas, "robar el 气运 de una nación" es una fantasía y una práctica. Lo real: desviar o drenar sus venas (formaciones), matar o corromper a quienes la sostienen, cargarla de deuda (empujarla a masacres). Todo con causa, todo con karma.
- **Lo que se cree:** las cortes tienen observadores de 气运 (state, divination), las sectas hacen rituales para "fijar" la fortuna, los adivinos dicen que una dinastía "agotó su fortuna". Leen señales reales (venas, deudas, inclinaciones) con interpretaciones culturales.

## 9. El jugador y el narrador
- **El jugador nunca ve los números:** ni su karma, ni su mérito, ni la atención, ni la inclinación. Ve consecuencias (todo le sale mal, la tribulación fue brutal, una ola apuntó al que robaba) y lo que su personaje percibe o lee con técnicas (divination, perception: leer karma con ruido).
- **Puede jugar con el Cielo:** romper en una zona ciega o durante una gran guerra, robar el rayo de un rival, saldar deudas antes de una ruptura, buscar mérito, drenar una vena enemiga, esconderse con un velo. Cada cosa con su costo.
- **El narrador** cuenta lo que el personaje percibe: nubes, peso en el aire, mala racha, el rayo que se desvía hacia otro. Nunca dice "el Cielo te castiga" salvo como creencia del personaje o de quienes lo rodean.
- **La crónica final** sí puede mostrar el libro: deudas abiertas, mérito, el cobro (chronicle §8).

## 10. Escala (LOD)
- **Tier 0:** atención por región como agregado; tribulaciones y retribuciones de la historia agregada como tasas según fuerza del Cielo, densidad de cultivadores y déficit de qi; 气运 de naciones como agregado de tierra y deudas.
- **Tier 1-2:** asignaciones de atención explícitas para los cultivadores fuertes, las regiones con déficit grande y las tribulaciones en curso; zonas ciegas con dueño.
- **Tier 3-4:** tribulaciones como eventos con olas, participantes e intercepción; inclinación aplicada a cada tirada del jugador y de quienes lo rodean.
- **Costo:** el reparto se recalcula por escala de tiempo (no cada segundo de juego); el libro es un grafo de vínculos que se poda por peso y por resolución.

## Implementación
- **Fase 3:** `QiDebt` por sobreexplotación en la economía de recursos; inclinación de tiradas mínima (solo `debtor_rolls`).
- **Fase 4:** `HeavenState` con capacidad y reparto por saliencia; tribulaciones como eventos con olas y energía tomada del campo; ayudar e interceptar; mérito como fuente de descuento en el cobro.
- **Fase 5:** zonas ciegas (reinos secretos, formaciones de ocultamiento, lugares extremos); inclinación a favor de los enemigos (`opponent_rolls`, `environment_rolls`); calamidades como descarga del déficit.
- **Fase 6:** 气运 derivado para organizaciones (tierra + gente), venas como territorio disputado.
- **Fase 7:** heridas del Cielo en la historia profunda, evolución de la fuerza del Cielo por era, olas de tribulaciones al cerrarse una herida.

## Tests
- **El registro no depende de la atención:** el mismo acto deja el mismo `KarmicBond` dentro y fuera de una zona ciega.
- **Atención finita:** con N tribulaciones simultáneas, la fuerza media de cada una baja respecto a una sola, y la suma de shares nunca supera la capacidad.
- **Conservación:** la energía de una tribulación sale del campo de la región y vuelve (residuo, qi disperso); interceptar no crea energía.
- **Inclinación acotada:** ninguna tirada inclinada supera el techo de `magnitude`; con atención cero, la distribución es la original.
- **Sin entidades nuevas:** la retribución nunca crea agentes ni objetos; solo aparecen eventos que ya eran posibles.
- **气运 derivado:** recalcular la fortuna desde las venas y los vínculos da el mismo valor que el guardado; no hay estado independiente.
- **Determinismo:** mismo seed, mismas acciones → mismo reparto de atención, mismas tribulaciones y mismas tiradas inclinadas.

## Decisiones tomadas en esta ampliación (revisables)
- El libro siempre registra; la atención solo limita la acción, y lo no atendido se cobra después sin interés propio.
- La retribución es inclinación acotada del azar, y la forma principal es favorecer a quien enfrenta al deudor.
- Interceptar una tribulación hace al ladrón (y al que ayuda) parte de ella: comparte atención, olas y karma.
- El mérito es asimétrico: descuenta, no se compra, no se hereda; las deudas sí se heredan.
- El 气运 es derivado (tierra + gente + inclinaciones sumadas), no un favor del Cielo ni un estado propio.

## Preguntas abiertas
- Calibración: capacidad de atención por fuerza del Cielo y forma de los rendimientos decrecientes (cuánto baja una tribulación en una era saturada).
- Calibración: techo de la inclinación por mundo y era, y cuántas tiradas toca (que la mala racha se note sin volverse absurda).
- Calibración: umbral de déficit de qi para pasar de inclinación a calamidad.
- Calibración: cuánto descuenta el mérito en cobro y tribulación; velocidad de cierre de heridas del Cielo.
- Calibración: fracción de energía de una tribulación que un ladrón puede tomar según su preparación.
