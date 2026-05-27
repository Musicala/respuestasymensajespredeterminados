# Mensajes Predeterminados · Musicala

Versión mejorada con:

- MusiAsistente local sin IA real.
- Recomendación de mensajes según contexto escrito por el usuario.
- Búsqueda por intención usando sinónimos y categorías.
- Edición segura por ID.
- Prevención de duplicados por `categoría + atajo`.
- Botón de guardado con estado visible: “Guardando…”.
- Backend Apps Script corregido para que `update` y `archive` no creen filas nuevas.

## Archivos incluidos

- `index.html`: estructura de la app.
- `styles.css`: diseño claro Musicala.
- `app.js`: frontend completo, búsqueda, CRUD y MusiAsistente local.
- `Code.gs`: backend recomendado para Google Apps Script.
- `logo.png`: logo local.

## Importante

El frontend ya envía `id` al editar. Si aun así se duplican mensajes, el problema está casi seguro en Apps Script. Por eso se incluye `Code.gs` corregido.

## Pasos para actualizar Apps Script

1. Abre el proyecto de Apps Script que usa la URL configurada en `app.js`.
2. Reemplaza el contenido del archivo principal por el contenido de `Code.gs`.
3. Verifica que la hoja se llame exactamente `Mensajes`, o cambia `SHEET_NAME` en `Code.gs`.
4. Verifica que la API key sea la misma en ambos archivos:
   - `app.js`: `API_KEY`
   - `Code.gs`: `CONFIG.API_KEY`
5. Ejecuta manualmente `backfillMissingIds()` una sola vez si ya tienes mensajes antiguos sin ID.
6. Implementa una nueva versión del Web App.
7. Conserva la misma URL o actualiza `WEB_APP_URL` en `app.js` si Apps Script te da una URL nueva.

## Cómo funciona MusiAsistente

El asistente no usa IA real. Toma la pregunta escrita por el usuario, detecta intención con un bloque local de conocimiento y busca coincidencias en los mensajes cargados:

- Categoría.
- Atajo.
- Texto del mensaje.
- Sinónimos e intención probable.

Ejemplos:

- “Qué le digo a un profe que llegó tarde”.
- “Mensaje para recordar pago pendiente”.
- “Cómo confirmo una clase”.
- “Qué respondo si quieren cancelar o reprogramar”.

Si no encuentra una respuesta, no inventa. Sugiere crear un mensaje predeterminado nuevo para que quede disponible en futuras búsquedas.
