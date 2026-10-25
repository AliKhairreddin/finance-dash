import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

// These are executable runtime assets, never document content. Host them ourselves
// so an OCR job has no dependency on third-party CDNs or language-data services.
const target = "dist/statement-ocr-assets";
await mkdir(target, { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  await cp(`node_modules/pdfjs-dist/build/${file}`, join(target, file));
}
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(`node_modules/pdfjs-dist/${directory}`, join(target, directory), { recursive: true });
}
await cp("node_modules/pdfjs-dist/LICENSE", join(target, "PDFJS-LICENSE"));
for (const file of ["tesseract.min.js", "worker.min.js", "tesseract.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt"]) {
  await cp(`node_modules/tesseract.js/dist/${file}`, join(target, file));
}
await mkdir(join(target, "core"), { recursive: true });
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
  const file = `tesseract-core-${variant}.wasm.js`;
  await cp(`node_modules/tesseract.js-core/${file}`, join(target, "core", file));
}
await cp("node_modules/tesseract.js-core/LICENSE", join(target, "core/LICENSE"));
for (const language of ["eng", "nld"]) {
  await cp(`node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`, join(target, `${language}.traineddata.gz`));
}
console.log("Built self-hosted statement PDF/OCR assets");
