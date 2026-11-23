import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";

type StatementRequest = "Exact" | "invoice" | "mailbox";

class BackendFailure extends Error {
  readonly reference: string | undefined;

  constructor(error: unknown) {
    super("The Statements service could not finish the request.");
    this.reference = error instanceof Error ? /\[Request ID: ([a-f0-9]+)\]/i.exec(error.message)?.[1] : undefined;
  }
}

function throwBackendFailure(error: unknown): never {
  if (error instanceof ConvexError && typeof error.data === "string") throw error;
  throw new BackendFailure(error);
}

export class StatementRequestClient extends ConvexHttpClient {
  override query: ConvexHttpClient["query"] = (...args) => super.query(...args).catch(throwBackendFailure);
  override mutation: ConvexHttpClient["mutation"] = (...args) => super.mutation(...args).catch(throwBackendFailure);
  override action: ConvexHttpClient["action"] = (...args) => super.action(...args).catch(throwBackendFailure);
}

export function statementRequestError(
  error: unknown,
  request: StatementRequest,
  localMessage = error instanceof Error ? error.message.split("\n")[0] : "Request failed",
): { message: string; status: number } {
  if (error instanceof BackendFailure) {
    const support = error.reference ? ` If it happens again, share this reference: ${error.reference}` : "";
    return { message: `The ${request} request could not finish. Try again.${support}`, status: 500 };
  }
  const limit = request === "invoice" ? 500 : 300;
  const reason = error instanceof ConvexError && typeof error.data === "string" ? error.data : localMessage;
  return { message: reason.slice(0, limit), status: 400 };
}
