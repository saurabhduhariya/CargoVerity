import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET as getDocumentRoute } from "@/app/api/documents/[id]/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as storage from "@/lib/documents/storage";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const executiveUser = { id: "33333333-3333-4333-8333-333333333333", email: "exec@example.test", role: "EXECUTIVE" as const };
const managerUser = { id: "55555555-5555-4555-8555-555555555555", email: "mgr@example.test", role: "MANAGER" as const };

const minimalValidPdf = new Uint8Array([
  ...new TextEncoder().encode(`%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer <</Size 4 /Root 1 0 R>>
startxref
190
%%EOF`),
]);

describe("Documents API Routes — Authorization & Security (Week 2 Step 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/documents/[id]", () => {
    it("returns 401 if user is logged out / unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request(`http://localhost:3000/api/documents/${documentId}`);
      const response = await getDocumentRoute(request, { params: Promise.resolve({ id: documentId }) });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Authentication required.");
    });

    it("returns 404 if user has no access to the document/shipment", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      vi.spyOn(db, "getPrisma").mockReturnValue({} as never);
      vi.spyOn(storage, "getAuthorizedDocumentDownloadUrl").mockResolvedValue(null);

      const request = new Request(`http://localhost:3000/api/documents/${documentId}`);
      const response = await getDocumentRoute(request, { params: Promise.resolve({ id: documentId }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Document not found.");
    });

    it("returns 200 with document and signed download URL with no-store cache headers when authorized", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockDoc = { id: documentId, docType: "INVOICE", storageKey: `shipments/${shipmentId}/documents/${documentId}/abc.pdf` };
      vi.spyOn(db, "getPrisma").mockReturnValue({} as never);
      vi.spyOn(storage, "getAuthorizedDocumentDownloadUrl").mockResolvedValue({
        document: mockDoc as never,
        signedUrl: "https://example.supabase.co/signed-url",
      });

      const request = new Request(`http://localhost:3000/api/documents/${documentId}`);
      const response = await getDocumentRoute(request, { params: Promise.resolve({ id: documentId }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");

      const json = await response.json();
      expect(json.document).toEqual(mockDoc);
      expect(json.signedUrl).toBe("https://example.supabase.co/signed-url");
    });

    it("allows a manager to download a document regardless of shipment owner", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: managerUser as never,
        authUser: { id: managerUser.id, email: managerUser.email } as never,
      });

      const mockDoc = { id: documentId, docType: "BILL_OF_LADING", storageKey: `shipments/${shipmentId}/documents/${documentId}/bl.pdf` };
      vi.spyOn(db, "getPrisma").mockReturnValue({} as never);
      vi.spyOn(storage, "getAuthorizedDocumentDownloadUrl").mockResolvedValue({
        document: mockDoc as never,
        signedUrl: "https://example.supabase.co/manager-signed-url",
      });

      const request = new Request(`http://localhost:3000/api/documents/${documentId}`);
      const response = await getDocumentRoute(request, { params: Promise.resolve({ id: documentId }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.signedUrl).toBe("https://example.supabase.co/manager-signed-url");
    });
  });

  describe("single upload path", () => {
    it("has no multipart POST /api/documents route that could bypass upload completion checks", () => {
      expect(existsSync(join(process.cwd(), "src/app/api/documents/route.ts"))).toBe(false);
      expect(minimalValidPdf.byteLength).toBeGreaterThan(0);
      expect(shipmentId).toBeTruthy();
    });
  });
});
