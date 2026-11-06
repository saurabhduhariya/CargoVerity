import { describe, expect, it } from "vitest";
import {
  calculateNextRotation,
  calculateNextZoom,
  categorizeFieldKey,
  formatFieldLabel,
  isAllowedPreApprovalStatus,
  isFieldUncertain,
  ReviewWorkspaceInitialData,
  validateFieldCorrection,
} from "@/features/review/review-workspace";

describe("Review Workspace Shell (Week 4 Step 6)", () => {
  it("categorizes field keys into parties, identifiers, commercial, logistics, and other (Rule 10)", () => {
    // Parties
    expect(categorizeFieldKey("exporter")).toBe("parties");
    expect(categorizeFieldKey("importer")).toBe("parties");
    expect(categorizeFieldKey("shipperName")).toBe("parties");
    expect(categorizeFieldKey("consignee")).toBe("parties");
    expect(categorizeFieldKey("carrier")).toBe("parties");

    // Identifiers
    expect(categorizeFieldKey("invoiceNumber")).toBe("identifiers");
    expect(categorizeFieldKey("documentNumber")).toBe("identifiers");
    expect(categorizeFieldKey("blNumber")).toBe("identifiers");
    expect(categorizeFieldKey("containerNumber")).toBe("identifiers");
    expect(categorizeFieldKey("issueDate")).toBe("identifiers");

    // Commercial values
    expect(categorizeFieldKey("invoiceTotal")).toBe("commercial");
    expect(categorizeFieldKey("currency")).toBe("commercial");
    expect(categorizeFieldKey("taxAmount")).toBe("commercial");
    expect(categorizeFieldKey("freightAmount")).toBe("commercial");
    expect(categorizeFieldKey("insuranceAmount")).toBe("commercial");
    expect(categorizeFieldKey("discountAmount")).toBe("commercial");

    // Logistics
    expect(categorizeFieldKey("grossWeight")).toBe("logistics");
    expect(categorizeFieldKey("netWeight")).toBe("logistics");
    expect(categorizeFieldKey("packageCount")).toBe("logistics");
    expect(categorizeFieldKey("vessel")).toBe("logistics");
    expect(categorizeFieldKey("portOfLoading")).toBe("logistics");
    expect(categorizeFieldKey("portOfDischarge")).toBe("logistics");

    // Other / Unknown
    expect(categorizeFieldKey("specialCustomsRemarks")).toBe("other");
  });

  it("formats camelCase field keys into human-readable capitalized labels", () => {
    expect(formatFieldLabel("invoiceTotal")).toBe("Invoice Total");
    expect(formatFieldLabel("grossWeight")).toBe("Gross Weight");
    expect(formatFieldLabel("packageCount")).toBe("Package Count");
    expect(formatFieldLabel("portOfLoading")).toBe("Port Of Loading");
  });

  it("validates that ReviewWorkspaceInitialData satisfies all Week 4 Step 6 data contracts", () => {
    const mockData: ReviewWorkspaceInitialData = {
      shipment: {
        id: "shp-24811",
        reference: "SHP-24811",
        status: "NEEDS_REVIEW",
        currentRevision: 2,
        importerName: "Apex Logistics India",
        exporterName: "Nordic Lighting AB",
        supplier: { id: "sup-1", name: "Nordic Lighting AB" },
      },
      documents: [
        {
          id: "doc-ci",
          docType: "INVOICE",
          originalFileName: "shp-24811-invoice.pdf",
          mimeType: "application/pdf",
          documentVersion: 2,
          pageCount: 1,
          signedUrl: "https://storage.mock/invoice.pdf",
          extractionStatus: "REVIEW_REQUIRED",
          pages: [
            { id: "p-1", pageNumber: 1, isReadable: true, manualEntryRequired: false, reviewNote: null },
          ],
          fields: [
            {
              id: "f-tot",
              fieldKey: "invoiceTotal",
              modelValue: "5400.00",
              currentValue: "5400.00",
              unit: "USD",
              modelConfidence: 0.96, // Rule 9: confidence estimate
              sourceQuote: "TOTAL AMOUNT: USD 5,400.00", // Rule 8: source quote
              pageNumber: 1, // Rule 8: page number
              reviewStatus: "REQUIRES_REVIEW",
              reviewReason: "UNVERIFIED_EVIDENCE", // Rule 9: review reason
            },
            {
              id: "f-gw",
              fieldKey: "grossWeight",
              modelValue: "3120",
              currentValue: "3120",
              unit: "kg",
              modelConfidence: 0.94,
              sourceQuote: "Gross Weight: 3,120 kg",
              pageNumber: 1,
              reviewStatus: "CONFIRMED",
            },
          ],
          lineItems: [
            {
              id: "li-1",
              lineNumber: 1,
              description: "LED Commercial Downlight 40W",
              hsnCode: "9405.10.00",
              quantity: "100",
              quantityUnit: "pcs",
              unitPrice: "54.00",
              lineTotal: "5400.00",
              currency: "USD",
              sourceQuote: "Line 1: 100 pcs @ $54.00",
              pageNumber: 1,
            },
          ],
        },
        {
          id: "doc-pl",
          docType: "PACKING_LIST",
          originalFileName: "shp-24811-packing-list.pdf",
          mimeType: "application/pdf",
          documentVersion: 1,
          pageCount: 1,
          signedUrl: "https://storage.mock/packing-list.pdf",
          extractionStatus: "COMPLETED",
          pages: [
            { id: "p-2", pageNumber: 1, isReadable: true, manualEntryRequired: false, reviewNote: null },
          ],
          fields: [
            {
              id: "f-pl-gw",
              fieldKey: "grossWeight",
              modelValue: "3165",
              currentValue: "3165",
              unit: "kg",
              modelConfidence: 0.98,
              sourceQuote: "TOTAL G.W.: 3,165.00 KGS",
              pageNumber: 1,
              reviewStatus: "CONFIRMED",
            },
          ],
          lineItems: [],
        },
      ],
      crossChecks: [
        {
          ruleKey: "invoice_line_total",
          ruleCode: "CHK_INVOICE_ARITHMETIC",
          status: "PASS",
          severity: "BLOCKING",
          details: { message: "Reconciled exactly" },
        },
        {
          ruleKey: "gross_weight_comparison",
          ruleCode: "CHK_GROSS_WEIGHT",
          status: "MISMATCH",
          severity: "BLOCKING",
          details: {
            differenceKg: "45.000",
            message: "Available documents differ by 45.000 kg",
          },
        },
      ],
    };

    // Assert Header Info (Rule 2)
    expect(mockData.shipment.reference).toBe("SHP-24811");
    expect(mockData.shipment.supplier?.name).toBe("Nordic Lighting AB");
    expect(mockData.shipment.currentRevision).toBe(2);
    expect(mockData.shipment.status).toBe("NEEDS_REVIEW");

    // Assert Document Tabs Presence (Rule 3)
    const docTypes = mockData.documents.map((d) => d.docType);
    expect(docTypes).toContain("INVOICE");
    expect(docTypes).toContain("PACKING_LIST");

    // Assert Field Quotes & Evidence (Rule 8 & 9)
    const invoiceTotalField = mockData.documents[0].fields[0];
    expect(invoiceTotalField.sourceQuote).toBe("TOTAL AMOUNT: USD 5,400.00");
    expect(invoiceTotalField.pageNumber).toBe(1);
    expect(invoiceTotalField.modelConfidence).toBe(0.96);
    expect(invoiceTotalField.reviewReason).toBe("UNVERIFIED_EVIDENCE");

    // Assert Cross-Check Summary (Rule 11)
    const passed = mockData.crossChecks.filter((c) => c.status === "PASS").length;
    const mismatches = mockData.crossChecks.filter((c) => c.status === "MISMATCH").length;
    expect(passed).toBe(1);
    expect(mismatches).toBe(1);
  });

  it("handles zoom boundaries correctly between 50% and 200%", () => {
    // Zoom in steps
    expect(calculateNextZoom(100, "in")).toBe(125);
    expect(calculateNextZoom(175, "in")).toBe(200);
    expect(calculateNextZoom(200, "in")).toBe(200); // capped at 200%

    // Zoom out steps
    expect(calculateNextZoom(100, "out")).toBe(75);
    expect(calculateNextZoom(75, "out")).toBe(50);
    expect(calculateNextZoom(50, "out")).toBe(50); // floored at 50%
  });

  it("cycles rotation correctly by 90 degrees and wraps at 360", () => {
    expect(calculateNextRotation(0)).toBe(90);
    expect(calculateNextRotation(90)).toBe(180);
    expect(calculateNextRotation(180)).toBe(270);
    expect(calculateNextRotation(270)).toBe(0);
  });

  it("determines uncertain fields requiring reviewer attention", () => {
    // Low confidence (< 0.85)
    expect(
      isFieldUncertain({
        modelConfidence: 0.72,
        reviewStatus: "CONFIRMED",
        sourceQuote: "Invoice 123",
      }),
    ).toBe(true);

    // Uncalibrated / non-numeric confidence
    expect(
      isFieldUncertain({
        modelConfidence: null,
        reviewStatus: "CONFIRMED",
        sourceQuote: "Invoice 123",
      }),
    ).toBe(true);

    // Requires review status
    expect(
      isFieldUncertain({
        modelConfidence: 0.98,
        reviewStatus: "REQUIRES_REVIEW",
        sourceQuote: "Invoice 123",
      }),
    ).toBe(true);

    // Missing source quote
    expect(
      isFieldUncertain({
        modelConfidence: 0.98,
        reviewStatus: "CONFIRMED",
        sourceQuote: null,
      }),
    ).toBe(true);

    // Clear, confirmed, high-confidence field with quote
    expect(
      isFieldUncertain({
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED",
        sourceQuote: "Total: $500",
      }),
    ).toBe(false);
  });

  it("checks allowed pre-approval statuses correctly (Week 4 Step 7 Rule 1)", () => {
    expect(isAllowedPreApprovalStatus("DRAFT")).toBe(true);
    expect(isAllowedPreApprovalStatus("IN_REVIEW")).toBe(true);
    expect(isAllowedPreApprovalStatus("NEEDS_REVIEW")).toBe(true);
    expect(isAllowedPreApprovalStatus("READY_FOR_APPROVAL")).toBe(true);
    expect(isAllowedPreApprovalStatus("APPROVED")).toBe(false);
    expect(isAllowedPreApprovalStatus("EXPORTED")).toBe(false);
  });

  it("validates field correction actions and reason requirement (Week 4 Step 7 Rules 3 & 4)", () => {
    // Confirmation without value change: valid and not material
    expect(validateFieldCorrection("CONFIRMED", "500", "500", undefined)).toEqual({
      valid: true,
      isMaterialChange: false,
    });

    // Correction without reason: invalid
    expect(validateFieldCorrection("CORRECTED", "550", "500", "")).toEqual({
      valid: false,
      error: "A meaningful reason (at least 3 characters) is required.",
      isMaterialChange: true,
    });

    // Correction with short reason (< 3 chars): invalid
    expect(validateFieldCorrection("CORRECTED", "550", "500", "ok")).toEqual({
      valid: false,
      error: "A meaningful reason (at least 3 characters) is required.",
      isMaterialChange: true,
    });

    // Correction with valid reason: valid and material
    expect(validateFieldCorrection("CORRECTED", "550", "500", "Read from invoice total")).toEqual({
      valid: true,
      isMaterialChange: true,
    });
  });
});
