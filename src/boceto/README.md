# Importar boceto: una foto de un diagrama -> un proyecto

`POST /api/boceto/interpretar` (multipart, campo `imagen`) devuelve lo que el modelo de
visión **leyó**, no un proyecto.

## Por qué el reparto es así

| Lado | Qué hace | Por qué |
|---|---|---|
| Backend | Llama a OpenAI y devuelve un JSON plano | Es el único que puede tener la clave. Una clave de OpenAI en el navegador es una clave pública |
| Frontend | Convierte ese JSON en un `UmlDocument` | El contrato del documento vive en `uml/` (CLAUDE.md §5): ids, invariantes, `schemaVersion`, migraciones. Construirlo aquí sería una segunda verdad |

**Al modelo no se le pide el formato `contenido`.** Ese es profundo —nodos y aristas
indexados por id, invariantes, `associationId`, waypoints, viewport— y pedírselo invita a
documentos inválidos. Se le pide una forma **plana** (`esquema.js`), garantizada por
Structured Outputs con `strict: true`: el modelo no puede devolver otra cosa.

## El modelo

`gpt-5.6-terra` por defecto, configurable con `OPENAI_MODEL`.

| | Entrada /1M | Salida /1M | Por boceto |
|---|---|---|---|
| Terra (elegido) | $2 | $12 | **~$0.024** |
| Luna | $0.20 | $1.20 | ~$0.0024 |
| Sol | $4 | $20 | ~$0.042 |

Las imágenes se cobran en *patches* de 32×32 con **tope de 1536 tokens**, así que el coste
es predecible: ~3.000 tokens de entrada (imagen + prompt + esquema) y ~1.500 de salida.

Terra y no Luna porque esto es una operación puntual y de alto valor: leer mal una
multiplicidad cuesta más tiempo del que ahorran los dos céntimos.

## Lo que no hay que esperar

**Las posiciones son aproximadas.** Es lo que peor hace un modelo de visión. Se respetan
—es lo que hace que el resultado se parezca al boceto— pero `io/sketch.ts` las sanea:
escala, alinea a la rejilla de 8 px, separa las cajas encimadas y, si vienen inservibles,
cae a una rejilla. El resultado se parece a tu dibujo; no es idéntico.

## Configuración

```
OPENAI_API_KEY=sk-...        # sin ella, la ruta responde 503 y el resto sigue igual
OPENAI_MODEL=gpt-5.6-terra
OPENAI_TIMEOUT_MS=90000
BOCETO_MAX_BYTES=10485760
```

## Las piezas

| Fichero | Qué hace |
|---|---|
| `esquema.js` | El JSON Schema de la respuesta. Cumple las reglas de `strict`: todo en `required`, `additionalProperties: false` |
| `prompt.js` | Las instrucciones. Lo que más pesa son las **direcciones**: qué extremo es el todo en una composición, cuál la subclase en una generalización |
| `openai.js` | La llamada, con timeout y traducción de errores (`refusal`, `length`, 401, 5xx) |

La conversión y sus tests están en el frontend: `src/io/sketch.ts` y `sketch.test.ts`.
