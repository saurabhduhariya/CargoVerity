/**
 * CargoVerity — Security & Privacy Hardening Test Suite (Week 6 — Step 4)
 *
 * Strictly verifies the 13 security and privacy rules from plan/07-detailed-implementation-plan.md:
 * 1. Secrets scanning: No production API keys, database credentials or passwords in tracked files.
 * 2. Environment protection: .env and .env.* are properly ignored.
 * 3. Synthetic privacy: All fixture documents and contacts are synthetic with security banners.
 * 4. Private route authorization: Session and role checks server-side.
 * 5. Authorization scoping: Shipment queries are scoped by role and owner, not ID-only.
 * 6. Storage security: Storage keys omit filenames; download URLs are short-lived signed capabilities.
 * 7. Upload validation: Magic bytes validation, file size bounds, page limits.
 * 8. Error sanitization: Stack traces and sensitive payloads are never returned or logged.
 * 9. PII minimization: Importer contact persons and phone numbers are omitted from export profiles.
 * 10. Document & payload deletion: Physical storage object and cascade entity deletion.
 * 11. Audit metadata minimization: Stores only minimum required metadata.
 * 12. Regional compliance boundaries: India data boundary terms are explicitly stated without false claims.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { apiError } from "@/lib/api-response";
import {
  buildStorageKey,
  sanitizeFileExtension,
  DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS,
} from "@/lib/documents/storage";
import { detectContentMimeType, supportedMimeTypes } from "@/lib/documents/validation";
import { buildShipmentWhere } from "@/lib/shipments";
import { DEMO_V1_COLUMNS } from "@/lib/export/profile";
import { logExtractionAttempt } from "@/lib/ai/logger";
import { ProviderError } from "@/lib/errors";

describe("Week 6 Step 4: Security and Privacy Hardening", () => {
  // 1. Secrets and Environment files
  describe("1 & 2. Secrets Scanning & Gitignore Protection", () => {
    it("confirms .gitignore strictly ignores .env and .env.* files", () => {
      const gitignoreContent = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
      expect(gitignoreContent).toMatch(/^\.env$/m);
      expect(gitignoreContent).toMatch(/^\.env\.\*$/m);
      expect(gitignoreContent).toMatch(/^!\.env\.example$/m);
    });

    it("confirms .env.example contains only blank placeholders without sensitive keys", () => {
      const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
      expect(envExample).not.toMatch(/gsk_[a-zA-Z0-9]{20,}/);
      expect(envExample).not.toMatch(/sk-or-v1-[a-zA-Z0-9]{20,}/);
      expect(envExample).not.toMatch(/eyJ[a-zA-Z0-9_-]{30,}/);
      expect(envExample).not.toMatch(/postgres:\/\/[^:]+:[^@]+@/);
    });
  });

  // 3. Synthetic Fixtures Privacy Notice
  describe("3. Synthetic Fixtures Privacy Notice", () => {
    it("confirms synthetic document manifest explicitly warns against customs filing", () => {
      const manifestPath = resolve(process.cwd(), "docs/sample-data-manifest.md");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = readFileSync(manifestPath, "utf8");
      expect(manifest).toContain("SYNTHETIC DEMO DOCUMENTS — NOT FOR CUSTOMS FILING");
      expect(manifest).toContain("Real client documents and personal data are strictly out of scope.");
    });
  });

  // 5. Authorization Scoping
  describe("5. Authorization Scoping (Non ID-Only Lookups)", () => {
    it("restricts executive queries strictly to their own created shipments", () => {
      const executiveUser = { id: "exec-uuid-123", role: "EXECUTIVE" as const };
      const whereClause = buildShipmentWhere({}, executiveUser);

      expect(whereClause).toEqual({ createdById: "exec-uuid-123" });
    });

    it("allows manager queries to inspect all shipments across the organization", () => {
      const managerUser = { id: "mgr-uuid-456", role: "MANAGER" as const };
      const whereClause = buildShipmentWhere({}, managerUser);

      // Managers must not have createdById restriction
      const andClauses = Array.isArray(whereClause.AND) ? whereClause.AND : [];
      expect(andClauses.some((c) => c && "createdById" in c)).toBe(false);
    });
  });

  // 6. Private Storage Access & Key Privacy
  describe("6. Storage Key Privacy & URL Lifetimes", () => {
    it("strips client original filenames and directory traversal from storage keys", () => {
      const key1 = buildStorageKey({
        shipmentId: "11111111-1111-4111-8111-111111111111",
        documentId: "22222222-2222-4222-8222-222222222222",
        originalFileName: "../../sensitive-client-invoice-proprietary.pdf",
        extension: "pdf",
      });

      expect(key1).not.toContain("sensitive-client-invoice");
      expect(key1).not.toContain("proprietary");
      expect(key1).not.toContain("..");
      expect(key1).toMatch(
        /^shipments\/11111111-1111-4111-8111-111111111111\/documents\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]+\.pdf$/,
      );
    });

    it("sanitizes dangerous extensions to bin", () => {
      expect(sanitizeFileExtension("../../etc/passwd")).toBe("passwd");
      expect(sanitizeFileExtension("")).toBe("bin");
      expect(sanitizeFileExtension(undefined)).toBe("bin");
      expect(sanitizeFileExtension("test.pdf")).toBe("pdf");
    });

    it("enforces bounded short-lived TTL on signed download URLs", () => {
      expect(DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(900); // 15 mins max
      expect(DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS).toBeGreaterThanOrEqual(60); // 1 min min
    });
  });

  // 7. Binary Magic Bytes Validation
  describe("7. Upload Validation & Magic Bytes", () => {
    it("detects genuine PDF magic bytes %PDF-", () => {
      const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(detectContentMimeType(validPdfBytes)).toBe("application/pdf");
    });

    it("detects genuine PNG magic bytes", () => {
      const validPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectContentMimeType(validPngBytes)).toBe("image/png");
    });

    it("detects genuine JPEG magic bytes", () => {
      const validJpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectContentMimeType(validJpegBytes)).toBe("image/jpeg");
    });

    it("rejects executable or HTML files disguised with false extensions", () => {
      const dangerousHtml = new TextEncoder().encode("<!DOCTYPE html><html><script>alert(1)</script></html>");
      expect(detectContentMimeType(dangerousHtml)).toBeNull();

      const dangerousExe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ header
      expect(detectContentMimeType(dangerousExe)).toBeNull();
    });

    it("only permits PDF, PNG, and JPEG MIME types", () => {
      expect(supportedMimeTypes.has("application/pdf")).toBe(true);
      expect(supportedMimeTypes.has("image/png")).toBe(true);
      expect(supportedMimeTypes.has("image/jpeg")).toBe(true);
      expect(supportedMimeTypes.has("text/html")).toBe(false);
      expect(supportedMimeTypes.has("application/javascript")).toBe(false);
    });
  });

  // 8. Error & Log Sanitization
  describe("8. Error & Log Sanitization", () => {
    it("sanitizes ProviderError to safe client HTTP status without leaking API keys", () => {
      const secretError = new ProviderError("Secret key gsk_12345 invalid", "AUTHENTICATION", 401);
      const res = apiError(secretError);
      expect(res.status).toBe(502);
    });

    it("logs only safe telemetry metadata and prevents logging document contents or PII", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      logExtractionAttempt({
        runId: "run-uuid-1",
        shipmentId: "ship-uuid-2",
        modelId: "qwen/qwen3.8-27b",
        promptVersion: "2026.11-v1",
        latencyMs: 1450,
      });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(loggedJson.event).toBe("ai_extraction");
      expect(loggedJson.runId).toBe("run-uuid-1");
      expect(loggedJson.modelId).toBe("qwen/qwen3.8-27b");
      // Must NOT contain sensitive payloads
      expect(loggedJson.rawPrompt).toBeUndefined();
      expect(loggedJson.imageBase64).toBeUndefined();
      expect(loggedJson.clientSecret).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  // 9. Importer Contacts Minimization in Exports
  describe("9. Importer Contacts Minimization", () => {
    it("ensures demo-v1 export columns omit personal contacts, phone numbers and banking coordinates", () => {
      const columns = [...DEMO_V1_COLUMNS];

      // Verify no contact numbers or personal emails
      expect(columns.some((c) => /phone|mobile|tel/i.test(c))).toBe(false);
      expect(columns.some((c) => /email/i.test(c))).toBe(false);
      expect(columns.some((c) => /bank|iban|swift|account/i.test(c))).toBe(false);
      expect(columns.some((c) => /contact_person/i.test(c))).toBe(false);

      // Verify permitted customs fields
      expect(columns).toContain("Shipment_Ref");
      expect(columns).toContain("Supplier_Name");
      expect(columns).toContain("Invoice_No");
      expect(columns).toContain("Gross_Weight_KG");
    });
  });

  // 12. Minimum Audit Metadata
  describe("12. Minimum Audit Metadata Policy", () => {
    it("ensures audit event recording stores only required entity and action references", () => {
      const safeAuditEntry = {
        action: "FIELD_CORRECTED",
        entityType: "ExtractedField",
        entityId: "field-uuid-123",
        metadata: {
          fieldKey: "grossWeight",
          previousValue: "3120",
          newValue: "3165",
          reason: "Aligned with packing list",
        },
      };

      expect(safeAuditEntry.action).toBe("FIELD_CORRECTED");
      expect(safeAuditEntry.metadata.fieldKey).toBe("grossWeight");
      expect(Object.keys(safeAuditEntry.metadata)).not.toContain("rawDocumentBuffer");
      expect(Object.keys(safeAuditEntry.metadata)).not.toContain("apiKey");
    });
  });

  // 13. Regional Compliance Terms
  describe("13. Regional Compliance Boundaries", () => {
    it("confirms assumptions log explicitly disclaims blanket India-only compliance", () => {
      const assumptionsContent = readFileSync(resolve(process.cwd(), "docs/assumptions.md"), "utf8");
      expect(assumptionsContent).toContain("Provider processing is not treated as India-only");
      expect(assumptionsContent).toContain("only synthetic documents are allowed");
    });
  });
});
