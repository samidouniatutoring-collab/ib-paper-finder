// pdf.js worker with the Safari stream fix loaded first (imports run in order).
import "./lib/stream-polyfill";
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
