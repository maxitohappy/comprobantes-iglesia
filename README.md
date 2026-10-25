# Comprobantes de ingreso y egreso — Iglesia Pentecostal Unida del Nombre de Jesús

Aplicación web para la tesorería de la iglesia:

1. Subes un comprobante de ingreso o egreso (JPG, PNG o PDF) o le tomas una foto con el celular.
2. Claude (API de Anthropic, modelo `claude-haiku-5-5`) lee el título (ingreso o egreso), la **fecha** y el **monto**,
   y según la glosa propone el **tipo** y **subtipo** del catálogo de la iglesia.
3. Revisas y corriges. Si la glosa no indica el tipo, los selectores quedan vacíos y debes elegirlos antes de guardar
   (la glosa leída se muestra como ayuda, pero no se guarda).
4. Al guardar, se agrega una fila (Fecha registro, Fecha comprobante, Movimiento, Nombre, Tipo, Subtipo, Monto, Link archivo,
   Notas) a la pestaña **Registros** de la planilla **Comprobantes** (ordenada siempre por la
   fecha del comprobante) y una copia del archivo en la carpeta **Tesorería IPUNJ - Comprobantes/Archivos** de Google Drive.
5. En "Últimos comprobantes guardados" puedes eliminar un comprobante: se borra de la planilla y el archivo va a la papelera.

La pestaña **Balance** se calcula sola con fórmulas: ingresos, egresos, saldo, superávit/déficit, saldo por fondo
(N°1 locales, N°2 pastor, N°3 nacionales), conceptos con mayor peso, punto de equilibrio y movimiento mensual con gráficos.

**Sitio:** https://maxitohappy.github.io/comprobantes-iglesia/

## Reglas de negocio

- El título del comprobante define el movimiento: "Comprobante de ingreso" → Ingreso; "Comprobante de egreso" → Egreso.
- Algunos formularios impresos dicen **"Comprobante de engreso"** por un error de imprenta: se registran como **Egreso**.
- **Palabras clave:** si la glosa contiene una palabra clave de un subtipo (sin importar mayúsculas, tildes ni plural),
  se clasifica en ese subtipo. Ejemplo: en un egreso, "Entrega plata préstamo" → Egreso N°1 · Pago Préstamo. Si coinciden
  varias, gana la más larga ("diezmo de diezmo" gana a "diezmo"). La lista está en `PALABRAS_CLAVE` de `backend/Code.gs`.
- Si no hay palabra clave, Claude propone tipo y subtipo solo si la glosa es clara; si no, el usuario los elige antes de guardar.
- La planilla se ordena por la fecha del comprobante, no por la fecha en que se subió.

## Catálogo

| Tipo | Subtipos |
|---|---|
| Ingreso N°1 - Ingresos locales | Ofrendas Culto, Obra Social, Actividad Pro-Templo, Votos Pro-Templo, Votos Familia Pastoral, Otros Votos, Donaciones, Saldo Anterior, Préstamo |
| Ingreso N°2 - Dineros Pastor | Diezmos, Primicias |
| Ingreso N°3 - Dineros Nacionales | Ofrenda Misionera, Ofrenda Gavillas para Cristo, Ofrenda Rayos de Luz, Ofrenda Semestral, Obra Social Nacional |
| Egreso N°1 - Egresos locales | Arriendo, Servicios, E. Dominical - Oficina, Insumos Aseo, Viáticos, Inversión Actividad Pro-Templo, Obra Social Local, Construcción, Pago Préstamo |
| Egreso N°2 - Dineros Pastor | Entrega Diezmo a Pastor, Adelanto Pastor, Diezmo de Diezmo, FOSP, Primicias, AFP y Fonasa, Otras Donaciones |
| Egreso N°3 - Dineros Nacionales | Ofrenda Misionera, Ofrenda Gavillas para Cristo, Ofrenda Rayos de Luz, Ofrenda Semestral, Obra Social Nacional, Otros Envíos |

El catálogo vive en `CATEGORIAS` de `backend/Code.gs`; el frontend lo recibe del backend.

## Arquitectura

- `index.html`, `app.js`, `estilos.css`, `logo.jpg`: frontend estático publicado en GitHub Pages.
- `backend/Code.gs`: Google Apps Script publicado como aplicación web. Llama a la API de Anthropic con la clave guardada
  en las Propiedades del script, crea la carpeta y la planilla en Drive, guarda, ordena y elimina registros.
- `config.js`: URL del backend. Es pública, no es un secreto.

La clave de Anthropic nunca está en este repositorio ni en el navegador. El backend tiene un tope diario de lecturas
(`LIMITE_DIARIO`, 100 por defecto).

## Configuración del backend

Ver [backend/LEEME.md](backend/LEEME.md).
