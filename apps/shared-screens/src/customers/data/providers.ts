/**
 * What the Customers pages read about their data sources, generically: each integration's own text
 * and fields are its `presentation` in `@hazel/customer-integrations`, and the lists below follow the
 * registry's order and capabilities.
 */
import {
	activityProviders,
	billingProviders,
	featureFlagsIntegration,
	impersonationIntegration,
	type IntegrationId,
	integrationOf,
	type IntegrationPresentation,
	integrations,
	requiredSourcesOf,
	startingIntegration,
	suggestedBillingIntegration,
} from "@hazel/customer-integrations"
import type { CustomerProvider, CustomerSource, SignalTemplate } from "@hazel/domain/customers"
import type { CustomerConnectionId, OrganizationId } from "@hazel/schema"

export const PROVIDER_ORDER: ReadonlyArray<IntegrationId> = integrations.map((integration) => integration.id)

/** A stored id this build does not know (a newer deploy wrote it): its id, and nothing to offer. */
const unknownPresentation = (provider: CustomerProvider): IntegrationPresentation => ({
	name: provider,
	accountNoun: "record",
	domain: "",
	linkHosts: [],
	blurb: "",
	setupSummary: "",
	provides: [],
	adds: [],
	accessNote: "",
	isAvailable: false,
	apiKey: { label: "", placeholder: "", createHref: "", help: "" },
	permissions: [],
	webhook: null,
	syncMode: "",
	configFields: [],
	mapping: [],
	docsHref: "",
	dashboardHref: "",
})

export const providerOf = (provider: CustomerProvider): IntegrationPresentation =>
	integrationOf(provider)?.presentation ?? unknownPresentation(provider)

export const sourceLabel = (source: CustomerSource): string =>
	source === "hazel" ? "Hazel" : providerOf(source).name

/** "A", "A and B", "A, B and C". */
export const namesLabel = (names: ReadonlyArray<string>): string =>
	names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** Where first-run copy starts, and the billing source it suggests next. */
export const startingSource = startingIntegration.presentation
export const suggestedBillingSource = suggestedBillingIntegration.presentation

/** The source holding feature flags, and the one impersonation goes through. */
export const featureFlagsSource = (featureFlagsIntegration ?? startingIntegration).presentation
export const impersonationSource = (impersonationIntegration ?? startingIntegration).presentation

/** The activity sources, the one that best measures usage first. */
export const usageSources: ReadonlyArray<CustomerProvider> = [...activityProviders].sort(
	(a, b) =>
		(providerOf(a).activityLabel?.usageRank ?? Number.MAX_SAFE_INTEGER) -
		(providerOf(b).activityLabel?.usageRank ?? Number.MAX_SAFE_INTEGER),
)

/** The title of a revenue surface with no billing source. */
export const connectBillingTitle = (): string => `Connect ${sourcesLabel(billingProviders)} to see revenue`

/**
 * `url` (provider data: a record's or an invoice's page) if it is https on one of `source`'s
 * `linkHosts`; anything else gets no link.
 */
export const safeSourceUrl = (source: CustomerSource, url: string | null): string | null => {
	if (url === null || source === "hazel") return null
	try {
		const { protocol, hostname } = new URL(url)
		const isOwnHost = providerOf(source).linkHosts.some((host) =>
			host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host,
		)
		return protocol === "https:" && isOwnHost ? url : null
	} catch {
		return null
	}
}

/**
 * The endpoint a provider posts webhooks to (`routes/customers-webhooks.http.ts`): the org and
 * connection ids are in the path, the signature is the auth. Known once the connection exists.
 */
export const webhookUrlOf = (
	backendUrl: string,
	provider: CustomerProvider,
	organizationId: OrganizationId,
	connectionId: CustomerConnectionId,
): string => `${backendUrl}/webhooks/customers/${provider}/${organizationId}/${connectionId}`

/** "A or B"; empty: built in (needs no source). */
export const sourcesLabel = (sources: ReadonlyArray<CustomerSource>): string =>
	sources.map(sourceLabel).join(" or ")

/** A template can match with any one of its sources connected; none listed = always available. */
export const isTemplateAvailable = (
	template: SignalTemplate,
	connected: ReadonlyArray<CustomerProvider>,
): boolean => {
	const required = requiredSourcesOf(template)
	return required.length === 0 || required.some((provider) => connected.includes(provider))
}
