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
    throw new Error("PDF documents are limited to 50 pages.");
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

/** Error carrying the server's safe error code so the UI can show a plain-language message. */
export class ExtractionRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "ExtractionRequestError";
  }
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * Starts (or resumes) the server-side run, then renders the stored document with PDF.js and
 * sends it in batches of up to 3 pages. A completed run is served from the database, and a
 * batch the server already stored is not sent to the provider again.
 */
async function runDocumentExtractionOnce(params: {
  documentId: string;
  documentType: DocumentType;
  signedUrl?: string;
  fileBlob?: Blob;
  mimeType?: string;
  retry?: boolean;
  onProgress?: ExtractionProgressCallback;
}) {
  const { documentId, documentType, onProgress } = params;

  onProgress?.("Starting extraction run…");
  const startRes = await fetch(`/api/documents/${documentId}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retry: Boolean(params.retry) }),
  });
  const started = await readJson(startRes);
  if (!startRes.ok) {
    throw new ExtractionRequestError(started.error ?? "Could not start extraction.", started.code);
  }
  if (started.status === "COMPLETED") {
    onProgress?.("Extraction already completed for this document version.");
    return { runId: started.runId as string, cached: true, fieldCount: 0, lineItemCount: 0, warningCount: 0 };
  }
  if (started.status === "FAILED") {
    throw new ExtractionRequestError(
      "The last extraction failed. Use Retry extraction to start a new run.",
      "RUN_CLOSED",
    );
  }
  const runId = started.runId as string;

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

  let fieldCount = 0;
  let lineItemCount = 0;
  let warningCount = 0;

  for (let index = 0; index < pages.length; index += 3) {
    const batch = pages.slice(index, index + 3);
    onProgress?.(
      `Extracting pages ${batch[0]?.pageNumber}–${batch.at(-1)?.pageNumber} of ${pages.length} with the AI model…`,
    );

    const response = await fetch("/api/extractions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        documentType,
        runId,
        batchNumber: Math.floor(index / 3),
        pages: batch,
      }),
    });

    const data = await readJson(response);
    if (!response.ok) {
      throw new ExtractionRequestError(
        data.error ?? "AI extraction failed.",
        data.code,
        typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined,
      );
    }
    if (data.result) {
      fieldCount += data.result.fields?.length ?? 0;
      lineItemCount += data.result.lineItems?.length ?? 0;
      warningCount += data.result.warnings?.length ?? 0;
    }
    if (data.isFinal) break;
  }

  onProgress?.("Extraction completed.");
  return { runId, cached: false, fieldCount, lineItemCount, warningCount };
}

const MAX_RATE_LIMIT_WAITS = 3;
const FALLBACK_WAIT_SECONDS = 30;
const MAX_WAIT_SECONDS = 120;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs one document's extraction. When the AI provider's per-minute limit is hit, it waits for
 * the time the provider asked for, shows a countdown, and starts a new run (the limited run stays
 * in history as failed). After three waits the rate-limit error is shown as before.
 */
export async function runDocumentExtraction(params: Parameters<typeof runDocumentExtractionOnce>[0]) {
  let retry = Boolean(params.retry);
  for (let waits = 0; ; waits += 1) {
    try {
      return await runDocumentExtractionOnce({ ...params, retry });
    } catch (error) {
      if (!(error instanceof ExtractionRequestError) || error.code !== "RATE_LIMIT" || waits >= MAX_RATE_LIMIT_WAITS) throw error;
      const seconds = Math.min(Math.max(error.retryAfterSeconds ?? FALLBACK_WAIT_SECONDS, 1), MAX_WAIT_SECONDS) + 1;
      for (let remaining = seconds; remaining > 0; remaining -= 1) {
        params.onProgress?.(`The AI provider allows limited output per minute. Retrying in ${remaining} s (attempt ${waits + 2} of ${MAX_RATE_LIMIT_WAITS + 1})…`);
        await sleep(1000);
      }
      retry = true;
    }
  }
}
