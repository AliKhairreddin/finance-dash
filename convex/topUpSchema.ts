import { v } from "convex/values";
export const topUpInputFields = {
  submissionId: v.string(), entity: v.union(v.literal("dn"), v.literal("lmd")), priority: v.union(v.literal("Normal"), v.literal("Urgent")),
  companyName: v.string(), providerId: v.optional(v.string()), commission: v.string(), team: v.string(), member: v.string(),
  amount: v.number(), currency: v.string(), openBalance: v.number(), lastThreeDaysSpend: v.number(), expectedThreeDaysSpend: v.number(),
  paymentMethod: v.string(), wiseLink: v.string(), notes: v.string(), bmNames: v.array(v.string()), accountNames: v.array(v.string())
};
export const paymentDetails = v.object({ payerEntity: v.union(v.literal("dn"), v.literal("lmd"), v.literal("")), beneficiary: v.string(), iban: v.string(), bic: v.string(), reference: v.string(), amount: v.union(v.number(), v.null()), currency: v.string(), notes: v.string() });
export const topUpFields = { ...topUpInputFields,
  number: v.number(), documentId: v.id("financialDocuments"), fileName: v.string(), contentType: v.string(),
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("paid")), version: v.number(), originalAmount: v.number(),
  createdAt: v.string(), updatedAt: v.string(), approvedBy: v.optional(v.string()), paidBy: v.optional(v.string()),
  events: v.array(v.object({ at: v.string(), actor: v.string(), action: v.string(), amount: v.number() })),
  notificationError: v.optional(v.string()), draftStatus: v.string(), draftError: v.optional(v.string()), draftId: v.optional(v.string()),
  draftAttempt: v.optional(v.string()), paymentDetails: v.optional(paymentDetails), telegramMessageId: v.optional(v.number()), telegramVersion: v.optional(v.number()),
  adjustPromptId: v.optional(v.number()), adjustUserId: v.optional(v.string()), adjustExpiresAt: v.optional(v.number())
};
export const topUpRecord = v.object({ _id: v.id("topUpRequests"), _creationTime: v.number(), ...topUpFields });
