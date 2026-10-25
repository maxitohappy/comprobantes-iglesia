# Backend (Google Apps Script)

## Primera configuración (una vez)

1. Abre el proyecto **Comprobantes Iglesia IPUNJ** en <https://script.google.com> (cuenta maxorito9@gmail.com).
2. ⚙️ **Configuración del proyecto → Propiedades del script → Agregar propiedad**:
   - `ANTHROPIC_API_KEY` = tu clave de <https://console.anthropic.com/settings/keys>
   - Opcionales: `LIMITE_DIARIO` (por defecto 100), `MODELO` (por defecto `claude-haiku-5-5`).
3. En el editor, elige la función **`inicializar`** y pulsa **Ejecutar**. Autoriza los permisos (Google avisa que la
   app no está verificada porque es tuya: *Configuración avanzada → Ir a Comprobantes Iglesia IPUNJ*). Esto crea en tu
   Drive la carpeta **Tesorería IPUNJ - Comprobantes** con la planilla **Comprobantes** (pestañas Registros y Balance) y
   la subcarpeta **Archivos**. Puedes volver a ejecutar `inicializar` para reconstruir la pestaña Balance.

Para probar: abre `URL_DEL_BACKEND?accion=ping`. Debe responder `{"ok":true,...}`.

## Actualizar el código sin cambiar la URL

Requiere `clasp login` y el `.clasp.json` local (no se publica):

```bash
cd backend
npx @google/clasp push -f
npx @google/clasp update-deployment <ID de la implementación> -d "descripción"
```

## Acciones

- GET `ping`: estado, enlaces a la carpeta y planilla, uso del día y catálogo de tipos/subtipos.
- GET `ultimas`: últimos 10 comprobantes registrados.
- POST `extraer` (`tipo`, `datos` en base64): lee el comprobante con Claude. Descuenta 1 del tope diario.
- POST `guardar` (`campos`, `tipo`, `datos`, `advertencias`): guarda la fila y el archivo, y reordena por fecha.
- POST `eliminar` (`id`): borra la fila y manda el archivo a la papelera de Drive.

## Notas

- La URL `/exec` es pública: cualquiera que la tenga puede leer comprobantes (hasta el tope diario), ver los últimos 10
  y eliminarlos. Comparte el enlace solo con la tesorería.
- Si borras la carpeta o la planilla, se vuelven a crear solas en la siguiente operación.
