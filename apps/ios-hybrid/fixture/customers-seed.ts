/**
 * The Customers lab data (`web-foldkit/src/test/fixtures/customers.ts`, one org whose id is the
 * offline org's) as the org's customers source rows and RPC answers, for the Customers pages'
 * parity fixtures (`./pages/customers-*.ts`).
 */
import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import {
	ACCOUNTS,
	CONNECTIONS,
	overviewFixture,
	SETTINGS,
	SIGNALS,
} from "../../web-foldkit/src/test/fixtures/customers"
import { SUPPORT_REPORT } from "../../web-foldkit/src/test/fixtures/issues"
import {
	CONTACT_SUGGESTION,
	STRONG_SUGGESTION,
	WORKSPACE_SUGGESTION,
} from "../../web-foldkit/src/test/fixtures/customers-suggestions"
import type { FixtureServer } from "./fixture-socket"
import type { Responder } from "./offline-backend"
import { channelIds, orgId } from "./snapshot"

/** A row as the wire carries it: dates as ISO text (the collections parse them back). */
const wire = <A>(rows: ReadonlyArray<A>): ReadonlyArray<unknown> => JSON.parse(JSON.stringify(rows))

/** Accounts, signals, settings and connected sources in the org's customers source. */
export const seedCustomers = (server: FixtureServer) => {
	server.write("customers", orgId, "customer_accounts", wire(ACCOUNTS))
	server.write("customers", orgId, "customer_signals", wire(SIGNALS))
	server.write("customers", orgId, "customer_settings", wire([SETTINGS]))
	server.write("customers", orgId, "customer_connections", wire(CONNECTIONS))
}

const isRange = Schema.is(Customers.CustomersRange)
const rangeOf = (payload: Record<string, unknown>) => (isRange(payload.range) ? payload.range : "30d")

/** The suggested links, on the offline org's own channels (#design, #product-updates, #releases). */
const suggestions = [STRONG_SUGGESTION, CONTACT_SUGGESTION, WORKSPACE_SUGGESTION].map(
	(suggestion, index) => ({
		...suggestion,
		channelId: channelIds[4 + index] ?? suggestion.channelId,
	}),
)

export const customersRpcs = {
	"customers.overview": (payload) => JSON.parse(JSON.stringify(overviewFixture(rangeOf(payload)))),
	"customers.support.report": () => JSON.parse(JSON.stringify(SUPPORT_REPORT)),
	"customers.channel.suggestions": () => ({ items: JSON.parse(JSON.stringify(suggestions)) }),
} satisfies Readonly<Record<string, Responder>>
