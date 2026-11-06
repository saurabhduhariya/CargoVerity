import type { DocumentType } from "@/lib/ai/types";

export type RenderedPage = {
  pageNumber: number;
  imageBase64: string;
  mimeType: "image/jpeg";
};

export async function renderBlobPages(blob: Blob, mimeType: string): Promise<RenderedPage[]> {
  if (mimeType === "image/png" || mimeType === "image/jpeg") {
    const image = await createImageBitmap(blob);
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(image.width * scale));
    canvas.height = Math.max(1, Math.ceil(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return [
      {
        pageNumber: 1,
        imageBase64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "",
        mimeType: "image/jpeg",
      },
    ];
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  if (pdf.numPages > 50) {
    throw new Error("This demo accepts at most 50 PDF pages.");
  }

  const pages: RenderedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const initialViewport = page.getViewport({ scale: 1.5 });
    const scale = Math.min(1.5, 1800 / Math.max(initialViewport.width, initialViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    pages.push({
      pageNumber,
      imageBase64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "",
      mimeType: "image/jpeg",
    });
  }

  return pages;
}

export type ExtractionProgressCallback = (step: string) => void;

export async function runDocumentExtraction(params: {
  documentId: string;
  documentType: DocumentType;
  signedUrl?: string;
  fileBlob?: Blob;
  mimeType?: string;
  onProgress?: ExtractionProgressCallback;
}) {
  const { documentId, documentType, onProgress } = params;

  onProgress?.("Obtaining secure download authorization…");

  let blob = params.fileBlob;
  let mimeType = params.mimeType ?? "application/pdf";

  if (!blob) {
    let signedUrl = params.signedUrl;
    if (!signedUrl) {
      const docRes = await fetch(`/api/documents/${documentId}`, {
        headers: { "Cache-Control": "no-store" },
      });
      const docData = await docRes.json();
      if (!docRes.ok || !docData.signedUrl) {
        throw new Error(docData.error ?? "Failed to obtain authorized document download URL.");
      }
      signedUrl = docData.signedUrl;
      if (docData.document?.mimeType) {
        mimeType = docData.document.mimeType;
      }
    }

    onProgress?.("Downloading document from private storage…");
    if (!signedUrl) {
      throw new Error("Missing signed URL for document download.");
    }
    const fileRes = await fetch(signedUrl);
    if (!fileRes.ok) {
      throw new Error(`Failed to download document: HTTP ${fileRes.status}`);
    }
    blob = await fileRes.blob();
  }

  onProgress?.("Rendering pages locally with PDF.js…");
  const pages = await renderBlobPages(blob, mimeType);

  let runId: string | undefined;
  let fieldCount = 0;
  let lineItemCount = 0;
  let warningCount = 0;
  let detectedDocType: string | null = null;
  let typeMismatch = false;

  for (let index = 0; index < pages.length; index += 3) {
    const batch = pages.slice(index, index + 3);
    const startP = batch[0]?.pageNumber;
    const endP = batch.at(-1)?.pageNumber;
    onProgress?.(`Extracting pages ${startP}–${endP} with AI model…`);

    const response = await fetch("/api/extractions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        documentType,
        runId,
        batchNumber: Math.floor(index / 3),
        isFinal: index + 3 >= pages.length,
        pages: batch,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "AI extraction failed.");
    }

    runId = data.runId;
    if (data.result) {
      fieldCount += data.result.fields?.length ?? 0;
      lineItemCount += data.result.lineItems?.length ?? 0;
      warningCount += data.result.warnings?.length ?? 0;
      if (data.result.documentType) {
        detectedDocType = data.result.documentType;
        typeMismatch = detectedDocType !== documentType;
      }
    }
  }

  onProgress?.("Extraction completed.");

  return {
    runId,
    fieldCount,
    lineItemCount,
    warningCount,
    detectedDocType,
    typeMismatch,
  };
}
