"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Week 4 Step 6: document evidence viewer.
 *
 * - PDFs render on a <canvas> through PDF.js (no browser PDF iframe), so page, zoom and rotation
 *   behave the same in every browser and the page shown is exactly the page cited by the field.
 * - PNG/JPEG render in a constrained <img> that fits its container and scrolls when zoomed.
 * - The parent owns page / zoom / rotation (toolbar, keyboard shortcuts and source-page links).
 * - Loading, error and retry states are announced through an aria-live region.
 */

type PdfPageProxy = {
  getViewport: (options: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }) => { promise: Promise<void>; cancel: () => void };
  rotate?: number;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

export type DocumentViewerProps = {
  url: string;
  mimeType: string;
  fileName: string;
  /** 1-based page number to show (PDF only). */
  page: number;
  /** Zoom in percent (100 = fit width). */
  zoom: number;
  /** Clockwise rotation in degrees (0, 90, 180, 270). */
  rotation: number;
  /** Reports the real page count once the PDF loads. */
  onPageCount?: (count: number) => void;
  /** Called before a retry so the parent can fetch a fresh signed URL (they expire). */
  onRequestFreshUrl?: () => Promise<string | null> | string | null;
};

const BASE_WIDTH = 760;

export function isPdfMimeType(mimeType: string) {
  return mimeType.toLowerCase().includes("pdf");
}

export function DocumentViewer(props: DocumentViewerProps) {
  const { url, mimeType, fileName, page, zoom, rotation, onPageCount, onRequestFreshUrl } = props;
  const isPdf = isPdfMimeType(mimeType);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeUrl = freshUrl ?? url;

  // Status is derived from keys, so effects never set state synchronously.
  const loadKey = `${activeUrl}#${attempt}`;
  const renderKey = `${loadKey}|${page}|${zoom}|${rotation}`;
  const [loaded, setLoaded] = useState<{ key: string; pdf: PdfDocumentProxy } | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const pdf = loaded && loaded.key === loadKey ? loaded.pdf : null;
  const pageCount = pdf?.numPages ?? null;
  const state: "loading" | "ready" | "error" =
    errorKey === loadKey || errorKey === renderKey
      ? "error"
      : readyKey === (isPdf ? renderKey : loadKey)
        ? "ready"
        : "loading";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onPageCountRef = useRef(onPageCount);

  useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  // Load the PDF document (range/stream disabled: signed URLs expire and must not be re-requested).
  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let document: PdfDocumentProxy | null = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const task = pdfjs.getDocument({ url: activeUrl, disableRange: true, disableStream: true });
        document = (await task.promise) as unknown as PdfDocumentProxy;
        if (cancelled) {
          void document.destroy();
          return;
        }
        setLoaded({ key: loadKey, pdf: document });
        onPageCountRef.current?.(document.numPages);
      } catch {
        if (!cancelled) setErrorKey(loadKey);
      }
    })();

    return () => {
      cancelled = true;
      if (document) void document.destroy();
    };
  }, [activeUrl, isPdf, loadKey]);

  // Render the requested page whenever page / zoom / rotation change.
  useEffect(() => {
    if (!isPdf || !pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    const canvas = canvasRef.current;

    (async () => {
      try {
        const pageNumber = Math.min(Math.max(page, 1), pdf.numPages);
        const pdfPage = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = pdfPage.getViewport({ scale: 1, rotation });
        const cssScale = (BASE_WIDTH / unscaled.width) * (zoom / 100);
        const viewport = pdfPage.getViewport({ scale: cssScale, rotation });
        const pixelRatio = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("CANVAS_UNAVAILABLE");

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (!cancelled) setReadyKey(renderKey);
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (!cancelled && name !== "RenderingCancelledException") setErrorKey(renderKey);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [isPdf, pdf, page, zoom, rotation, renderKey]);

  async function retry() {
    if (onRequestFreshUrl) {
      try {
        const fresh = await onRequestFreshUrl();
        if (fresh) setFreshUrl(fresh);
      } catch {
        // Keep the current URL; the retry below still runs.
      }
    }
    setAttempt((value) => value + 1);
  }

  const statusText =
    state === "loading"
      ? `Loading ${fileName}${isPdf ? `, page ${page}` : ""}.`
      : state === "error"
        ? `Could not display ${fileName}.`
        : isPdf
          ? `Showing page ${page} of ${pageCount ?? "?"} of ${fileName}.`
          : `Showing ${fileName}.`;

  return (
    <div className="relative w-full" data-testid="document-viewer">
      <p className="sr-only" aria-live="polite">
        {statusText}
      </p>

      {state === "error" ? (
        <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center text-xs text-slate-600">
          <AlertCircle className="size-6 text-rose-500" aria-hidden="true" />
          <p className="font-medium text-slate-800">The document could not be displayed.</p>
          <p>The secure link may have expired or the file could not be read.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void retry()}>
            <RefreshCw className="mr-1 size-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      {isPdf ? (
        <div className={`flex justify-center overflow-auto p-4 ${state === "error" ? "hidden" : ""}`}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${fileName}, page ${page}${pageCount ? ` of ${pageCount}` : ""}`}
            className="max-w-none rounded border border-slate-200 bg-white shadow"
            data-testid="pdf-canvas"
          />
        </div>
      ) : state !== "error" ? (
        <div className="flex justify-center overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${activeUrl}-${attempt}`}
            src={activeUrl}
            alt={fileName}
            onLoad={() => setReadyKey(loadKey)}
            onError={() => setErrorKey(loadKey)}
            className="h-auto rounded border border-slate-200 bg-white object-contain shadow transition-transform duration-200 ease-out"
            style={{
              width: zoom === 100 ? "100%" : `${zoom}%`,
              maxWidth: zoom <= 100 ? "100%" : "none",
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
            }}
            data-testid="image-viewer"
          />
        </div>
      ) : null}

      {state === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Loader2 className="size-6 animate-spin text-slate-400" />
        </div>
      ) : null}
    </div>
  );
}
