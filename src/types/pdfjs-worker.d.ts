// pdfjs-dist ships no type declarations for its worker entry; only its presence matters here.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
