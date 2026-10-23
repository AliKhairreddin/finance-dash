import { v } from "convex/values";
export const topUpInputFields = {
  submissionId: v.string(), entity: v.optional(v.union(v.literal("dn"), v.literal("lmd"))), priority: v.union(v.literal("Normal"), v.literal("Urgent")),
  companyName: v.string(), providerId: v.optional(v.string()), commission: v.optional(v.string()), team: v.string(), member: v.string(),
  amount: v.number(), currency: v.string(), openBalance: v.optional(v.number()), lastThreeDaysSpend: v.optional(v.number()), expectedThreeDaysSpend: v.optional(v.number()),
  walletAddress: v.optional(v.string()), network: v.optional(v.string()),
  paymentMethod: v.string(), wiseLink: v.string(), notes: v.string(), bmNames: v.array(v.string()), accountNames: v.array(v.string())
};
export const paymentDetails = v.object({ payerEntity: v.union(v.literal("dn"), v.literal("lmd"), v.literal("")), beneficiary: v.string(), iban: v.string(), bic: v.string(), bankCountry: v.optional(v.string()), accountNumber: v.optional(v.string()), routingNumber: v.optional(v.string()), reference: v.string(), amount: v.union(v.number(), v.null()), currency: v.string(), notes: v.string() });
export const topUpFields = { ...topUpInputFields,
  number: v.number(), documentId: v.optional(v.id("financialDocuments")), fileName: v.optional(v.string()), contentType: v.optional(v.string()),
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("paid")), version: v.number(), originalAmount: v.number(),
  createdAt: v.string(), updatedAt: v.string(), deletedAt: v.optional(v.string()), deletedBy: v.optional(v.string()), approvedBy: v.optional(v.string()), paidBy: v.optional(v.string()),
  events: v.array(v.object({ at: v.string(), actor: v.string(), action: v.string(), amount: v.number() })),
  notificationError: v.optional(v.string()), draftStatus: v.string(), draftError: v.optional(v.string()), draftWarning: v.optional(v.string()), draftId: v.optional(v.string()),
  draftAttempt: v.optional(v.string()), paymentDetails: v.optional(paymentDetails), telegramMessageId: v.optional(v.number()), telegramVersion: v.optional(v.number()), telegramDeliveryToken: v.optional(v.string()),
  adjustPromptId: v.optional(v.number()), adjustUserId: v.optional(v.string()), adjustExpiresAt: v.optional(v.number()), adjustError: v.optional(v.string())
};
export const topUpRecord = v.object({ _id: v.id("topUpRequests"), _creationTime: v.number(), ...topUpFields });
