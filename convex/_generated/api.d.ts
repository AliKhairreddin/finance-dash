/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as amexStatementProcessing from "../amexStatementProcessing.js";
import type * as amexStatementSchema from "../amexStatementSchema.js";
import type * as amexStatements from "../amexStatements.js";
import type * as analytics from "../analytics.js";
import type * as bankLease from "../bankLease.js";
import type * as bankSync from "../bankSync.js";
import type * as banking from "../banking.js";
import type * as companyDocumentProcessing from "../companyDocumentProcessing.js";
import type * as companyDocumentSchema from "../companyDocumentSchema.js";
import type * as companyDocuments from "../companyDocuments.js";
import type * as dashboard from "../dashboard.js";
import type * as documentProcessing from "../documentProcessing.js";
import type * as documentPurchases from "../documentPurchases.js";
import type * as documentRecheck from "../documentRecheck.js";
import type * as documentSchema from "../documentSchema.js";
import type * as documents from "../documents.js";
import type * as integrationSync from "../integrationSync.js";
import type * as managementReport from "../managementReport.js";
import type * as managementReportUpload from "../managementReportUpload.js";
import type * as manualBankSchema from "../manualBankSchema.js";
import type * as manualBankTransactions from "../manualBankTransactions.js";
import type * as mediaFunding from "../mediaFunding.js";
import type * as mediaSpend from "../mediaSpend.js";
import type * as meritReplacementSchema from "../meritReplacementSchema.js";
import type * as meritReplacements from "../meritReplacements.js";
import type * as redtrack from "../redtrack.js";
import type * as redtrackCache from "../redtrackCache.js";
import type * as redtrackSchema from "../redtrackSchema.js";
import type * as topUpProcessing from "../topUpProcessing.js";
import type * as topUpSchema from "../topUpSchema.js";
import type * as topUps from "../topUps.js";
import type * as wagnerSpendCache from "../wagnerSpendCache.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  amexStatementProcessing: typeof amexStatementProcessing;
  amexStatementSchema: typeof amexStatementSchema;
  amexStatements: typeof amexStatements;
  analytics: typeof analytics;
  bankLease: typeof bankLease;
  bankSync: typeof bankSync;
  banking: typeof banking;
  companyDocumentProcessing: typeof companyDocumentProcessing;
  companyDocumentSchema: typeof companyDocumentSchema;
  companyDocuments: typeof companyDocuments;
  dashboard: typeof dashboard;
  documentProcessing: typeof documentProcessing;
  documentPurchases: typeof documentPurchases;
  documentRecheck: typeof documentRecheck;
  documentSchema: typeof documentSchema;
  documents: typeof documents;
  integrationSync: typeof integrationSync;
  managementReport: typeof managementReport;
  managementReportUpload: typeof managementReportUpload;
  manualBankSchema: typeof manualBankSchema;
  manualBankTransactions: typeof manualBankTransactions;
  mediaFunding: typeof mediaFunding;
  mediaSpend: typeof mediaSpend;
  meritReplacementSchema: typeof meritReplacementSchema;
  meritReplacements: typeof meritReplacements;
  redtrack: typeof redtrack;
  redtrackCache: typeof redtrackCache;
  redtrackSchema: typeof redtrackSchema;
  topUpProcessing: typeof topUpProcessing;
  topUpSchema: typeof topUpSchema;
  topUps: typeof topUps;
  wagnerSpendCache: typeof wagnerSpendCache;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
