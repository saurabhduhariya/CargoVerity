"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/feedback-state";

type PdfPageProxy = {
  rotate?: number;
  getViewport: (options: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; transform?: number[] }) => { promise: Promise<void>; cancel: () => void };
};
type PdfDocumentProxy = { numPages: number; getPage: (pageNumber: number) => Promise<PdfPageProxy> };
type PdfLoadingTask = { promise: Promise<unknown>; destroy: () => Promise<void> };

export type DocumentViewerProps = {
  url: string;
  mimeType: string;
  fileName: string;
  page: number;
  /** 100 means fit the available pane width, including after resize or rotation. */
  zoom: number;
  rotation: number;
  onPageCount?: (count: number) => void;
  onRequestFreshUrl?: () => Promise<string | null> | string | null;
};

export function isPdfMimeType(mimeType: string) {
  return mimeType.toLowerCase().includes("pdf");
}

export function fitDocumentScale(availableWidth: number, pageWidth: number, zoom: number): number {
  return Math.max(1, availableWidth - 2) / Math.max(1, pageWidth) * zoom / 100;
}

export function DocumentViewer({ url, mimeType, fileName, page, zoom, rotation, onPageCount, onRequestFreshUrl }: DocumentViewerProps) {
  const isPdf = isPdfMimeType(mimeType);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPageCountRef = useRef(onPageCount);
  const [width, setWidth] = useState(0);
  const [fresh, setFresh] = useState<{ source: string; url: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const activeUrl = fresh?.source === url ? fresh.url : url;
  const loadKey = `${activeUrl}#${attempt}`;
  const renderKey = `${loadKey}|${page}|${zoom}|${rotation}|${width}`;
  const [loaded, setLoaded] = useState<{ key: string; pdf: PdfDocumentProxy } | null>(null);
  const [imageSize, setImageSize] = useState<{ key: string; width: number; height: number } | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const pdf = loaded?.key === loadKey ? loaded.pdf : null;
  const state = !activeUrl || errorKey === loadKey || errorKey === renderKey ? "error" : readyKey === (isPdf ? renderKey : loadKey) ? "ready" : "loading";

  useEffect(() => { onPageCountRef.current = onPageCount; }, [onPageCount]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function measure() {
      if (!viewport) return;
      const style = getComputedStyle(viewport);
      const next = Math.floor(viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      if (next > 0) setWidth((current) => current === next ? current : next);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPdf || !activeUrl) return;
    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;
    let destroyed = false;
    function destroyTask() {
      if (!loadingTask || destroyed) return;
      destroyed = true;
      void loadingTask.destroy().catch(() => { /* Cancellation must not crash document switching. */ });
    }
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ url: activeUrl, disableRange: true, disableStream: true });
        const documentProxy = await loadingTask.promise as PdfDocumentProxy;
        if (cancelled) { destroyTask(); return; }
        setLoaded({ key: loadKey, pdf: documentProxy });
        onPageCountRef.current?.(documentProxy.numPages);
      } catch {
        if (!cancelled) setErrorKey(loadKey);
      }
    })();
    return () => { cancelled = true; destroyTask(); };
  }, [activeUrl, isPdf, loadKey]);

  useEffect(() => {
    if (!isPdf || !pdf || !canvasRef.current || width <= 0) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(Math.min(Math.max(page, 1), pdf.numPages));
        if (cancelled) return;
        const pageRotation = ((pdfPage.rotate ?? 0) + rotation) % 360;
        const unscaled = pdfPage.getViewport({ scale: 1, rotation: pageRotation });
        const viewport = pdfPage.getViewport({ scale: fitDocumentScale(width, unscaled.width, zoom), rotation: pageRotation });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("CANVAS_UNAVAILABLE");
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined });
        await renderTask.promise;
        if (!cancelled) setReadyKey(renderKey);
      } catch (error) {
        if (!cancelled && (error as { name?: string } | null)?.name !== "RenderingCancelledException") setErrorKey(renderKey);
      }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [isPdf, pdf, page, zoom, rotation, renderKey, width]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      const next = await onRequestFreshUrl?.();
      if (next) setFresh({ source: url, url: next });
    } catch {
      // Retain the error state and retry the existing URL, if one is available.
    } finally {
      setAttempt((value) => value + 1);
      setRetrying(false);
    }
  }

  const statusText = state === "loading" ? `Loading ${fileName}${isPdf ? `, page ${page}` : ""}.` : state === "error" ? `Could not display ${fileName}.` : isPdf ? `Showing page ${page} of ${pdf?.numPages ?? "?"} of ${fileName}.` : `Showing ${fileName}.`;
  const size = imageSize?.key === loadKey ? imageSize : null;
  const sideways = rotation % 180 !== 0;
  const imageScale = size ? fitDocumentScale(width, sideways ? size.height : size.width, zoom) : 1;
  const imageWidth = size ? size.width * imageScale : width;
  const imageHeight = size ? size.height * imageScale : width;

  return (
    <div ref={viewportRef} className="relative h-full min-h-0 w-full overflow-auto overscroll-contain bg-viewer-background p-4" data-testid="document-viewer" data-state={state} data-page={page} tabIndex={0} aria-label="Scrollable document page">
      <p className="sr-only" aria-live="polite">{statusText}</p>
      {state === "error" ? (
        <FeedbackState kind="error" title="Private document unavailable" description="The secure link may have expired, storage may be unavailable, or the file could not be read. No substitute document is shown." className="mx-auto max-w-md p-4" action={<Button type="button" variant="outline" loading={retrying} onClick={() => void retry()}>Retry secure document</Button>} />
      ) : (
        <div className="grid min-h-full w-max min-w-full content-start justify-items-center">
          {isPdf ? <canvas ref={canvasRef} role="img" aria-label={`${fileName}, page ${page}${pdf ? ` of ${pdf.numPages}` : ""}`} className={`max-w-none border border-border-strong bg-surface${state === "loading" ? " invisible" : ""}`} data-testid="pdf-canvas" /> : (
            <div className="relative" style={{ width: sideways ? imageHeight : imageWidth, height: sideways ? imageWidth : imageHeight }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={loadKey} src={activeUrl} alt={fileName} onLoad={(event) => { setImageSize({ key: loadKey, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setReadyKey(loadKey); onPageCountRef.current?.(1); }} onError={() => setErrorKey(loadKey)} className="absolute left-1/2 top-1/2 max-w-none border border-border-strong bg-surface object-contain" style={{ width: imageWidth, height: size ? imageHeight : "auto", maxWidth: "none", transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} data-testid="image-viewer" />
            </div>
          )}
        </div>
      )}
      {state === "loading" ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-foreground-secondary" aria-hidden="true"><LoaderCircle className="size-5 motion-safe:animate-spin" /> Loading document…</div> : null}
    </div>
  );
}
