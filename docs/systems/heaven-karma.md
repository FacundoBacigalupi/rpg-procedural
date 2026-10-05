# El Cielo y el Karma

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
| **Límite de vida** | Siempre | Reino de cultivo, constitución, técnicas, karma |
| **Retribución kármica** | Cuando una deuda kármica es enorme | Modifica tiradas (mala suerte, accidentes) o dispara calamidades contra el deudor. Nunca crea entidades de la nada: usa lo que ya existe (bestias cercanas, enemigos reales, el clima) |
| **Demonios internos** | En rupturas y meditación profunda | Memorias traumáticas, culpa y deudas kármicas del propio cultivador (enlace con psicología) |
| **Calamidades** | Desequilibrio grave de qi en una región (sobreexplotación, arrays prohibidos) | Deslaves de qi, sequías espirituales, mutaciones de bestias |

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
- Romper un juramento genera un karma fuerte y casi siempre atrae retribución.
- Tomar discípulos crea un vínculo maestro–discípulo que se hereda en las dos direcciones.
- Robar la herencia de un muerto te ata a su karma, incluidos sus enemigos.

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
