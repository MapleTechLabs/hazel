import type { InvoicesDemo } from "../kit/demo"

const INVOICE_ACCOUNTS = { seed: "acct_demo", lab: "acct_hazel" } as const

export const demo: InvoicesDemo = {
	role: "invoices",
	customerId: (sequence) => `cus_${sequence}`,
	invoiceId: (sequence) => `in_${sequence}`,
	customerUrl: (externalId) => `https://dashboard.stripe.com/customers/${externalId}`,
	invoiceUrl: (externalId, scope) =>
		`https://invoice.stripe.com/i/${INVOICE_ACCOUNTS[scope]}/${externalId}`,
}
