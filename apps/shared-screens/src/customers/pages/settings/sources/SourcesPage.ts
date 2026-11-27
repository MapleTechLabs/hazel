// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/customers/settings/sources` (today's `web-foldkit/.../settings/sources/overview-view.ts`):
 * identity coverage, the connected sources with their sync state, and the rest to connect. Connect
 * opens the `CustomerSourceConnect` modal; a source's detail is its own page.
 */
import { Command, Component, Query, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { defaultConfigOf, IntegrationConfig } from "@hazel/customer-integrations"
import { CustomerProvider } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Schema } from "effect"
import { Navigate, OpenModal } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import { CommonReason, copyOf, errorToast, reasonOf, successToast, toast } from "../../../../modals/feedback"
import { modalServices } from "../../../../modals/services"
import { formatCount, formatDate, formatRelative } from "../../../data/format"
import { PROVIDER_ORDER, providerOf } from "../../../data/providers"
import { sourceMark } from "../../../ui/identity"
import {
	addsList,
	chips,
	comingSoonBadge,
	connectButton,
	errorBanner,
	eyebrow,
	sourceDetailHref,
	statusBadge,
} from "../../../settings/sources/parts"
import {
	accountCountStream,
	ConnectionRow,
	connectionsStream,
	SyncRunRow,
	syncRunsStream,
} from "../../../settings/sources/rows"
import {
	connectionOf,
	formatClock,
	isLive,
	runningRunOf,
	statParts,
	statusOf,
	TRIGGER_LABEL,
} from "../../../settings/sources/status"

export const SourcesProps = Schema.Struct({
	session: Session,
	nowMs: Schema.Finite,
	/** Dev builds offer demo data to an empty org. */
	canSeedDemo: Schema.Boolean,
})
export type SourcesProps = typeof SourcesProps.Type

export const SourcesModel = Schema.Struct({
	/** Live rows; null until each query answers. */
	connections: Schema.NullOr(Schema.Array(ConnectionRow)),
	syncRuns: Schema.NullOr(Schema.Array(SyncRunRow)),
	accountCount: Schema.NullOr(Schema.Int),
	/** "Sync now" sent and not yet answered. */
	syncing: Schema.Array(CustomerConnectionId),
	isSeedingDemo: Schema.Boolean,
})
export type SourcesModel = typeof SourcesModel.Type

export const SourcesMessage = UiSchema.TaggedEnum({
	UpdatedConnections: { connections: Schema.Array(ConnectionRow) },
	UpdatedSyncRuns: { runs: Schema.Array(SyncRunRow) },
	UpdatedAccountCount: { count: Schema.Int },
	PressedSyncNow: { connectionId: CustomerConnectionId },
	PressedSyncAll: {},
	SettledSyncNow: { connectionId: CustomerConnectionId },
	PressedLoadDemo: {},
	SettledSeedDemo: {},
	PressedConnect: { provider: CustomerProvider },
	PressedReconnect: { provider: CustomerProvider, connectionId: CustomerConnectionId },
	PressedOpen: { href: Schema.String },
})
export type SourcesMessage = typeof SourcesMessage.Type

// COMMANDS AND QUERIES

const isIntegrationConfig = Schema.is(IntegrationConfig)

const isAdmin = (session: Session): boolean =>
	session.member?.role === "admin" || session.member?.role === "owner"

/** Open unmatched records (`customers.unmatched.list`'s `openCount`); admins only, the RPC refuses members. */
export class GetUnmatchedCount extends Query.Service<GetUnmatchedCount>()("hazel/customers/UnmatchedCount", {
	args: { organizationId: OrganizationId },
	success: Schema.Int,
	error: CommonReason,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId }) =>
				rpc("customers.unmatched.list", {
					organizationId: organizationId,
					status: "open",
					limit: 1,
				}).pipe(
					Effect.map((result) => result.openCount),
					// BOUNDARY: the count is a hint; every failure reads as its common reason.
					Effect.mapError(reasonOf),
				)
		}),
	)
}

const syncFailureCopy = (reason: "NotFound" | "ComingSoon" | CommonReason, name: string) =>
	copyOf(reason, {
		NotFound: { title: `${name} is not connected`, description: "Connect it again to sync." },
		ComingSoon: {
			title: `The ${name} integration is coming soon`,
			description: "Hazel can't sync from it yet.",
		},
	})

/** A `manual` run now; answers once it is scheduled. The card shows the run; only a failure toasts. */
export class SyncCustomerSource extends Command.Service<SyncCustomerSource>()("hazel/customers/SyncSource", {
	args: { organizationId: OrganizationId, connectionId: CustomerConnectionId, name: Schema.String },
	success: SourcesMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ run }) => ({ organizationId, connectionId, name }) => {
			const settled = SourcesMessage.SettledSyncNow({ connectionId })
			const failed = (reason: "NotFound" | "ComingSoon" | CommonReason) =>
				toast(errorToast(syncFailureCopy(reason, name))).pipe(Effect.as(settled))
			return run(
				Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
					rpc("customers.connection.syncNow", {
						organizationId: organizationId,
						connectionId,
					}),
				).pipe(
					Effect.as(settled),
					Effect.catchTags({
						CustomersNotFoundError: () => failed("NotFound"),
						CustomerProviderUnavailableError: () => failed("ComingSoon"),
					}),
					// BOUNDARY: the rest reads as its common reason.
					Effect.catchCause((cause) => failed(reasonOf(cause))),
				),
			)
		}),
	)
}

/** Dev and preview only: fake customers through the ingest path, with demo connections. */
export class SeedCustomersDemo extends Command.Service<SeedCustomersDemo>()("hazel/customers/SeedDemo", {
	args: { organizationId: OrganizationId },
	success: SourcesMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ run }) => ({ organizationId }) => {
			const settled = SourcesMessage.SettledSeedDemo()
			const failed = (reason: "Refused" | CommonReason) =>
				toast(
					errorToast(
						copyOf(reason, {
							Refused: {
								title: "Demo data is off here",
								description: "It is only available in dev and preview.",
							},
						}),
					),
				).pipe(Effect.as(settled))
			return run(
				Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
					rpc("customers.demo.seed", { organizationId: organizationId }),
				).pipe(
					Effect.andThen(
						toast({
							...successToast("Demo data loaded"),
							description: "Fake customers from demo connections.",
						}),
					),
					Effect.as(settled),
					Effect.catchTag("CustomersInvalidRequestError", () => failed("Refused")),
					// BOUNDARY: the rest reads as its common reason.
					Effect.catchCause((cause) => failed(reasonOf(cause))),
				),
			)
		}),
	)
}

// VIEW

const SourcesDef = Hazel.component({
	name: "CustomersSourcesPage",
	props: SourcesProps,
	model: SourcesModel,
	message: SourcesMessage,
	queries: {
		unmatched: {
			query: GetUnmatchedCount,
			args: ({ props }) =>
				props.session.organization !== null && isAdmin(props.session)
					? { organizationId: props.session.organization.id }
					: undefined,
		},
	},
	restore: (model) => ({ ...model, syncing: [], isSeedingDemo: false }),
})

type H = Parameters<Parameters<typeof SourcesDef.make>[0]["view"]>[0]

interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly isAdmin: boolean
}

const open = (href: string) => SourcesMessage.PressedOpen({ href })

/** A label over a value and a detail line (a card's columns). */
const column = (h: H, label: string, value: string, detail: string, danger = false) =>
	h.stack.density("none").children(
		eyebrow(h, label),
		h.text
			.role("label")
			.strong()
			.truncate()
			.tone(danger ? "danger" : "default")
			.children(value),
		h.text.role("caption").tone("muted").truncate().children(detail),
	)

// COVERAGE

const unmatchedPanel = (h: H, context: Context) =>
	Match.value(h.queries.unmatched).pipe(
		Match.tag("Initial", () =>
			h.text.role("label").tone("muted").children("Counting unmatched records..."),
		),
		Match.tag("Failure", () =>
			h.text.role("label").tone("muted").children("Couldn't count unmatched records."),
		),
		Match.tag("Success", ({ value: count }) =>
			count === 0
				? h.stack
						.density("snug")
						.children(
							h.text.role("label").strong().children("No unmatched records"),
							h.text
								.role("label")
								.tone("muted")
								.children("Every synced record found its account."),
						)
				: h.stack
						.density("snug")
						.align("start")
						.children(
							h.text
								.role("label")
								.strong()
								.dot()
								.tone("warning")
								.children(
									`${formatCount(count)} unmatched ${count === 1 ? "record" : "records"}`,
								),
							h.text
								.role("label")
								.tone("muted")
								.children(
									"Synced records no account claimed yet. Link them, create accounts or ignore them.",
								),
							h.button
								.label("Resolve records")
								.trailingIcon("chevron-right")
								.size("small")
								.on("press", open(`/${context.orgSlug}/customers/settings/unmatched`)),
						),
		),
		Match.exhaustive,
	)

const coverageCard = (h: H, model: SourcesModel, context: Context, live: ReadonlyArray<ConnectionRow>) =>
	// HAZEL-GAP(p4-grid-tracks): today's three columns are 0.8, 1.4 and 1 fractions with hairlines between.
	h.frame.children(
		h.grid
			.columns("3")
			.density("loose")
			.children(
				h.stack.density("none").children(
					eyebrow(h, "Identity coverage"),
					h.stack
						.axis("horizontal")
						.density("snug")
						.align("end")
						.children(
							h.text
								.role("display")
								.strong()
								.numeric()
								.children(
									model.accountCount === null ? "-" : formatCount(model.accountCount),
								),
							h.text.role("label").tone("muted").children("accounts"),
						),
					h.text
						.role("label")
						.tone("muted")
						.children("One customer model, whichever sources each account came from."),
				),
				h.stack.density("snug").children(
					eyebrow(h, "Records per source"),
					live.length === 0
						? h.text.role("label").tone("muted").children("Nothing synced yet.")
						: h.stack.density("snug").children(
								...live.map((connection) =>
									h.stack
										.axis("horizontal")
										.density("compact")
										.align("center")
										.children(
											sourceMark(h, connection.provider, { size: "xs" }),
											h.text
												.role("label")
												.strong()
												.children(providerOf(connection.provider).name),
											h.text
												.role("label")
												.tone("muted")
												.numeric()
												.truncate()
												.children(
													statParts(connection.stats).slice(0, 2).join(" · ") ||
														"No records yet",
												),
										),
								),
							),
					h.text
						.role("caption")
						.tone("muted")
						.children("Match order: existing link → shared ID → email domain → new account"),
				),
				context.isAdmin ? unmatchedPanel(h, context) : null,
			),
	)

// CONNECTED

const progressLine = (h: H, run: SyncRunRow, context: Context) => {
	const progress = run.progress
	const fraction =
		progress === null || progress.total === null || progress.total === 0
			? null
			: Math.min(1, progress.done / progress.total)
	const counts =
		progress === null
			? "Starting..."
			: progress.total === null
				? `${progress.step} ${formatCount(progress.done)}`
				: `${progress.step} ${formatCount(progress.done)} of ${formatCount(progress.total)}`
	const label = `Syncing ${progress?.step ?? ""}`
	return h.stack.density("compact").children(
		h.stack
			.axis("horizontal")
			.density("compact")
			.align("center")
			.children(
				h.text
					.role("label")
					.strong()
					.truncate()
					.children(`${TRIGGER_LABEL[run.trigger]} · ${counts}`),
				h.text
					.role("label")
					.tone("muted")
					.truncate()
					.children(
						`· started ${formatRelative(new Date(run.startedAtMs), new Date(context.nowMs))}`,
					),
				h.spacer,
				fraction === null
					? null
					: h.text
							.role("label")
							.tone("muted")
							.numeric()
							.children(`${Math.round(fraction * 100)}%`),
			),
		// `meter`: today's bar names itself for assistive tech only.
		fraction === null
			? h.progress.style("meter").indeterminate().label(label)
			: h.progress.style("meter").value(fraction).label(label),
	)
}

const lastSyncColumn = (h: H, model: SourcesModel, connection: ConnectionRow, context: Context) => {
	const now = new Date(context.nowMs)
	const running = runningRunOf(model.syncRuns, connection.id)
	if (running !== undefined)
		return column(
			h,
			"Last sync",
			"Running now",
			`${TRIGGER_LABEL[running.trigger]} · started ${formatRelative(new Date(running.startedAtMs), now)}`,
		)
	if (connection.status === "error")
		return column(
			h,
			"Last success",
			connection.lastSuccessAtMs === null
				? "Never"
				: formatRelative(new Date(connection.lastSuccessAtMs), now),
			`${formatCount(connection.consecutiveFailures)} failed ${connection.consecutiveFailures === 1 ? "attempt" : "attempts"} since`,
			true,
		)
	return column(
		h,
		"Last sync",
		connection.lastSyncAtMs === null
			? "Not synced yet"
			: formatRelative(new Date(connection.lastSyncAtMs), now),
		connection.nextSyncAtMs === null
			? "No sync scheduled"
			: `Next at ${formatClock(connection.nextSyncAtMs)}`,
	)
}

/** The sync mode, and whether the webhook can be verified (its signing secret is stored). */
const syncModeColumn = (h: H, connection: ConnectionRow) => {
	const descriptor = providerOf(connection.provider)
	return h.stack.density("none").children(
		eyebrow(h, "Sync mode"),
		h.text.role("label").strong().children(descriptor.syncMode),
		descriptor.webhook === null
			? h.text.role("caption").tone("muted").children("No webhooks")
			: h.text
					.role("caption")
					.tone(connection.hasWebhookSecret ? "success" : "warning")
					.dot()
					// HAZEL-GAP(p4-dot-muted-label): today's dot takes the tone, the words stay muted.
					.children(connection.hasWebhookSecret ? "Signing secret set" : "Signing secret missing"),
	)
}

const sourceTitle = (h: H, provider: CustomerProvider, ...badges: ReadonlyArray<unknown>) =>
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.wrap()
		.children(
			// HAZEL-GAP(p4-heading-link): today the name is a link to the source's detail.
			h.heading.level("3").children(providerOf(provider).name),
			...(badges as Array<never>),
		)

const connectedCard = (h: H, model: SourcesModel, connection: ConnectionRow, context: Context) => {
	const descriptor = providerOf(connection.provider)
	const status = statusOf(model.syncRuns, connection)
	const running = runningRunOf(model.syncRuns, connection.id)
	const records = statParts(connection.stats)
	const detail = open(sourceDetailHref(context.orgSlug, connection.provider))
	return (
		h.frame
			.key(`connected:${connection.provider}`)
			.surface("tile")
			// HAZEL-GAP(p4-card-band): today's four columns run edge to edge with hairlines between them.
			.footer(
				h.grid
					.columns("4")
					.children(
						h.stack
							.density("none")
							.children(eyebrow(h, "Provides"), chips(h, descriptor.provides)),
						column(
							h,
							"Records synced",
							records[0] ?? "Nothing yet",
							records.slice(1, 3).join(" · "),
						),
						lastSyncColumn(h, model, connection, context),
						syncModeColumn(h, connection),
					),
			)
			.children(
				h.stack.density("cozy").children(
					// HAZEL-GAP(p4-row-wrap-basis): today a narrow card wraps the buttons under the blurb.
					h.stack
						.axis("horizontal")
						.density("cozy")
						.align("start")
						.children(
							sourceMark(h, connection.provider, { size: "md" }),
							h.stack
								.density("none")
								.children(
									sourceTitle(h, connection.provider, statusBadge(h, status)),
									h.text.role("label").tone("muted").children(descriptor.blurb),
								),
							h.stack
								.axis("horizontal")
								.density("compact")
								.children(
									context.isAdmin && status !== "syncing"
										? h.button
												.label("Sync now")
												.icon("refresh")
												.variant("outline")
												.size("small")
												.loading(model.syncing.includes(connection.id))
												.on(
													"press",
													SourcesMessage.PressedSyncNow({
														connectionId: connection.id,
													}),
												)
										: null,
									// HAZEL-GAP(p4-button-href): today a link styled as a button.
									h.button
										.label(context.isAdmin ? "Settings" : "Details")
										.icon("gear")
										.variant("outline")
										.size("small")
										.on("press", detail),
								),
						),
					running === undefined ? null : progressLine(h, running, context),
					status === "failing"
						? errorBanner(h, connection, {
								nowMs: context.nowMs,
								onViewRun: detail,
								onReconnect: context.isAdmin
									? SourcesMessage.PressedReconnect({
											provider: connection.provider,
											connectionId: connection.id,
										})
									: null,
							})
						: null,
				),
			)
	)
}

// NOT CONNECTED

const notConnectedCard = (
	h: H,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
	context: Context,
) => {
	const descriptor = providerOf(provider)
	const badge =
		connection === undefined
			? descriptor.isAvailable
				? null
				: comingSoonBadge(h)
			: statusBadge(h, "disconnected")
	return h.frame
		.key(`rest:${provider}`)
		.surface("tile")
		.children(
			// HAZEL-GAP(p4-grid-tracks): today's tracks are 1fr 1fr auto, centred, a hairline before the second.
			h.grid.columns("3").children(
				h.stack
					.axis("horizontal")
					.density("cozy")
					.align("start")
					.children(
						sourceMark(h, provider, { size: "md" }),
						h.stack.density("none").children(
							sourceTitle(h, provider, badge),
							h.text.role("label").tone("muted").children(descriptor.blurb),
							connection?.disconnectedAtMs == null
								? null
								: h.text
										.role("caption")
										.tone("muted")
										.children(
											`Disconnected ${formatDate(new Date(connection.disconnectedAtMs), { now: new Date(context.nowMs) })}. Its data is kept, marked stale.`,
										),
						),
					),
				h.stack.density("snug").children(eyebrow(h, "Adds to the model"), addsList(h, provider)),
				context.isAdmin
					? h.stack
							.align("start")
							.children(
								connectButton(
									h,
									provider,
									connection,
									SourcesMessage.PressedConnect({ provider }),
								),
							)
					: null,
			),
		)
}

// PAGE

const group = (h: H, title: string, count: number, children: ReadonlyArray<unknown>) =>
	h.stack
		.key(title)
		.density("cozy")
		.children(
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					h.heading.children(title),
					h.text.role("label").tone("muted").numeric().children(formatCount(count)),
				),
			...(children as Array<never>),
		)

const sourcesPage = (h: H, model: SourcesModel) => {
	const { session, nowMs } = h.props
	const context: Context = { orgSlug: session.orgSlug ?? "", nowMs, isAdmin: isAdmin(session) }
	const live = PROVIDER_ORDER.flatMap((provider) => {
		const connection = connectionOf(model.connections, provider)
		return connection !== undefined && isLive(connection) ? [connection] : []
	})
	const rest = PROVIDER_ORDER.filter(
		(provider) => !live.some((connection) => connection.provider === provider),
	)
	const isEmpty = model.connections !== null && model.connections.length === 0
	// HAZEL-GAP(p4-screen-page-column): today a `max-w-6xl py-6` column; `page` inset is `p-4`.
	return h.scroll.key("customers-sources").children(
		h.stack
			.inset("page")
			.density("relaxed")
			.children(
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("start")
					.children(
						h.stack
							.density("none")
							.children(
								h.heading.level("1").children("Data sources"),
								h.text
									.role("label")
									.tone("muted")
									.children(
										"Integrations that write accounts, contacts, billing and usage into one customer model.",
									),
							),
						h.spacer,
						h.props.canSeedDemo && context.isAdmin && isEmpty
							? h.button
									.label("Load demo data")
									.variant("outline")
									.size("small")
									.loading(model.isSeedingDemo)
									.on("press", SourcesMessage.PressedLoadDemo())
							: null,
						context.isAdmin && live.length > 0
							? h.button
									.label("Sync all")
									.icon("refresh")
									.variant("outline")
									.size("small")
									.on("press", SourcesMessage.PressedSyncAll())
							: null,
					),
				context.isAdmin
					? null
					: h.banner.description(
							"Only admins and owners can change data sources. You can look around.",
						),
				model.connections === null
					? h.text.role("label").tone("muted").children("Loading data sources...")
					: coverageCard(h, model, context, live),
				model.connections === null || live.length === 0
					? null
					: group(
							h,
							"Connected",
							live.length,
							live.map((connection) => connectedCard(h, model, connection, context)),
						),
				model.connections === null || rest.length === 0
					? null
					: group(
							h,
							"Not connected",
							rest.length,
							rest.map((provider) =>
								notConnectedCard(
									h,
									provider,
									connectionOf(model.connections, provider),
									context,
								),
							),
						),
			),
	)
}

/** Starts a sync for each id not already waiting. */
const syncNow = (ids: ReadonlyArray<CustomerConnectionId>) =>
	SourcesDef.update(($) => {
		const organization = $.props.session.organization
		const fresh = ids.filter((id) => !$.model.syncing.includes(id))
		if (organization === null || fresh.length === 0) return $.model
		return $.evolve({ syncing: (syncing) => [...syncing, ...fresh] }).run(
			...fresh.map((connectionId) =>
				SyncCustomerSource.make({
					organizationId: organization.id,
					connectionId,
					name: providerOf(
						$.model.connections?.find((row) => row.id === connectionId)?.provider ?? "",
					).name,
				}),
			),
		)
	})

export const SourcesPageNoDeps = SourcesDef.make({
	init: () => ({
		connections: null,
		syncRuns: null,
		accountCount: null,
		syncing: [],
		isSeedingDemo: false,
	}),
	update: {
		UpdatedConnections: ($, { connections }) => $.evolve({ connections: () => connections }),
		UpdatedSyncRuns: ($, { runs }) => $.evolve({ syncRuns: () => runs }),
		UpdatedAccountCount: ($, { count }) => $.evolve({ accountCount: () => count }),
		PressedSyncNow: ($, { connectionId }) => $.combine(syncNow([connectionId])),
		PressedSyncAll: ($) =>
			$.combine(syncNow(($.model.connections ?? []).filter(isLive).map((connection) => connection.id))),
		SettledSyncNow: ($, { connectionId }) =>
			$.evolve({ syncing: (syncing) => syncing.filter((id) => id !== connectionId) }),
		PressedLoadDemo: ($) => {
			const organization = $.props.session.organization
			return organization === null || $.model.isSeedingDemo
				? $.model
				: $.evolve({ isSeedingDemo: () => true }).run(
						SeedCustomersDemo.make({ organizationId: organization.id }),
					)
		},
		SettledSeedDemo: ($) => $.evolve({ isSeedingDemo: () => false }),
		PressedConnect: ($, { provider }) => {
			// A disconnected source starts from its last config, a new one from the provider's defaults.
			const config = connectionOf($.model.connections, provider)?.config ?? defaultConfigOf(provider)
			return isIntegrationConfig(config)
				? $.run(
						OpenModal.make({
							modal: { _tag: "CustomerSourceConnect", provider, reconnectId: null, config },
						}),
					)
				: $.model
		},
		PressedReconnect: ($, { provider, connectionId }) => {
			const connection = $.model.connections?.find((row) => row.id === connectionId)
			return connection === undefined
				? $.model
				: $.run(
						OpenModal.make({
							modal: {
								_tag: "CustomerSourceConnect",
								provider,
								reconnectId: connectionId,
								config: connection.config,
							},
						}),
					)
		},
		PressedOpen: ($, { href }) => $.run(Navigate.make({ href, replace: false })),
	},
	subscriptions: ({ props }) => {
		const organization = props.session.organization
		if (organization === null) return []
		return [
			Subscription.make("connections", [organization.id], ([id]) =>
				connectionsStream(id, (connections) => SourcesMessage.UpdatedConnections({ connections })),
			),
			Subscription.make("syncRuns", [organization.id], ([id]) =>
				syncRunsStream(id, (runs) => SourcesMessage.UpdatedSyncRuns({ runs })),
			),
			Subscription.make("accounts", [organization.id], ([id]) =>
				accountCountStream(id, (count) => SourcesMessage.UpdatedAccountCount({ count })),
			),
		]
	},
	view: (h, model) => sourcesPage(h, model),
})

/** The page with its Commands and query, on the host's `HazelRpc`, data and requests. */
export const SourcesPage = SourcesPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(GetUnmatchedCount.layer, SyncCustomerSource.layer, SeedCustomersDemo.layer),
	),
)
