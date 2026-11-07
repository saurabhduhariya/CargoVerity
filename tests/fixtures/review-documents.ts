import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Synthetic, two-page evidence for the real-application review tests. Never a filing document. */
export async function createReviewDocuments(reference: string) {
  const definitions = [
    {
      docType: "INVOICE" as const,
      fileName: "synthetic-review-invoice.pdf",
      title: "COMMERCIAL INVOICE",
      firstPage: [
        `Invoice number: INV-${reference}`,
        "Exporter: Synthetic Review QA Supplier",
        "Importer: not supplied",
        "Issue date: not supplied",
        "Currency: USD",
        "Port of loading: Shanghai, China",
        "Port of discharge: Nhava Sheva, India",
      ],
      secondPage: [
        "GOODS - TWO SEPARATE LINES (NOT A SUBTOTAL)",
        "1. LED panel light 40W | HSN 9405.10 | 1200 pcs | USD 6.80 | USD 8160.00",
        "2. LED panel light 40W | HSN 9405.10 | 1200 pcs | USD 6.80 | USD 8160.00",
        "Invoice total: USD 16320.00",
        "Gross weight: 3120 kg",
        "Net weight: 2880 kg",
        "Total packages: 120 cartons",
      ],
    },
    {
      docType: "PACKING_LIST" as const,
      fileName: "synthetic-review-packing-list.pdf",
      title: "PACKING LIST",
      firstPage: [
        `Packing list number: PL-${reference}`,
        "Exporter: Synthetic Review QA Supplier",
        "Importer: Synthetic Review QA Importer",
        "Issue date: 2026-11-07",
      ],
      secondPage: [
        "GOODS - TWO SEPARATE LINES",
        "1. LED panel light 40W | HSN 9405.10 | 1200 pcs",
        "2. LED panel light 40W | HSN 9405.10 | 1200 pcs",
        "Gross weight: 3165 kg",
        "Net weight: 2880 kg",
        "Total packages: 120 cartons",
      ],
    },
    {
      docType: "BILL_OF_LADING" as const,
      fileName: "synthetic-review-bill-of-lading.pdf",
      title: "BILL OF LADING",
      firstPage: [
        `Bill of lading number: BL-${reference}`,
        "Shipper: Synthetic Review QA Supplier",
        "Consignee: Synthetic Review QA Importer",
        "Issue date: 2026-11-07",
        "Carrier: Synthetic Review QA Carrier",
        "Vessel: SYNTHETIC VOYAGER",
        "Port of loading: Shanghai, China",
        "Port of discharge: Nhava Sheva, India",
      ],
      secondPage: [
        "Cargo: LED panel light 40W - 2400 pcs",
        "Gross weight: 3165 kg",
        "Total packages: 120 cartons",
        "Container number: SYNTHETIC-001",
      ],
    },
  ];

  return Promise.all(definitions.map(async (definition) => {
    const pdf = await PDFDocument.create();
    pdf.setCreationDate(new Date("2026-11-07T00:00:00Z"));
    pdf.setModificationDate(new Date("2026-11-07T00:00:00Z"));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    [definition.firstPage, definition.secondPage].forEach((lines, index) => {
      const page = pdf.addPage([595, 842]);
      page.drawText("SYNTHETIC QA DOCUMENT - NOT FOR CUSTOMS FILING", { x: 40, y: 805, size: 11, font: bold, color: rgb(0.6, 0.1, 0.1) });
      page.drawText(definition.title, { x: 40, y: 745, size: 22, font: bold });
      page.drawText(`Shipment: ${reference} | Page ${index + 1} of 2`, { x: 40, y: 715, size: 12, font });
      lines.forEach((line, lineIndex) => page.drawText(line, { x: 40, y: 660 - lineIndex * 42, size: 11, font }));
      page.drawText("Generated solely for CargoVerity review interaction testing.", { x: 40, y: 35, size: 10, font });
    });
    return { docType: definition.docType, fileName: definition.fileName, bytes: await pdf.save() };
  }));
}
