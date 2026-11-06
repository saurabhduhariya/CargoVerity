import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET as getDocumentRoute } from "@/app/api/documents/[id]/route";
import { POST as postDocumentRoute } from "@/app/api/documents/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as storage from "@/lib/documents/storage";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const executiveUser = { id: "33333333-3333-4333-8333-333333333333", email: "exec@example.test", role: "EXECUTIVE" as const };
const managerUser = { id: "55555555-5555-4555-8555-555555555555", email: "mgr@example.test", role: "MANAGER" as const };

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

  describe("POST /api/documents", () => {
    it("returns 401 if user is logged out / unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const formData = new FormData();
      formData.append("shipmentId", shipmentId);
      formData.append("documentType", "INVOICE");
      formData.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "invoice.pdf", { type: "application/pdf" }));

      const request = new Request("http://localhost:3000/api/documents", {
        method: "POST",
        body: formData,
      });

      const response = await postDocumentRoute(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Authentication required.");
    });

    it("returns 400 when user does not have permission to upload to another user's shipment", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      vi.spyOn(db, "getPrisma").mockReturnValue({} as never);
      vi.spyOn(storage, "authorizeShipmentAccess").mockRejectedValue(new Error("Shipment not found or inaccessible."));

      const formData = new FormData();
      formData.append("shipmentId", shipmentId);
      formData.append("documentType", "INVOICE");
      formData.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "invoice.pdf", { type: "application/pdf" }));

      const request = new Request("http://localhost:3000/api/documents", {
        method: "POST",
        body: formData,
      });

      const response = await postDocumentRoute(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Shipment not found or inaccessible.");
    });
  });
});
