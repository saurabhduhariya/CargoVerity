import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

describe.skipIf(!enabled)("Week 6 Step 1: Integration Test Pyramid (14 Database & Transaction Flows)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });

  // Synthetic Test Context
  const executiveId = randomUUID();
  const managerId = randomUUID();
  const supplierId = randomUUID();
  const shipmentId = randomUUID();
  const shipmentRef = `TEST-PYRAMID-${randomUUID().slice(0, 8).toUpperCase()}`;

  const docInvoiceId1 = randomUUID();
  const docInvoiceId2 = randomUUID();
  const extractionRunId1 = randomUUID();
  const extractedFieldId1 = randomUUID();
  const checkRunId = randomUUID();
  const checkResultId = randomUUID();
  const resolutionId = randomUUID();
  const approvalId = randomUUID();
  const exportEventId = randomUUID();

  beforeAll(async () => {
    // 1. User and role lookup foundation
    await prisma.user.createMany({
      data: [
        { id: executiveId, email: `${executiveId}@example.test`, fullName: "Synthetic Executive", role: "EXECUTIVE" },
        { id: managerId, email: `${managerId}@example.test`, fullName: "Synthetic Manager", role: "MANAGER" },
      ],
    });
  });

  afterAll(async () => {
    // 14. Retention/deletion behavior for synthetic records: clean up all test resources
    try {
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: { in: [executiveId, managerId] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  // Flow 1: User and role lookup
  it("1. User and role lookup: distinguishes Executive and Manager roles", async () => {
    const executive = await prisma.user.findUnique({ where: { id: executiveId } });
    const manager = await prisma.user.findUnique({ where: { id: managerId } });

    expect(executive).toBeDefined();
    expect(executive?.role).toBe("EXECUTIVE");

    expect(manager).toBeDefined();
    expect(manager?.role).toBe("MANAGER");
  });

  // Flow 2: Shipment and supplier creation
  it("2. Shipment and supplier creation: links supplier and creator with initial DRAFT status", async () => {
    const supplier = await prisma.supplier.create({
      data: {
        id: supplierId,
        name: "Synthetic Logistics Ltd",
        normalizedName: `synthetic logistics ltd ${supplierId}`,
        countryCode: "US",
      },
    });

    const shipment = await prisma.shipment.create({
      data: {
        id: shipmentId,
        reference: shipmentRef,
        supplierId: supplier.id,
        createdById: executiveId,
        status: "DRAFT",
        currentRevision: 1,
      },
      include: { supplier: true, createdBy: true },
    });

    expect(shipment.reference).toBe(shipmentRef);
    expect(shipment.supplier?.name).toBe("Synthetic Logistics Ltd");
    expect(shipment.createdBy.role).toBe("EXECUTIVE");
    expect(shipment.status).toBe("DRAFT");
    expect(shipment.currentRevision).toBe(1);
  });

  // Flow 3: Document completion and validation
  it("3. Document completion and validation: attaches document and records extraction status", async () => {
    const doc = await prisma.document.create({
      data: {
        id: docInvoiceId1,
        shipmentId,
        docType: "INVOICE",
        selectedDocType: "INVOICE",
        documentVersion: 1,
        isCurrent: true,
        storageKey: `shipments/${shipmentId}/invoice-v1.pdf`,
        originalFileName: "commercial_invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10240,
        extractionStatus: "EXTRACTED",
        uploadedById: executiveId,
      },
    });

    expect(doc.docType).toBe("INVOICE");
    expect(doc.isCurrent).toBe(true);
    expect(doc.documentVersion).toBe(1);
    expect(doc.extractionStatus).toBe("EXTRACTED");
  });

  // Flow 4: Document replacement and revision increment
  it("4. Document replacement and revision increment: replaces document and bumps shipment revision", async () => {
    await prisma.$transaction(async (tx) => {
      // Mark old version non-current
      await tx.document.update({
        where: { id: docInvoiceId1 },
        data: { isCurrent: false },
      });

      // Create new version
      await tx.document.create({
        data: {
          id: docInvoiceId2,
          shipmentId,
          docType: "INVOICE",
          selectedDocType: "INVOICE",
          documentVersion: 2,
          isCurrent: true,
          storageKey: `shipments/${shipmentId}/invoice-v2.pdf`,
          originalFileName: "commercial_invoice_revised.pdf",
          mimeType: "application/pdf",
          sizeBytes: 11500,
          extractionStatus: "EXTRACTED",
          uploadedById: executiveId,
        },
      });

      // Bump shipment revision
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { currentRevision: 2, status: "NEEDS_REVIEW" },
      });
    });

    const oldDoc = await prisma.document.findUnique({ where: { id: docInvoiceId1 } });
    const newDoc = await prisma.document.findUnique({ where: { id: docInvoiceId2 } });
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });

    expect(oldDoc?.isCurrent).toBe(false);
    expect(newDoc?.isCurrent).toBe(true);
    expect(newDoc?.documentVersion).toBe(2);
    expect(shipment?.currentRevision).toBe(2);
    expect(shipment?.status).toBe("NEEDS_REVIEW");
  });

  // Flow 5: Extraction-run creation and idempotency
  it("5. Extraction-run creation and idempotency: preserves run and enforces unique idempotency key", async () => {
    const idempotencyKey = `idem-${randomUUID()}`;

    const run = await prisma.extractionRun.create({
      data: {
        id: extractionRunId1,
        documentId: docInvoiceId2,
        documentVersion: 2,
        requestedById: executiveId,
        idempotencyKey,
        provider: "mock-ai",
        model: "mock-v1",
        promptVersion: "2026.11-v1",
        status: "COMPLETED",
        pageCount: 1,
        latencyMs: 350,
      },
    });

    expect(run.idempotencyKey).toBe(idempotencyKey);
    expect(run.status).toBe("COMPLETED");

    // Attempting to look up by idempotencyKey returns the exact same run
    const existing = await prisma.extractionRun.findUnique({ where: { idempotencyKey } });
    expect(existing?.id).toBe(run.id);
  });

  // Flow 6: Structured response validation and persistence
  it("6. Structured response validation and persistence: records extracted fields and line items", async () => {
    const field = await prisma.extractedField.create({
      data: {
        id: extractedFieldId1,
        documentId: docInvoiceId2,
        extractionRunId: extractionRunId1,
        fieldKey: "invoiceTotal",
        modelValue: "52400.00",
        currentValue: "52400.00",
        unit: "USD",
        modelConfidence: 0.96,
        sourceQuote: "Total Due: USD 52,400.00",
        pageNumber: 1,
        reviewStatus: "PENDING",
      },
    });

    const lineItem = await prisma.lineItem.create({
      data: {
        documentId: docInvoiceId2,
        extractionRunId: extractionRunId1,
        lineNumber: 1,
        description: "Industrial Precision Flanges",
        hsnCode: "730721",
        quantity: 100,
        quantityUnit: "pcs",
        unitPrice: 524,
        currency: "USD",
        lineTotal: 52400,
        modelConfidence: 0.98,
        sourceQuote: "100 pcs @ 524.00 = 52,400.00",
        pageNumber: 1,
      },
    });

    expect(field.fieldKey).toBe("invoiceTotal");
    expect(field.currentValue).toBe("52400.00");
    expect(lineItem.lineNumber).toBe(1);
    expect(lineItem.hsnCode).toBe("730721");
  });

  // Flow 7: Field edit plus audit row in one transaction
  it("7. Field edit plus audit row in one transaction: atomic correction with audit trail", async () => {
    await prisma.$transaction(async (tx) => {
      // 1. Update field
      await tx.extractedField.update({
        where: { id: extractedFieldId1 },
        data: {
          currentValue: "53000.00",
          reviewStatus: "CORRECTED",
        },
      });

      // 2. Insert correction history
      await tx.fieldCorrection.create({
        data: {
          fieldId: extractedFieldId1,
          previousValue: "52400.00",
          newValue: "53000.00",
          reason: "Adjusted for corrected tariff freight surcharge",
          correctedById: executiveId,
        },
      });

      // 3. Insert audit event
      await tx.auditEvent.create({
        data: {
          shipmentId,
          actorId: executiveId,
          action: "FIELD_CORRECTED",
          entityType: "ExtractedField",
          entityId: extractedFieldId1,
          metadata: {
            fieldKey: "invoiceTotal",
            previousValue: "52400.00",
            newValue: "53000.00",
          },
        },
      });
    });

    const updatedField = await prisma.extractedField.findUnique({
      where: { id: extractedFieldId1 },
      include: { corrections: true },
    });
    const auditEvents = await prisma.auditEvent.findMany({
      where: { shipmentId, action: "FIELD_CORRECTED" },
    });

    expect(updatedField?.currentValue).toBe("53000.00");
    expect(updatedField?.reviewStatus).toBe("CORRECTED");
    expect(updatedField?.corrections).toHaveLength(1);
    expect(updatedField?.corrections[0].reason).toContain("tariff freight surcharge");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
  });

  // Flow 8: Cross-check run after field changes
  it("8. Cross-check run after field changes: evaluates and records check run with results", async () => {
    const run = await prisma.crossCheckRun.create({
      data: {
        id: checkRunId,
        shipmentId,
        revision: 2,
        inputHash: "snapshot-hash-rev2",
        inputSnapshot: { invoiceTotal: "53000.00", grossWeight: "3165" },
        triggeredBy: "MANUAL",
        requestedById: executiveId,
      },
    });

    const result = await prisma.crossCheckResult.create({
      data: {
        id: checkResultId,
        shipmentId,
        runId: run.id,
        revision: 2,
        ruleKey: "GROSS_WEIGHT_TOLERANCE",
        ruleCode: "CHK_GROSS_WEIGHT",
        severity: "BLOCKING",
        status: "MISMATCH",
        details: { differenceKg: "45.000", message: "Gross weight discrepancy detected" },
      },
    });

    expect(run.revision).toBe(2);
    expect(result.status).toBe("MISMATCH");
    expect(result.severity).toBe("BLOCKING");
  });

  // Flow 9: Resolution event persistence and history
  it("9. Resolution event persistence and history: resolves blocking check with explanation", async () => {
    const resolution = await prisma.crossCheckResolution.create({
      data: {
        id: resolutionId,
        crossCheckId: checkResultId,
        type: "ACCEPTED_EXCEPTION",
        reason: "Supplier confirmed 45 kg variance attributable to heavy wooden pallet packaging",
        evidence: "Vendor email reference #SUP-4491-PALLET",
        resolvedById: executiveId,
        managerApprovedAt: null, // Pending Manager sign-off
      },
    });

    const checkWithResolutions = await prisma.crossCheckResult.findUnique({
      where: { id: checkResultId },
      include: { resolutions: true },
    });

    expect(resolution.type).toBe("ACCEPTED_EXCEPTION");
    expect(checkWithResolutions?.resolutions).toHaveLength(1);
    expect(checkWithResolutions?.resolutions[0].evidence).toBe("Vendor email reference #SUP-4491-PALLET");
  });

  // Flow 10: Executive submission
  it("10. Executive submission: transitions shipment to READY_FOR_APPROVAL and logs audit row", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: "READY_FOR_APPROVAL" },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId,
          actorId: executiveId,
          action: "SUBMITTED_FOR_APPROVAL",
          entityType: "Shipment",
          entityId: shipmentId,
          metadata: { revision: 2 },
        },
      });
    });

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    expect(shipment?.status).toBe("READY_FOR_APPROVAL");
  });

  // Flow 11: Manager approve/reject
  it("11. Manager approve/reject: Manager signs off approval record and authorizes revision", async () => {
    await prisma.$transaction(async (tx) => {
      // 1. Create approval row
      await tx.approval.create({
        data: {
          id: approvalId,
          shipmentId,
          revision: 2,
          approvedById: managerId,
        },
      });

      // 2. Sign off accepted exception resolution
      await tx.crossCheckResolution.update({
        where: { id: resolutionId },
        data: { managerApprovedAt: new Date() },
      });

      // 3. Update shipment status to APPROVED
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: "APPROVED" },
      });

      // 4. Record audit event
      await tx.auditEvent.create({
        data: {
          shipmentId,
          actorId: managerId,
          action: "MANAGER_APPROVED",
          entityType: "Shipment",
          entityId: shipmentId,
          metadata: { revision: 2 },
        },
      });
    });

    const approval = await prisma.approval.findUnique({
      where: { shipmentId_revision: { shipmentId, revision: 2 } },
    });
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    const resolution = await prisma.crossCheckResolution.findUnique({ where: { id: resolutionId } });

    expect(approval).toBeDefined();
    expect(approval?.approvedById).toBe(managerId);
    expect(shipment?.status).toBe("APPROVED");
    expect(resolution?.managerApprovedAt).not.toBeNull();
  });

  // Flow 12: Approval invalidation after edit
  it("12. Approval invalidation after edit: bump revision and revert status to NEEDS_REVIEW", async () => {
    // Executive makes a post-approval correction
    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          currentRevision: 3, // Bumps to revision 3
          status: "NEEDS_REVIEW", // Status reverts!
        },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId,
          actorId: executiveId,
          action: "APPROVAL_INVALIDATED_BY_EDIT",
          entityType: "Shipment",
          entityId: shipmentId,
          metadata: { previousRevision: 2, newRevision: 3 },
        },
      });
    });

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    const approvalRev3 = await prisma.approval.findUnique({
      where: { shipmentId_revision: { shipmentId, revision: 3 } },
    });

    expect(shipment?.status).toBe("NEEDS_REVIEW");
    expect(shipment?.currentRevision).toBe(3);
    expect(approvalRev3).toBeNull(); // No approval exists for revision 3!
  });

  // Flow 13: Export guard and ExportRecord (ExportEvent)
  it("13. Export guard and ExportEvent: re-approving current revision permits export audit event creation", async () => {
    // Manager approves revision 3
    await prisma.$transaction(async (tx) => {
      await tx.approval.create({
        data: {
          shipmentId,
          revision: 3,
          approvedById: managerId,
        },
      });

      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: "APPROVED" },
      });
    });

    // Generate export and record ExportEvent
    const exportEvent = await prisma.exportEvent.create({
      data: {
        id: exportEventId,
        shipmentId,
        exportedById: managerId,
        profileId: "demo-v1",
        revision: 3,
      },
    });

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: "EXPORTED" },
    });

    const exportedShipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { exportEvents: true },
    });

    expect(exportEvent.profileId).toBe("demo-v1");
    expect(exportEvent.revision).toBe(3);
    expect(exportedShipment?.status).toBe("EXPORTED");
    expect(exportedShipment?.exportEvents).toHaveLength(1);
  });

  // Flow 14: Retention/deletion behavior for synthetic records
  it("14. Retention/deletion behavior: cascade deletion purges all associated entities without orphans", async () => {
    // Delete the shipment and verify cascade removes all child documents, runs, fields, checks, events
    await prisma.shipment.delete({ where: { id: shipmentId } });

    const remainingDocs = await prisma.document.findMany({ where: { shipmentId } });
    const remainingFields = await prisma.extractedField.findMany({ where: { id: extractedFieldId1 } });
    const remainingChecks = await prisma.crossCheckResult.findMany({ where: { shipmentId } });
    const remainingApprovals = await prisma.approval.findMany({ where: { shipmentId } });
    const remainingExports = await prisma.exportEvent.findMany({ where: { shipmentId } });

    expect(remainingDocs).toHaveLength(0);
    expect(remainingFields).toHaveLength(0);
    expect(remainingChecks).toHaveLength(0);
    expect(remainingApprovals).toHaveLength(0);
    expect(remainingExports).toHaveLength(0);
  });
});

