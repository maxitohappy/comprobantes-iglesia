# Comprobantes de ingreso y egreso — Iglesia Pentecostal Unida del Nombre de Jesús

Aplicación web para la tesorería de la iglesia:

1. Subes un comprobante de ingreso o egreso (JPG, PNG o PDF) o le tomas una foto con el celular.
2. Claude (API de Anthropic, modelo `claude-haiku-5-5`) lee el título (ingreso o egreso), la **fecha** y el **monto**,
   y según la glosa propone el **tipo** y **subtipo** del catálogo de la iglesia.
3. Revisas y corriges. Si la glosa no indica el tipo, los selectores quedan vacíos y debes elegirlos antes de guardar
   (la glosa leída se muestra como ayuda, pero no se guarda).
4. Al guardar, se agrega una fila (Fecha registro, Fecha comprobante, Movimiento, Tipo, Subtipo, Monto, Link archivo,
   Notas) a la pestaña **Registros** de la planilla **Comprobantes** (ordenada siempre por la
   fecha del comprobante) y una copia del archivo en la carpeta **Tesorería IPUNJ - Comprobantes/Archivos** de Google Drive.
5. En "Últimos comprobantes guardados" puedes eliminar un comprobante: se borra de la planilla y el archivo va a la papelera.

La pestaña **Balance** se calcula sola con fórmulas: ingresos, egresos, saldo, superávit/déficit, saldo por fondo
(N°1 locales, N°2 pastor, N°3 nacionales), conceptos con mayor peso, punto de equilibrio y movimiento mensual con gráficos.

**Sitio:** https://maxitohappy.github.io/comprobantes-iglesia/

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
