// Polyfill browser APIs missing in Vercel's Node.js runtime for pdf-parse
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).DOMMatrix) {
    (globalThis as any).DOMMatrix = class DOMMatrix { a=1; b=0; c=0; d=1; e=0; f=0; };
  }
  if (!(globalThis as any).Path2D) {
    (globalThis as any).Path2D = class Path2D {};
  }
}
export {};
