# -*- coding: utf-8 -*-
from pathlib import Path
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUT_DIR / "guia_usuario_pallets.pdf"

SCREENSHOTS = {
    "validacion": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-5e85a4a7-2a9c-4af2-bba2-8453103465ee.png"),
    "incidencia": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-fdc1637c-a926-4c44-87ce-cccdf53e1ed3.png"),
    "resumen": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-71c460da-5c3d-4c85-8639-2b66fb4e361d.png"),
    "enviado_detalle": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-8d1ef780-24d5-4ac9-8409-f504fb7762e1.png"),
    "enviado_tiendas": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-fb791dcc-1ad2-42b4-9f6b-c77fac962ab1.png"),
    "impacto": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-ae1f9c7f-cc75-485c-b300-aa0dc66cf6c8.png"),
    "estado_logistico": Path(r"C:\Users\Josej\AppData\Local\Temp\codex-clipboard-8a7bb506-8db8-4477-8ff3-229be009a0d4.png"),
}


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=25,
            leading=30,
            textColor=colors.HexColor("#17221b"),
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#5d5f63"),
            alignment=TA_CENTER,
            spaceAfter=16,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=17,
            leading=22,
            textColor=colors.HexColor("#a64c1f"),
            spaceBefore=10,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#17221b"),
            spaceBefore=8,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#24272b"),
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=11,
            textColor=colors.HexColor("#5d5f63"),
        ),
        "caption": ParagraphStyle(
            "Caption",
            parent=base["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#676b70"),
            alignment=TA_CENTER,
            spaceBefore=3,
            spaceAfter=8,
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.2,
            leading=13,
            textColor=colors.HexColor("#17221b"),
            backColor=colors.HexColor("#f7efe7"),
            borderColor=colors.HexColor("#dfb98d"),
            borderWidth=0.6,
            borderPadding=8,
            spaceBefore=6,
            spaceAfter=8,
        ),
    }


def para(text, style):
    return Paragraph(text, style)


def bullets(items, styles):
    rows = [[para(f"- {item}", styles["body"])] for item in items]
    table = Table(rows, colWidths=[16.2 * cm])
    table.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return table


def screenshot_block(key, caption, max_width=17.1 * cm, max_height=7.2 * cm):
    path = SCREENSHOTS[key]
    if not path.exists():
        return [para(f"Captura no disponible: {path.name}", STYLES["caption"])]
    img = Image(str(path))
    ratio = min(max_width / img.imageWidth, max_height / img.imageHeight)
    img.drawWidth = img.imageWidth * ratio
    img.drawHeight = img.imageHeight * ratio
    return [img, para(caption, STYLES["caption"])]


def role_table(styles):
    data = [
        [para("<b>Rol</b>", styles["body"]), para("<b>Acceso principal</b>", styles["body"]), para("<b>Restriccion</b>", styles["body"])],
        [para("Supervisor", styles["body"]), para("Vista de data y reporte de supervisor.", styles["body"]), para("Puede cambiar estados y gestionar incidencias.", styles["body"])],
        [para("Validador", styles["body"]), para("Vista movil o PC para validar pallets/cartones.", styles["body"]), para("No accede al reporte ejecutivo.", styles["body"])],
        [para("Invitado CD_Oslo", styles["body"]), para("Solo reporte de supervisor.", styles["body"]), para("No ve data operativa ni controles de gestion.", styles["body"])],
    ]
    table = Table(data, colWidths=[3.0 * cm, 7.0 * cm, 6.2 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9f1ec")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8c4ae")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e4d5c5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#6b6f75"))
    canvas.drawString(1.6 * cm, 1.0 * cm, "SGE Validacion de Pallets y Cartones")
    canvas.drawRightString(19.4 * cm, 1.0 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=1.55 * cm,
        leftMargin=1.55 * cm,
        topMargin=1.55 * cm,
        bottomMargin=1.45 * cm,
        title="Guia de usuario - SGE Validacion de Pallets y Cartones",
        author="Codex",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])

    story = []
    generated = datetime.now().strftime("%d/%m/%Y %H:%M")
    story += [
        Spacer(1, 2.2 * cm),
        para("Guia de usuario", STYLES["title"]),
        para("SGE Validacion de Pallets y Cartones", STYLES["title"]),
        para(f"Documento operativo generado el {generated}. Incluye capturas reales del sistema, reglas de negocio y logica de calculo usada por el proyecto.", STYLES["subtitle"]),
        para("Objetivo del sistema", STYLES["h1"]),
        para("El programa permite validar pallets o cartones contra la data operativa, registrar faltantes como incidencias, calcular automaticamente el costo del faltante y alimentar un reporte ejecutivo conectado a Google Sheets.", STYLES["body"]),
        para("La prioridad del flujo es que cada incidencia viaje con la llave correcta: tienda, pallet, LPN/carton, codigo de producto, bultos faltantes, precio calculado, estado y fecha.", STYLES["callout"]),
        para("Roles de usuario", STYLES["h1"]),
        role_table(STYLES),
        PageBreak(),
    ]

    story += [
        para("1. Vista de Validador", STYLES["h1"]),
        para("El usuario validador trabaja desde vista movil o PC. Su tarea es revisar los productos de un pallet/carton, confirmar si todo esta conforme o reportar un faltante.", STYLES["body"]),
        *screenshot_block("validacion", "Ejemplo de tarjeta de validacion: pallet, producto, bultos esperados y acciones OK/Faltante."),
        para("Flujo recomendado", STYLES["h2"]),
        bullets([
            "Buscar el pallet, LPN/carton o codigo segun la vista seleccionada.",
            "Revisar descripcion, tienda, pallet, LPN y cantidad de bultos.",
            "Presionar OK si el producto esta conforme.",
            "Presionar Faltante si falta mercaderia e ingresar los bultos faltantes.",
            "El sistema calcula el precio del faltante antes de enviarlo al reporte.",
        ], STYLES),
        para("Regla clave: un codigo puede repetirse en pallets o cartones diferentes. Eso no es error. La validacion se entiende por combinacion de pallet, LPN/carton y codigo.", STYLES["callout"]),
    ]

    story += [
        para("2. Logica de agrupacion", STYLES["h1"]),
        para("El sistema consolida productos usando una llave compuesta. En vista por LPN considera: Nro Pallet + Nro LPN + Codigo + Estilo + Descripcion. En vista por pallet, el LPN se reemplaza por TODO-EL-PALLET para sumar el mismo producto dentro del mismo pallet.", STYLES["body"]),
        para("Esto permite que un mismo producto se acumule si pertenece al mismo pallet, pero no convierte en error que el mismo codigo aparezca en otro pallet.", STYLES["body"]),
        para("Como se detecta una incidencia ya reportada", STYLES["h2"]),
        bullets([
            "Primero compara el codigo del producto.",
            "Luego confirma que coincida el mismo pallet o el mismo LPN/carton.",
            "Si el codigo coincide pero el pallet es distinto, se considera una incidencia separada y valida.",
            "Si comparte pallet, el reporte puede sumar el total del faltante de ese pallet.",
        ], STYLES),
    ]

    story += [
        para("3. Calculo de bultos y precio", STYLES["h1"]),
        para("Los bultos se calculan desde UnAct y Und x Caja. Si Und x Caja existe, bultos = UnAct / Und x Caja. Si no existe, se usa UnAct como respaldo.", STYLES["body"]),
        para("El costo unitario se obtiene por codigo de producto desde la data de costos. El precio total del faltante se calcula tomando los bultos faltantes, convirtiendolos a unidades y multiplicando por el costo unitario.", STYLES["body"]),
        para("Formula operativa: precio faltante = bultos faltantes x unidades por bulto x costo unitario.", STYLES["callout"]),
        para("Proteccion de precio", STYLES["h2"]),
        bullets([
            "El sistema acepta decimales con punto o coma: 26.40 y 26,40.",
            "Si Google Sheets interpreta un precio como fecha, por ejemplo 12/06/2026, la pagina lo recupera como 12.06.",
            "El reporte maneja una sola columna precio; no usa costo_unitario ni unidades_faltantes como columnas de trabajo.",
        ], STYLES),
        *screenshot_block("incidencia", "Ejemplo de incidencia en el reporte con bultos faltantes y precio calculado."),
        PageBreak(),
    ]

    story += [
        para("4. Reporte de Supervisor", STYLES["h1"]),
        para("El reporte ejecutivo centraliza las incidencias guardadas en Google Sheets. Desde aqui se revisan cantidades, costo pendiente, costo regularizado, costo total, tendencia por hora o fecha, tiendas impactadas y productos con mayor costo.", STYLES["body"]),
        *screenshot_block("resumen", "Vista resumen del reporte ejecutivo con KPIs y filtros de turno/fecha/tienda/estado."),
        para("Estados de incidencia", STYLES["h2"]),
        bullets([
            "Pendiente: la incidencia sigue abierta y su costo cuenta como pendiente.",
            "Regularizado: la incidencia fue corregida y su costo se descuenta en los reportes netos.",
            "El cambio de estado se guarda en Google Sheets con fecha de regularizacion.",
        ], STYLES),
        para("Filtros principales", STYLES["h2"]),
        bullets([
            "Turno: Todos, Dia 7-16, Tarde 16-21 y Noche 21-6.",
            "Busqueda: pallet, LPN, codigo, producto, tienda o estado.",
            "Fechas: permite ver rangos especificos sin cargar visualmente toda la operacion.",
            "Tienda y estado: ayudan a ubicar incidencias concretas cuando crece la data.",
        ], STYLES),
    ]

    story += [
        para("5. Submodulo Enviado", STYLES["h1"]),
        para("Este submodulo cruza las incidencias contra la hoja ENVIADO usando el Nro Pallet como llave. Luego enriquece la informacion con la hoja CARGA usando Nro Carga para traer placa, chofer, fecha de envio y cantidad de pallets de la carga.", STYLES["body"]),
        *screenshot_block("estado_logistico", "Estado logistico: enviado pendiente, enviado regularizado y aun en CD/sin cruce."),
        *screenshot_block("enviado_tiendas", "Pallets enviados por tienda, agrupados por carga y evitando duplicar el mismo pallet."),
        para("Reglas del cruce", STYLES["h2"]),
        bullets([
            "Si el pallet de una incidencia existe en ENVIADO, queda como Enviado.",
            "Si no existe cruce por pallet, queda como En CD o sin cruce.",
            "Si una incidencia enviada esta Regularizada, su costo se descuenta del costo pendiente enviado.",
            "Los pallets enviados por tienda se cuentan sin duplicar pallet dentro de la misma carga/tienda.",
        ], STYLES),
        PageBreak(),
    ]

    story += [
        para("6. Detalle ejecutivo y ventana flotante", STYLES["h1"]),
        para("El detalle ejecutivo muestra cada incidencia con su pallet, LPN, producto, estado, fecha, despacho, carga, placa, chofer y costo neto. Cuando se abre el detalle de una tienda/carga, el sistema muestra los pallets enviados y resalta los pallets afectados por incidencia.", STYLES["body"]),
        *screenshot_block("enviado_detalle", "Detalle ejecutivo: incidencia, carga, placa, chofer, despacho y costo neto."),
        *screenshot_block("impacto", "Tiendas impactadas por costo enviado pendiente."),
        para("Exportacion", STYLES["h2"]),
        bullets([
            "El reporte puede exportar el resultado filtrado a Excel.",
            "La exportacion respeta los filtros activos para evitar revisar datos innecesarios.",
            "El costo neto descuenta regularizaciones para mostrar el impacto pendiente real.",
        ], STYLES),
    ]

    story += [
        para("7. Google Sheets y Apps Script", STYLES["h1"]),
        para("La hoja principal de incidencias debe mantener estos encabezados, en este orden: tienda, pallet, lpn, codigos, descripcion, bultos, precio, estado, fecha_incidente, fecha_regularizado, id.", STYLES["body"]),
        para("El Apps Script publica acciones para listar, crear, actualizar estado y eliminar incidencias seleccionadas. El guardado usa bloqueo para reducir choques cuando varios usuarios trabajan al mismo tiempo.", STYLES["body"]),
        para("Buenas practicas", STYLES["h2"]),
        bullets([
            "No insertar columnas manuales en medio de la hoja Incidencias.",
            "Mantener precio y bultos como numeros con dos decimales.",
            "Publicar una nueva version del Apps Script cada vez que se actualice el codigo.",
            "Si se ve un precio convertido en fecha en Google Sheets, revisar el formato de esa celda/columna.",
            "No borrar registros manualmente salvo que sea una correccion operativa confirmada.",
        ], STYLES),
        para("Resumen de logica critica", STYLES["h1"]),
        bullets([
            "El precio que se ve antes de validar es el mismo que se envia a la hoja de incidencias.",
            "Un mismo codigo repetido no es error si cambia el pallet o LPN/carton.",
            "La marca de incidencia en validador se basa en codigo mas pallet o LPN.",
            "El reporte ejecutivo usa precio, bultos y estado para calcular costo pendiente, regularizado y total.",
            "El submodulo Enviado usa pallet para cruzar incidencias con despachos y Nro Carga para agregar placa/chofer/fecha.",
        ], STYLES),
    ]

    doc.build(story)
    return PDF_PATH


STYLES = make_styles()

if __name__ == "__main__":
    print(build())
