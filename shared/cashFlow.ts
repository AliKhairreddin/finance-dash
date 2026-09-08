export const maximumCashFlowSnapshots = 12;
export const maximumCashFlowLinesPerSection = 60;
export const maximumCashFlowLinesPerSnapshot = 120;
export const maximumCashFlowLineIdLength = 200;
export const maximumCashFlowLineNameLength = 200;
export const maximumCashFlowLineNotesLength = 256;
export const maximumCashFlowSnapshotNotesLength = 1_000;

export type CashFlowSectionKey = "cashAccounts" | "receivables" | "openBalances" | "payables" | "investments";
export const cashFlowSectionKeys: CashFlowSectionKey[] = ["cashAccounts", "receivables", "openBalances", "payables", "investments"];

/** Arithmetic only: never execute user-entered JavaScript or spreadsheet code. */
export function evaluateCashFlowAmount(input: string): number {
  const expression = input.trim().replace(/^=/, "");
  if (!expression || expression.length > 256) throw new Error("Enter an amount or a formula of up to 256 characters");
  const tokens = expression.match(/\d+(?:\.\d*)?|\.\d+|[()+*/-]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) throw new Error("Use numbers, +, −, *, /, and parentheses");
  let position = 0;
  function primary(): number {
    const token = tokens[position++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const result = sum();
      if (tokens[position++] !== ")") throw new Error("Close the formula's parentheses");
      return result;
    }
    if (!token || !/^(?:\d|\.)/.test(token)) throw new Error("Complete the formula");
    return Number(token);
  }
  function product(): number {
    let result = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const value = primary();
      if (operator === "/" && value === 0) throw new Error("Cannot divide by zero");
      result = operator === "*" ? result * value : result / value;
    }
    return result;
  }
  function sum(): number {
    let result = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const value = product();
      result = operator === "+" ? result + value : result - value;
    }
    return result;
  }
  const result = sum();
  if (position !== tokens.length) throw new Error("Check the formula's operators and parentheses");
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER / 100) throw new Error("Amount is too large");
  return Number(result.toFixed(2));
}
