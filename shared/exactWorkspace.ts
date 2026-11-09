import { statementCompanies, type StatementCompanyId } from "./statements";
/** Only an unambiguous legal-name match can select a company automatically. */
export function exactWorkspaceCompany(name: string): StatementCompanyId | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/\bb\.?\s*v\.?\b/g, "").replace(/[^a-z0-9]/g, "");
  if (normalize(name) === "artecengineeringinnovations") return "artec";
  const matches = statementCompanies.filter(company => normalize(company.name) === normalize(name));
  return matches.length === 1 ? matches[0].id : undefined;
}
