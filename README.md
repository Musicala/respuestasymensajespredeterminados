# Mensajes Predeterminados - Musicala

Herramienta web para consultar, copiar y administrar respuestas predeterminadas de Musicala.

## Estado actual

- La app usa Firebase como backend principal.
- El proyecto Firebase conectado es `musiasistente`.
- Firestore guarda las respuestas en la colección `respuestasPredeterminadas`.
- Firebase Storage guarda audios/notas de voz en `respuestas-predeterminadas-audios/`.
- El modal permite subir un archivo de audio o grabar una nota de voz desde la app.
- Los audios se muestran con reproductor y botón `Descargar para WhatsApp` para adjuntarlos en WhatsApp Web.
- `messages-backup.json` queda como respaldo local de solo lectura e importación inicial.
- `Code.gs` queda solo como referencia histórica del backend anterior en Apps Script.

## Archivos principales

- `index.html`: estructura de la app y carga de Firebase.
- `firebase-config.js`: configuración web del proyecto Firebase.
- `app.js`: frontend, búsqueda, CRUD, importación y MusiAsistente local.
- `guion.js`: guion de ventas y notas locales.
- `firestore.rules`: reglas de Firestore para el proyecto compartido.
- `storage.rules`: reglas para audios/notas de voz de respuestas predeterminadas.
- `firebase.json`: configuración de Hosting, Firestore rules y Storage rules.

## Colecciones usadas

Esta herramienta solo usa:

- `respuestasPredeterminadas`

No modifica las colecciones existentes del proyecto `musiasistente`:

- `conocimiento`
- `pendientes`

## Permisos

Con las reglas incluidas:

- Todo el equipo autorizado puede leer respuestas.
- Solo Alek y Cata pueden crear, editar, archivar o importar respuestas.
- Los audios viven en Storage bajo `respuestas-predeterminadas-audios/`.

## Publicación

Validar JavaScript:

```powershell
node --check .\app.js
node --check .\guion.js
node --check .\firebase-config.js
```

Desplegar reglas:

```powershell
firebase deploy --only firestore:rules,storage --project musiasistente
```

Desplegar Hosting:

```powershell
firebase deploy --only hosting --project musiasistente
```
