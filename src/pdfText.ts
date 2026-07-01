type PdfTextItem = {
  str: string;
  transform: number[];
};

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  pdfjsPromise ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")]).then(
    ([pdfjsLib, worker]) => {
      if (typeof worker.default === "string") {
        pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjsLib;
    }
  );
  return pdfjsPromise;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    item !== null &&
    typeof item === "object" &&
    "str" in item &&
    "transform" in item &&
    typeof (item as { str?: unknown }).str === "string" &&
    Array.isArray((item as { transform?: unknown }).transform)
  );
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({ data }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows = new Map<number, Array<{ x: number; text: string }>>();

    for (const item of textContent.items) {
      if (!isPdfTextItem(item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] ?? 0);
      const x = item.transform[4] ?? 0;
      const existingKey = [...rows.keys()].find((key) => Math.abs(key - y) <= 2) ?? y;
      const row = rows.get(existingKey) ?? [];
      row.push({ x, text: item.str });
      rows.set(existingKey, row);
    }

    for (const [, row] of [...rows.entries()].sort((left, right) => right[0] - left[0])) {
      lines.push(
        row
          .sort((left, right) => left.x - right.x)
          .map((part) => part.text)
          .join(" ")
      );
    }
  }

  return lines.join("\n");
}
