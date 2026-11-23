import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { syntheticManagementReportSheets } from "../../shared/testFixtures/managementReport";
import { managementWorkbookBytes } from "../../shared/testFixtures/managementWorkbook";

const [baseDir, proposedDir] = process.argv.slice(2);
assert.ok(baseDir && proposedDir, "Pass the base and proposed source directories.");
const fixture = syntheticManagementReportSheets();
const bytes = managementWorkbookBytes();
const importedAt = "2026-07-21T12:00:00.000Z";
const metadata = { importId: "fixture", importedAt, asOf: "2026-05-31" };

async function readOutput(directory: string) {
  const parserPath = resolve(directory, "shared/managementReport.ts");
  const parser: typeof import("../../shared/managementReport") = await import(pathToFileURL(parserPath).href);
  assert.match(parser.managementReportParserVersion, /^[1-9]\d*$/, "Use a positive integer management report parser version.");
  const csv = parser.buildManagementReport(structuredClone(fixture), metadata);
  const workbookPath = resolve(directory, "shared/managementReportWorkbook.ts");
  let workbook: Awaited<ReturnType<typeof import("../../shared/managementReportWorkbook").readManagementWorkbook>> | undefined;
  if (existsSync(workbookPath)) {
    const reader: typeof import("../../shared/managementReportWorkbook") = await import(pathToFileURL(workbookPath).href);
    workbook = await reader.readManagementWorkbook(bytes.slice(), "report.xlsx");
  }
  return { version: BigInt(parser.managementReportParserVersion), csv, workbook };
}

mock.timers.enable({ apis: ["Date"], now: new Date(importedAt) });
try {
  const base = await readOutput(baseDir);
  const proposed = await readOutput(proposedDir);
  assert.ok(proposed.version >= base.version, "Management report parser versions cannot go backwards.");

  const changed = Object.keys({ ...base.csv, ...proposed.csv }).filter(key => {
    const section = key as keyof typeof base.csv;
    return !isDeepStrictEqual(base.csv[section], proposed.csv[section]);
  });
  if (!isDeepStrictEqual(base.workbook, proposed.workbook)) changed.push("workbook upload");

  if (!changed.length) {
    console.log("The fixture produced the same normalized management report.");
  } else {
    assert.ok(proposed.version > base.version,
      `Normalized management report changed (${changed.join(", ")}) at version ${base.version}. Increment managementReportParserVersion so saved imports can be rebuilt.`);
    if (base.workbook && proposed.workbook) {
      assert.notEqual(proposed.workbook.importId, base.workbook.importId, "A new parser version must give the changed workbook a new import ID.");
    }
    console.log(`Normalized management report changed at parser version ${base.version} to ${proposed.version}: ${changed.join(", ")}.`);
  }
} finally {
  mock.timers.reset();
}
