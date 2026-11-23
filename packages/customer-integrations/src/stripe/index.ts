import { defineIntegration } from "../kit/define"
import { DEFAULT_STRIPE_CONFIG, StripeConnectionConfig } from "./config"
import { presentation } from "./presentation"

export const stripe = defineIntegration({
	id: "stripe",
	config: { schema: StripeConnectionConfig, default: DEFAULT_STRIPE_CONFIG },
	ingest: {
		linkHosts: ["stripe.com"],
		policy: (config) => ({ matchByDomain: config.matchByDomain, createAccounts: true }),
	},
	precedence: { name: 20, logoUrl: 20, email: 20 },
	capabilities: {
		billing: { preference: 20, invoices: true, usageFromInvoices: true },
		attentionDefault: true,
	},
	presentation,
	server: () => import("./server"),
})
