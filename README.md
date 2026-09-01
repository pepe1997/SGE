# Sistema de Validacion de Pallets y Cartones

App web local para cargar la Google Sheet de pallets, agrupar por `Nro Pallet` o `Nro LPN`, validar productos y registrar faltantes.

## Acceso

- `supervisor` / `validacion`
- `validador` / `1234`
- `CD_Oslo` / `Oslo.2027` acceso invitado solo a `Supervisor > Reporte`

## Flujo principal

1. Ingresa con usuario y clave.
2. La app carga la hoja de Google Sheets por CSV.
3. Busca por pallet, LPN, codigo, estilo o descripcion.
4. Abre el pallet o LPN para ver sus productos agrupados.
5. Usa `Faltante` para indicar en una ventana cuantos bultos faltan. Todo faltante entra como `Pendiente`.
6. Usa `Validar todos` cuando todo este correcto.

## Supervisor

Al ingresar como supervisor aparece una pantalla para escoger entre `Data` y `Reporte`, similar al selector de vista del validador. `Data` sirve para revisar, regularizar, eliminar y exportar incidencias. `Reporte` tiene los submodulos `Resumen`, `Avance` y `Enviado`: `Resumen` muestra indicadores, tendencias por hora o por fecha, bultos por turno, regularizadas vs total y ranking de impacto; `Avance` compara incidencias totales contra regularizadas por dia, semana o mes, con filtros por tienda y estado; `Enviado` cruza los pallets del reporte de incidencias contra la hoja `ENVIADO` del Google Sheet de cartones para identificar que incidencias ya salieron a tienda. Luego usa `Nro Carga` para cruzar contra la hoja `CARGA` y completar placa, chofer, fecha de envio y cantidad de paletas de la carga. En este modulo el costo enviado activo descuenta las incidencias que ya fueron regularizadas, para separar el costo pendiente del costo recuperado. La data del supervisor se refresca automaticamente cada 3 segundos mientras la sesion esta abierta. El usuario invitado entra directo a `Reporte` y no puede acceder a `Data`, cambiar estados ni eliminar incidencias.

## Envio de incidencias a Google Sheets

El reporte esta configurado para guardarse en:

`https://docs.google.com/spreadsheets/d/1EBG_HWQ3lp4UWjPtpMgc0UMe_mH53RWtgAtnDMCQ_nc/edit`

Endpoint configurado:

`https://script.google.com/macros/s/AKfycbzaflhCFckAHpTg34s4FVXpZHsrRzIV8cFrZOV0nZo01kQB5nYDViyfk6l0armcPjm2/exec`

El supervisor cambia el estado a `Pendiente` o `Regularizado` desde su pagina de reporte. Al crear la incidencia, el Google Sheet guarda `fecha_incidente`. Al regularizar, guarda `fecha_regularizado`. El reporte de supervisor lee solo lo guardado en Google Sheet y permite exportar Excel con las columnas: tienda, pallet, lpn, codigos, descripcion, bultos, precio, estado, fecha_incidente y fecha_regularizado.
