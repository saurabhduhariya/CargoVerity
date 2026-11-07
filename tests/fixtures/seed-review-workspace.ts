import type { PrismaClient, ReviewStatus } from "../../src/generated/prisma/client";

/** Explicitly opt-in setup for a newly created synthetic review-QA shipment, never an app route. */
export async function seedReviewWorkspace(
  prisma: PrismaClient,
  input: { shipmentId: string; expectedReference: string; executiveEmail: string },
) {
  if (!input.expectedReference.startsWith("QA-REVIEW-")) throw new Error("Only a labeled QA shipment can be seeded.");
  const shipment = await prisma.shipment.findFirstOrThrow({
    where: { id: input.shipmentId, reference: input.expectedReference, createdBy: { email: input.executiveEmail, role: "EXECUTIVE" } },
    include: { documents: { where: { isCurrent: true }, include: { extractionRuns: { where: { status: "COMPLETED" } } } } },
  });
  if (shipment.documents.length !== 3 || shipment.documents.some((doc) => doc.pageCount !== 2 || doc.extractionRuns.length > 0)) {
    throw new Error("Seed requires three new two-page documents without completed extractions.");
  }
  if (["APPROVED", "EXPORTED", "READY_FOR_APPROVAL"].includes(shipment.status)) throw new Error("Do not seed a reviewed shipment.");

  return prisma.$transaction(async (tx) => {
    for (const doc of shipment.documents) {
      const invoice = doc.docType === "INVOICE";
      const bl = doc.docType === "BILL_OF_LADING";
      const run = await tx.extractionRun.create({
        data: {
          documentId: doc.id, requestedById: shipment.createdById, documentVersion: doc.documentVersion,
          provider: "synthetic-review-qa", model: "deterministic-fixture", promptVersion: "qa-only",
          idempotencyKey: `qa-review:${shipment.id}:${doc.id}`, status: "COMPLETED", pageCount: 2,
          startedAt: new Date(), completedAt: new Date(), rawResponse: { syntheticFixture: true, liveProviderUnavailable: true },
        },
      });
      const field = (fieldKey: string, value: string | null, pageNumber: number | null, quote: string | null, status: ReviewStatus = "CONFIRMED", confidence = 0.98, unit: string | null = null, reviewReason: string | null = null) => ({
        documentId: doc.id, extractionRunId: run.id, fieldKey, modelValue: value, currentValue: value,
        pageNumber, sourceQuote: quote, reviewStatus: status, modelConfidence: value === null ? null : confidence, unit, reviewReason,
      });
      const fields = [
        field("exporter", "Synthetic Review QA Supplier", 1, `${bl ? "Shipper" : "Exporter"}: Synthetic Review QA Supplier`, invoice ? "PENDING" : "CONFIRMED"),
        field("importer", invoice ? null : "Synthetic Review QA Importer", invoice ? null : 1, invoice ? null : `${bl ? "Consignee" : "Importer"}: Synthetic Review QA Importer`, invoice ? "REQUIRES_REVIEW" : "CONFIRMED", 0.98, null, invoice ? "REQUIRED_FIELD_MISSING" : null),
        field("documentNumber", `${invoice ? "INV" : bl ? "BL" : "PL"}-${shipment.reference}`, 1, `${invoice ? "Invoice number" : bl ? "Bill of lading number" : "Packing list number"}: ${invoice ? "INV" : bl ? "BL" : "PL"}-${shipment.reference}`),
        field("issueDate", invoice ? null : "2026-11-07", invoice ? null : 1, invoice ? null : "Issue date: 2026-11-07", invoice ? "REQUIRES_REVIEW" : "CONFIRMED", 0.98, null, invoice ? "REQUIRED_FIELD_MISSING" : null),
        field("packageCount", "120", 2, "Total packages: 120 cartons", "CONFIRMED", 0.98, "cartons"),
        field("grossWeight", invoice ? "3120" : "3165", 2, `Gross weight: ${invoice ? "3120" : "3165"} kg`, invoice ? "REQUIRES_REVIEW" : "CONFIRMED", invoice ? 0.72 : 0.98, "kg", invoice ? "LOW_MODEL_CONFIDENCE" : null),
      ];
      if (!bl) fields.push(field("netWeight", "2880", 2, "Net weight: 2880 kg", "CONFIRMED", 0.98, "kg"));
      if (invoice) fields.push(
        field("currency", "USD", 1, "Currency: USD"),
        field("invoiceTotal", "16320.00", 2, "Invoice total: USD 16320.00", "REQUIRES_REVIEW", 0.76, "USD", "LOW_MODEL_CONFIDENCE"),
        field("incoterm", null, null, null, "NOT_PRESENT", 0.98, null, "OPTIONAL_FIELD_NOT_PRESENT"),
      );
      if (bl) fields.push(
        field("portOfLoading", "Shanghai, China", 1, "Port of loading: Shanghai, China"),
        field("portOfDischarge", "Nhava Sheva, India", 1, "Port of discharge: Nhava Sheva, India"),
        field("vessel", "SYNTHETIC VOYAGER", 1, "Vessel: SYNTHETIC VOYAGER"),
        field("containerNumber", "SYNTHETIC-001", 2, "Container number: SYNTHETIC-001"),
      );
      await tx.extractedField.createMany({ data: fields });
      if (!bl) {
        await tx.lineItem.createMany({
          data: [1, 2].map((lineNumber) => ({
            documentId: doc.id, extractionRunId: run.id, lineNumber, description: "LED panel light 40W",
            hsnCode: "9405.10", quantity: "1200", quantityUnit: "pcs", unitPrice: invoice ? "6.80" : null,
            currency: invoice ? "USD" : null, lineTotal: invoice ? "8160.00" : null, pageNumber: 2, modelConfidence: 0.98,
            sourceQuote: `${lineNumber}. LED panel light 40W | HSN 9405.10 | 1200 pcs${invoice ? " | USD 6.80 | USD 8160.00" : ""}`,
          })),
        });
      }
      await tx.document.update({ where: { id: doc.id }, data: { extractionStatus: invoice ? "REVIEW_REQUIRED" : "EXTRACTED", detectedDocType: doc.docType, typeMismatch: false } });
      await tx.documentPage.updateMany({ where: { documentId: doc.id }, data: { isReadable: true, manualEntryRequired: false, reviewNote: null } });
    }
    const updated = await tx.shipment.updateMany({
      where: { id: shipment.id, currentRevision: shipment.currentRevision },
      data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
    });
    if (updated.count !== 1) throw new Error("QA shipment changed during setup.");
    await tx.auditEvent.create({ data: {
      shipmentId: shipment.id, actorId: shipment.createdById, action: "QA_REVIEW_FIXTURE_SEEDED", entityType: "Shipment", entityId: shipment.id,
      metadata: { syntheticFixture: true, reason: "Authorized deterministic browser QA after live-provider failure", revision: shipment.currentRevision + 1 },
    } });
    return { shipmentId: shipment.id, revision: shipment.currentRevision + 1 };
  }, { timeout: 30_000, maxWait: 10_000 });
}
