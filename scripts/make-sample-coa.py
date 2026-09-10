"""Generate a realistic one-page sample COA PDF for demoing the upload flow.

Not part of the app — a throwaway that produces a believable lab report so the
report page has a real document to embed and download. Matches the seeded batch
SF-2409-A12 (Calm Gummies, pass) so the on-page results and the PDF agree.
"""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, HRFlowable)

OUT = sys.argv[1] if len(sys.argv) > 1 else "sample-coa.pdf"

ORANGE = colors.HexColor("#F0701C")
INK = colors.HexColor("#21252B")
INK3 = colors.HexColor("#6B7280")
HAIR = colors.HexColor("#E4DACA")
OLIVE = colors.HexColor("#4E7020")

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=INK, fontSize=20, spaceAfter=2)
lab = ParagraphStyle("lab", parent=styles["Normal"], textColor=INK3, fontSize=8.5, leading=12)
small = ParagraphStyle("small", parent=styles["Normal"], textColor=INK3, fontSize=7.5, leading=10)
sec = ParagraphStyle("sec", parent=styles["Heading2"], textColor=INK, fontSize=11, spaceBefore=10, spaceAfter=4)

doc = SimpleDocTemplate(OUT, pagesize=letter, topMargin=18*mm, bottomMargin=16*mm,
                        leftMargin=16*mm, rightMargin=16*mm, title="Certificate of Analysis — SF-2409-A12")
story = []

# Header
head = Table([[
    Paragraph("<b>ANRESCO LABORATORIES</b><br/>1370 Van Dyke Ave, San Francisco, CA 94124<br/>"
              "License C8-0000123-LIC &nbsp;•&nbsp; ISO/IEC 17025:2017 accredited", lab),
    Paragraph("<b>CERTIFICATE<br/>OF ANALYSIS</b>", ParagraphStyle(
        "r", parent=lab, alignment=2, textColor=ORANGE, fontSize=12, leading=14)),
]], colWidths=[120*mm, 58*mm])
head.setStyle(TableStyle([("VALIGN", (0,0), (-1,-1), "TOP")]))
story.append(head)
story.append(Spacer(1, 6))
story.append(HRFlowable(width="100%", thickness=2, color=ORANGE))
story.append(Spacer(1, 10))

# Sample identity
story.append(Paragraph("Calm Gummies", h1))
story.append(Paragraph("Batch <b>SF-2409-A12</b> &nbsp;•&nbsp; Sample ANR-24-88213", lab))
story.append(Spacer(1, 8))

meta = Table([
    ["Matrix", "Edible (gummy)", "Sampled", "2024-08-28"],
    ["Received", "2024-08-29", "Tested", "2024-09-02"],
    ["Batch size", "4,200 units", "Overall", "PASS"],
], colWidths=[28*mm, 61*mm, 28*mm, 61*mm])
meta.setStyle(TableStyle([
    ("FONTSIZE", (0,0), (-1,-1), 8.5),
    ("TEXTCOLOR", (0,0), (0,-1), INK3),
    ("TEXTCOLOR", (2,0), (2,-1), INK3),
    ("TEXTCOLOR", (3,2), (3,2), OLIVE),
    ("FONTNAME", (3,2), (3,2), "Helvetica-Bold"),
    ("LINEBELOW", (0,0), (-1,-2), 0.4, HAIR),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
]))
story.append(meta)

def result_table(title, headers, rows, widths):
    story.append(Paragraph(title, sec))
    data = [headers] + rows
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0,0), (-1,0), INK),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("FONTSIZE", (0,0), (-1,-1), 8),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("LINEBELOW", (0,1), (-1,-1), 0.3, HAIR),
        ("TOPPADDING", (0,0), (-1,-1), 3.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3.5),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("ALIGN", (1,0), (-1,-1), "RIGHT"),
        ("ALIGN", (0,0), (0,-1), "LEFT"),
    ]
    t.setStyle(TableStyle(style))
    story.append(t)

result_table(
    "Cannabinoids &nbsp;— HPLC-DAD",
    ["Analyte", "Result", "LOD", "LOQ"],
    [
        ["Δ9-THC", "0.18 %", "0.01", "0.03"],
        ["THCA", "0.12 %", "0.01", "0.03"],
        ["CBD", "24.60 %", "0.01", "0.03"],
        ["CBDA", "0.04 %", "0.01", "0.03"],
        ["CBG", "0.31 %", "0.01", "0.03"],
        ["CBN", "ND", "0.01", "0.03"],
    ],
    [90*mm, 30*mm, 29*mm, 29*mm],
)

result_table(
    "Safety panels &nbsp;— summary",
    ["Panel", "Method", "Result"],
    [
        ["Pesticides", "LC-MS/MS", "PASS"],
        ["Heavy metals", "ICP-MS", "PASS"],
        ["Microbials", "qPCR", "PASS"],
        ["Mycotoxins", "LC-MS/MS", "PASS"],
        ["Residual solvents", "GC-FID", "PASS"],
    ],
    [90*mm, 58*mm, 30*mm],
)

story.append(Spacer(1, 14))
story.append(HRFlowable(width="100%", thickness=0.6, color=HAIR))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "This certificate applies only to the batch and sample identified above. Results relate only to "
    "the item(s) tested. This is a demonstration document generated for testing the Super Feels COA "
    "portal and is not a genuine laboratory report.", small))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Authorised by: J. Rivera, Laboratory Director &nbsp;•&nbsp; Report issued 2024-09-03", small))

doc.build(story)
print("wrote", OUT)
