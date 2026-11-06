import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createSamplePdf,
  generateAllSampleDocs,
  sampleFixtures,
} from "../../scripts/generate-sample-docs";
import { parsePdfAndCountPages } from "@/lib/documents/validation";

describe("Synthetic Documents Generation & Manifest (Week 2 Step 4)", () => {
  it("defines exactly 5 scenarios with 15 document fixtures", () => {
    expect(sampleFixtures.length).toBe(15);

    const references = new Set(sampleFixtures.map((f) => f.config.reference));
    expect(references).toEqual(
      new Set(["SHP-24811", "SHP-24812", "SHP-24813", "SHP-24814", "SHP-24815"]),
    );
  });

  it("preserves exact brief facts and the 45 kg discrepancy for SHP-24811 without fabricating a cause", () => {
    const ci = sampleFixtures.find((f) => f.fileName === "shp-24811-invoice.pdf")!;
    const pl = sampleFixtures.find((f) => f.fileName === "shp-24811-packing-list.pdf")!;

    expect(ci.config.exporter).toBe("Company B (China)");
    expect(ci.config.grossWeightKg).toBe(3120); // 3,120 kg from brief
    expect(ci.config.lineItems[0].quantity).toBe(2400); // 2,400 from brief
    expect(ci.config.lineItems[0].unitPrice).toBe(6.8); // USD 6.80 from brief

    expect(pl.config.grossWeightKg).toBe(3165); // 3,165 kg from brief

    // Difference must be exactly 45 kg
    const diff = pl.config.grossWeightKg - ci.config.grossWeightKg;
    expect(diff).toBe(45);
  });

  it("preserves exact brief facts for SHP-24812", () => {
    const ci = sampleFixtures.find((f) => f.fileName === "shp-24812-invoice.pdf")!;

    expect(ci.config.exporter).toBe("Company C (Sweden)");
    expect(ci.config.grossWeightKg).toBe(1460); // 1,460 kg from brief
    expect(ci.config.lineItems[0].quantity).toBe(180); // 180 units from brief
    expect(ci.config.lineItems[0].unitPrice).toBe(42.5); // EUR 42.50 from brief
    expect(ci.config.currency).toBe("EUR");
  });

  it("embeds the synthetic demo watermark on generated documents", async () => {
    const sample = sampleFixtures[0];
    const pdfBytes = await createSamplePdf(sample.config);

    // Parse with pdfjs-dist to verify extracted text includes the watermark
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: pdfBytes.slice(), useSystemFonts: true });
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);

    const page = await doc.getPage(1);
    const textContent = await page.getTextContent();
    const fullText = textContent.items.map((item: unknown) => (item as { str: string }).str).join(" ");

    expect(fullText).toContain("SYNTHETIC DEMO DOCUMENT");
    expect(fullText).toContain("NOT FOR CUSTOMS FILING");

    // Also verify with our validation engine
    const validatedPageCount = await parsePdfAndCountPages(pdfBytes);
    expect(validatedPageCount).toBe(1);
  });

  it("generates all 15 PDF files into a target directory", async () => {
    const tempDir = join(tmpdir(), `sample-docs-test-${Date.now()}`);
    const paths = await generateAllSampleDocs(tempDir);

    expect(paths.length).toBe(15);
    for (const p of paths) {
      expect(existsSync(p)).toBe(true);
      const content = readFileSync(p);
      expect(content.byteLength).toBeGreaterThan(500);

      // Verify PDF magic bytes %PDF-
      expect(content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  it("verifies all 15 committed fixture files exist in public/sample-docs/", () => {
    const publicDir = join(process.cwd(), "public", "sample-docs");
    for (const fixture of sampleFixtures) {
      const p = join(publicDir, fixture.fileName);
      expect(existsSync(p)).toBe(true);
      const content = readFileSync(p);
      expect(content.byteLength).toBeGreaterThan(500);
      expect(content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  it("provides docs/sample-data-manifest.md with full provenance documentation", () => {
    const manifestPath = join(process.cwd(), "docs", "sample-data-manifest.md");
    expect(existsSync(manifestPath)).toBe(true);

    const content = readFileSync(manifestPath, "utf-8");
    expect(content).toContain("SYNTHETIC DEMO DOCUMENTS — NOT FOR CUSTOMS FILING");
    expect(content).toContain("SHP-24811");
    expect(content).toContain("3,120 kg");
    expect(content).toContain("3,165 kg");
    expect(content).toContain("45 kg");
    expect(content).toContain("SHP-24812");
    expect(content).toContain("SHP-24813");
    expect(content).toContain("SHP-24814");
    expect(content).toContain("SHP-24815");
  });
});
