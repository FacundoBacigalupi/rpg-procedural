# El Cielo y el Karma

> Nota: este doc describe la **familia xianxia**. Otras familias de mundos cambian estas reglas; ver [metaphysics.md](metaphysics.md).

> Decisión (2026-10-05): **el Cielo existe**, y cultivar es ir en su contra. Romper reinos dispara tribulaciones. **El karma es real** y es parte de la física del mundo.

Ver también [causality.md](causality.md): el karma es el grafo causal hecho metafísica.

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
| **Tribulación** | Al romper ciertos reinos (los que cruzan un "umbral de transgresión") | Tamaño del salto, karma acumulado, talento (los genios atraen más atención), atención actual del Cielo sobre la región |
| **Límite de vida** | Siempre | Reino de cultivo, constitución, técnicas, karma (el desgaste del cuerpo es otro reloj: [body-health.md](body-health.md) §10) |
| **Retribución kármica** | Cuando una deuda kármica es enorme | Modifica tiradas (mala suerte, accidentes) o dispara calamidades contra el deudor. Nunca crea entidades de la nada: usa lo que ya existe (bestias cercanas, enemigos reales, el clima) |
| **Demonios internos** | En rupturas y meditación profunda | Memorias traumáticas, culpa y deudas kármicas del propio cultivador (enlace con psicología) |
| **Cobro en las Fuentes** | Cuando un alma cruza las Fuentes Amarillas | Esencia refinada, años de más y karma neto del alma (ver abajo) |
| **Calamidades** | Desequilibrio grave de qi en una región (sobreexplotación, arrays prohibidos) | Deslaves de qi, sequías espirituales, mutaciones de bestias |

### El cobro en las Fuentes
Cruzar las Fuentes Amarillas (spirits §3b) es **saldar la cuenta con el Cielo**. Antes de volver a nacer, al alma se le **muele lo que no era suyo**, y lo molido vuelve al ciclo (conservación: el qi y la sustancia del alma no desaparecen, vuelven al Cielo y al mundo).

```ts
interface SoulToll {
  refinedEssence: number;      // esencia que el cultivo fijó en el alma por encima de lo mortal
  stolenYears: number;         // años vividos más allá del límite natural
  netKarma: number;            // deudas menos méritos (功德) todavía abiertos en el libro
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
Romper el último reino del planeta = **dejar el mundo** hacia un plano superior. Es la "salida" del planeta. El diseño deja `Realm` como una entidad dentro de una cosmología mayor, pero **por ahora solo existe un planeta**. Qué hay arriba queda abierto (puede ser el final de la partida, o una continuación).

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
- Matar a alguien deja una deuda de sangre con la víctima, y por extensión con su linaje y su maestro.
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
- **Suerte:** las deudas grandes modifican tiradas (nunca crean cosas).
- **Percepción:** adivinadores y técnicas kármicas pueden **leer** los enlaces: quién mató a alguien, a quién le debés, si alguien te miente sobre su pasado.
- **Comportamiento:** los cultivadores que creen en el karma lo usan al decidir ("no lo mato, no quiero esa deuda antes de mi tribulación").

### Regla
El karma **solo lee** el grafo causal y **solo actúa** a través de las herramientas del Cielo. No es una excusa para que pasen cosas sin causa: si te llega una retribución, la causa es tu deuda y el evento queda registrado.
