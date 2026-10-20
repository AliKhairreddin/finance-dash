# Merit invoice edits

Saving an existing, unpaid sales invoice replaces its Merit record using the documented v2 delete/create APIs. The dashboard invoice ID and invoice number stay fixed. Finalization updates only the Merit ID and editable fields, preserving transaction, document, and revenue-run links. Dashboard amounts include tax; the editor retrieves the net line amount from Merit.

Before deletion, `meritInvoiceReplacements` records an immutable original-details JSON file and rendered PDF in Convex storage. The JSON also contains the previous dashboard invoice and the requested replacement payload. The invoice row's original-backup information control downloads the latest original PDF or details. Previous revisions remain in the journal, indexed by invoice ID. Backups use the same authenticated finance access as the invoice.

Only a single, undiscounted service line without payments, stock movements, dimensions, quote/recurring links, or e-invoice delivery metadata is supported. Other invoices fail before deletion and must be edited in Merit. Paid status, paid amount, payment records, source identity, and totals must be complete. The original is read again immediately before deletion to detect changes during backup. Saving never emails the replacement.

Each external write has a persisted intent. Mutations fence concurrent attempts; source sync cannot overlap a replacement. Generic dashboard writes and payment matching preserve pending invoices. New details and a fresh PDF must be verified and stored before finalization.

## Recovery

A failed operation remains visible as **Merit replacement pending**. Wait at least 30 seconds (or the upstream retry interval), then choose **Check replacement**. It resumes the stored edit, not unsaved editor input.

- Failure before deletion leaves the original untouched and unlocks the invoice.
- Explicit HTTP rejection of deletion unlocks the invoice. Correct the reported problem before saving again.
- Confirmed deletion followed by an explicitly rejected create may be retried through Check replacement, using the same invoice number and saved payload.
- A timeout or server failure during creation is ambiguous. Recovery searches Merit by invoice number and validates the exact replacement. It never blindly repeats the create request. If no unique matching invoice is found, review Merit using the retained original and request payload; the operation stays pending until the result can be reconciled. Do not clear the journal or create a differently numbered invoice.
- A new Merit ID recorded before a verification, PDF, or dashboard-save failure can be completed by Check replacement without another create.

Local development uses the same validation and execution code with private files under `.local/invoice-replacements/`; production backups and operation state are in Convex. Do not use local development to repair a production operation.

API references: [details](https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/get-invoice-details/), [delete](https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/delete-invoice/), [create](https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/create-sales-invoice/), [lookup](https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/get-list-of-invoices/).
