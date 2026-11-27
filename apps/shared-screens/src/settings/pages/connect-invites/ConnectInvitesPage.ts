// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/connect-invites` (the deleted `web-foldkit/src/page/settings/connect-invites`):
 * invitations from other organizations to share a channel, pending first. Accepting mounts the
 * shared channel, then asks whether it looks like a customer (`customers.channel.suggestions`).
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { getConnectInviteStatusBadge } from "@hazel/client-data/connect-shared-channels"
import * as Customers from "@hazel/domain/customers"
import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { type BadgeTone, Hazel } from "@hazel/ui/vocabulary/index"
import { inArray } from "@tanstack/db"
import { Cause, DateTime, Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { withData } from "../../../app/live"
import { ShowToast } from "../../../app/requests"
import { Session } from "../../../app/session"
import { fetchSuggestions, reasonSummary } from "../../../customers/data/suggestions"
import {
	CommonReason,
	commonCopy,
	copyOf,
	errorToast,
	reasonOf,
	successToast,
} from "../../../modals/feedback"
import { cardHeader, settingsCard, settingsColumn } from "../settings-card"

export const Invite = Schema.Struct({
	id: ConnectInviteId,
	hostOrganizationId: OrganizationId,
	status: Schema.String,
	createdAtMs: Schema.Finite,
})
export type Invite = typeof Invite.Type

export const HostOrganization = Schema.Struct({ id: OrganizationId, name: Schema.String })

/** The list: loading, its rows, or why it failed; `stale` keeps rows a failed refetch left. */
export const Invites = UiSchema.TaggedEnum({
	Loading: {},
	Loaded: { invites: Schema.Array(Invite), refreshFailed: Schema.NullOr(CommonReason) },
	Failed: { reason: CommonReason },
})
export type Invites = typeof Invites.Type

export const DeclineFailure = Schema.Union([
	Schema.Literals(["NotFound", "InvalidState", "WorkspaceNotFound"]),
	CommonReason,
])
export type DeclineFailure = typeof DeclineFailure.Type
export const AcceptFailure = Schema.Union([
	Schema.Literals(["AlreadyShared", "ChannelNotFound"]),
	DeclineFailure,
])
export type AcceptFailure = typeof AcceptFailure.Type

/** After an accept: the joined channel's best customer match, and what the prompt is doing. */
export const Suggestion = Schema.Struct({
	channelId: Schema.NullOr(ChannelId),
	item: Schema.NullOr(Customers.ChannelSuggestion),
	status: Schema.Literals(["Idle", "Loading", "Ready", "Linking", "Dismissing"]),
})
export type Suggestion = typeof Suggestion.Type

const NO_SUGGESTION: Suggestion = { channelId: null, item: null, status: "Idle" }

export const ConnectInvitesMessage = UiSchema.TaggedEnum({
	SucceededListInvites: { version: Schema.Finite, invites: Schema.Array(Invite) },
	FailedListInvites: { version: Schema.Finite, reason: CommonReason },
	PressedRetryList: {},
	UpdatedHostOrganizations: { organizations: Schema.Array(HostOrganization) },
	PressedAccept: { inviteId: ConnectInviteId },
	SucceededAccept: { inviteId: ConnectInviteId, channelId: Schema.NullOr(ChannelId) },
	FailedAccept: { inviteId: ConnectInviteId, reason: AcceptFailure },
	PressedDecline: { inviteId: ConnectInviteId },
	SucceededDecline: { inviteId: ConnectInviteId },
	FailedDecline: { inviteId: ConnectInviteId, reason: DeclineFailure },
	FetchedSuggestion: { channelId: ChannelId, item: Schema.NullOr(Customers.ChannelSuggestion) },
	PressedLinkSuggestion: {},
	PressedDismissSuggestion: {},
	SettledSuggestion: { channelId: ChannelId, linked: Schema.NullOr(Schema.String), failed: Schema.Boolean },
})
export type ConnectInvitesMessage = typeof ConnectInvitesMessage.Type

export const ConnectInvitesProps = Schema.Struct({ session: Session })
export type ConnectInvitesProps = typeof ConnectInvitesProps.Type

export const ConnectInvitesModel = Schema.Struct({
	/** Bumped per list request; an older response is dropped. */
	version: Schema.Finite,
	invites: Invites,
	hostOrganizations: Schema.Array(HostOrganization),
	acceptingIds: Schema.Array(ConnectInviteId),
	decliningIds: Schema.Array(ConnectInviteId),
	suggestion: Suggestion,
})
export type ConnectInvitesModel = typeof ConnectInvitesModel.Type

// COMMANDS

const errorOf = (cause: Cause.Cause<unknown>) =>
	Option.getOrUndefined(Cause.findErrorOption(cause)) as { readonly _tag?: string } | undefined

const millisOf = (date: Date | DateTime.Utc) =>
	date instanceof Date ? date.getTime() : DateTime.toEpochMillis(date)

/** One answer of `connectShare.invite.listIncoming`, as the list message for `version`. */
const listStream = (organizationId: OrganizationId, version: number) =>
	Stream.fromEffect(
		Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
			rpc("connectShare.invite.listIncoming", { organizationId }).pipe(
				Effect.map((response) =>
					ConnectInvitesMessage.SucceededListInvites({
						version,
						invites: response.data.map((invite) => ({
							id: invite.id,
							hostOrganizationId: invite.hostOrganizationId,
							status: invite.status,
							createdAtMs: millisOf(invite.createdAt),
						})),
					}),
				),
				// BOUNDARY: the list fails only with the shared reasons.
				Effect.catchCause((cause) =>
					Effect.succeed(
						ConnectInvitesMessage.FailedListInvites({
							version,
							reason: reasonOf(errorOf(cause)),
						}),
					),
				),
			),
		),
	)

const ACCEPT_TAGS = {
	ConnectInviteNotFoundError: "NotFound",
	ConnectInviteInvalidStateError: "InvalidState",
	ConnectWorkspaceNotFoundError: "WorkspaceNotFound",
	ConnectChannelAlreadySharedError: "AlreadyShared",
	ChannelNotFoundError: "ChannelNotFound",
	// The invite's shared conversation is gone: the invite is as good as revoked.
	ConnectConversationNotFoundError: "NotFound",
} satisfies Record<string, AcceptFailure>

/** The failure an accept or decline error names, if it is one of the invite's own. */
const ownFailure = (tag: string | undefined): AcceptFailure | undefined =>
	tag !== undefined && Object.hasOwn(ACCEPT_TAGS, tag)
		? ACCEPT_TAGS[tag as keyof typeof ACCEPT_TAGS]
		: undefined

/**
 * Accepts, then finds the org's channel for the joined conversation: its mount lands in the org
 * source with the accept's write, so wait for that first (null when it does not show in time).
 */
export class AcceptInvite extends Command.Service<AcceptInvite>()("hazel/settings/connect-invites/Accept", {
	args: { inviteId: ConnectInviteId, guestOrganizationId: OrganizationId },
	success: ConnectInvitesMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const data = yield* ClientData
			const mounts = data.collections.connectConversationChannelCollection
			const joinedChannel = (
				conversationId: ConnectConversationId,
				organizationId: OrganizationId,
				txId: string,
			) =>
				mounts.utils.awaitSeqEffect(txId, 10_000).pipe(
					Effect.ignore,
					Effect.map(
						() =>
							mounts.toArray.find(
								(row) =>
									row.conversationId === conversationId &&
									row.organizationId === organizationId &&
									row.isActive &&
									row.deletedAt === null,
							)?.channelId ?? null,
					),
				)
			return ({ inviteId, guestOrganizationId }) =>
				rpc("connectShare.invite.accept", { inviteId, guestOrganizationId }).pipe(
					Effect.flatMap((response) =>
						joinedChannel(response.data.id, guestOrganizationId, response.transactionId),
					),
					Effect.map((channelId) => ConnectInvitesMessage.SucceededAccept({ inviteId, channelId })),
					Effect.catchCause((cause) => {
						const error = errorOf(cause)
						const reason = ownFailure(error?._tag) ?? reasonOf(error)
						return Effect.succeed(ConnectInvitesMessage.FailedAccept({ inviteId, reason }))
					}),
				)
		}),
	)
}

export class DeclineInvite extends Command.Service<DeclineInvite>()(
	"hazel/settings/connect-invites/Decline",
	{
		args: { inviteId: ConnectInviteId },
		success: ConnectInvitesMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ inviteId }) =>
					rpc("connectShare.invite.decline", { inviteId }).pipe(
						Effect.as(ConnectInvitesMessage.SucceededDecline({ inviteId })),
						Effect.catchCause((cause) => {
							const error = errorOf(cause)
							const own = ownFailure(error?._tag)
							const reason: DeclineFailure =
								own === "NotFound" || own === "InvalidState" || own === "WorkspaceNotFound"
									? own
									: reasonOf(error)
							return Effect.succeed(ConnectInvitesMessage.FailedDecline({ inviteId, reason }))
						}),
					),
		),
	)
}

/** The joined channel's best open suggestion (the server scores it first); none on a failure. */
export class FetchChannelSuggestion extends Command.Service<FetchChannelSuggestion>()(
	"hazel/settings/connect-invites/FetchSuggestion",
	{ args: { organizationId: OrganizationId, channelId: ChannelId }, success: ConnectInvitesMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, channelId }) =>
					fetchSuggestions(organizationId, { channelId }).pipe(
						Effect.provideService(HazelRpc, rpc),
						Effect.map((items) =>
							ConnectInvitesMessage.FetchedSuggestion({ channelId, item: items[0] ?? null }),
						),
						Effect.catchCause(() =>
							Effect.succeed(
								ConnectInvitesMessage.FetchedSuggestion({ channelId, item: null }),
							),
						),
					),
		),
	)
}

/** Links (accept) or dismisses the suggestion; the channel's customer then arrives through the org source. */
export class SettleSuggestion extends Command.Service<SettleSuggestion>()(
	"hazel/settings/connect-invites/SettleSuggestion",
	{
		args: {
			organizationId: OrganizationId,
			suggestion: Customers.ChannelSuggestion,
			link: Schema.Boolean,
		},
		success: ConnectInvitesMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(Effect.service(HazelRpc), (rpc) => ({ organizationId, suggestion, link }) => {
			const payload = { organizationId, suggestionId: suggestion.id }
			const settled = (failed: boolean) =>
				ConnectInvitesMessage.SettledSuggestion({
					channelId: suggestion.channelId,
					linked: link && !failed ? suggestion.accountName : null,
					failed,
				})
			return (
				link
					? rpc("customers.channel.suggestion.accept", payload)
					: rpc("customers.channel.suggestion.dismiss", payload)
			).pipe(
				Effect.as(settled(false)),
				Effect.catchCause(() => Effect.succeed(settled(true))),
			)
		}),
	)
}

// DATA

const hostOrganizationsStream = (ids: ReadonlyArray<OrganizationId>) =>
	withData((data) =>
		data.liveQueryStream<{ readonly id: OrganizationId; readonly name: string }, ConnectInvitesMessage>(
			(q) =>
				q
					.from({ org: data.collections.organizationCollection })
					.where(({ org }) => inArray(org.id, [...ids]))
					.select(({ org }) => ({ id: org.id, name: org.name })),
			(rows) =>
				ConnectInvitesMessage.UpdatedHostOrganizations({
					organizations: rows.map((row) => ({ id: row.id, name: row.name })),
				}),
		),
	)

// HELPERS

export const invitesOf = (invites: Invites): ReadonlyArray<Invite> =>
	invites._tag === "Loaded" ? invites.invites : []

const without = (ids: ReadonlyArray<ConnectInviteId>, id: ConnectInviteId) =>
	ids.filter((other) => other !== id)

const isBusy = (model: ConnectInvitesModel, id: ConnectInviteId) =>
	model.acceptingIds.includes(id) || model.decliningIds.includes(id)

/** The retry is offered only for a failure a retry can fix. */
const isRetryable = (reason: CommonReason) =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable"

const BADGE_TONES = {
	warning: "warning",
	success: "success",
	secondary: "neutral",
} satisfies Record<ReturnType<typeof getConnectInviteStatusBadge>["intent"], BadgeTone>

const acceptCopy = (reason: AcceptFailure) =>
	copyOf(reason, {
		NotFound: { title: "Invite not found", description: "This invite may have been revoked or expired." },
		InvalidState: {
			title: "Cannot accept",
			description: "This invite is no longer in an acceptable state.",
		},
		WorkspaceNotFound: {
			title: "Workspace not found",
			description: "The target workspace could not be found.",
		},
		AlreadyShared: {
			title: "Already shared",
			description: "This channel is already shared with that organization.",
		},
		ChannelNotFound: {
			title: "Channel not found",
			description: "The shared channel may have been deleted.",
		},
	})

const declineCopy = (reason: DeclineFailure) =>
	copyOf(reason, {
		NotFound: {
			title: "Invite not found",
			description: "This invite may have already been revoked or expired.",
		},
		InvalidState: {
			title: "Cannot decline",
			description: "This invite is no longer in a declinable state.",
		},
		WorkspaceNotFound: {
			title: "Workspace not found",
			description: "This invite is not bound to a workspace.",
		},
	})

// VIEW

const ConnectDef = Hazel.component({
	name: "ConnectInvitesPage",
	props: ConnectInvitesProps,
	model: ConnectInvitesModel,
	message: ConnectInvitesMessage,
	// After Back, the list is asked for again and nothing is running.
	restore: (model) => ({ ...model, acceptingIds: [], decliningIds: [], suggestion: NO_SUGGESTION }),
})

type H = Parameters<Parameters<typeof ConnectDef.make>[0]["view"]>[0]

// HAZEL-GAP(p4-table-column-widths): today's columns are w-32, w-36 and w-52; the closest are regular, regular, wide.
const COLUMNS = [
	{ key: "from", label: "From", width: "fill" },
	{ key: "status", label: "Status", width: "regular" },
	{ key: "received", label: "Received", width: "regular", optional: true },
	{ key: "actions", label: "Actions", align: "end", width: "wide" },
] as const

const inviteRow = (h: H, model: ConnectInvitesModel, invite: Invite) => {
	const badge = getConnectInviteStatusBadge(invite.status)
	const isAccepting = model.acceptingIds.includes(invite.id)
	const isDeclining = model.decliningIds.includes(invite.id)
	const busy = isAccepting || isDeclining
	const host = model.hostOrganizations.find((org) => org.id === invite.hostOrganizationId)?.name
	return h.tableRow.key(invite.id).children(
		h.tableCell.column("from").children(
			h.text
				.strong()
				.truncate()
				.children(host ?? invite.hostOrganizationId),
		),
		h.tableCell
			.column("status")
			.children(h.badge.label(badge.label).tone(BADGE_TONES[badge.intent]).size("small")),
		h.tableCell
			.column("received")
			.children(h.text.tone("muted").children(new Date(invite.createdAtMs).toLocaleDateString())),
		h.tableCell.column("actions").children(
			invite.status !== "pending"
				? null
				: h.stack
						.axis("horizontal")
						.align("center")
						.density("compact")
						.children(
							h.spacer,
							h.button
								.key("decline")
								.label(isDeclining ? "Declining..." : "Decline")
								.variant("outline")
								.size("small")
								.disabled(busy)
								.on("press", ConnectInvitesMessage.PressedDecline({ inviteId: invite.id })),
							h.button
								.key("accept")
								.label(isAccepting ? "Accepting..." : "Accept")
								.size("small")
								.disabled(busy)
								.on("press", ConnectInvitesMessage.PressedAccept({ inviteId: invite.id })),
						),
		),
	)
}

const retryButton = (h: H, reason: CommonReason) =>
	isRetryable(reason)
		? h.button
				.label("Try again")
				.variant("secondary")
				.size("small")
				.on("press", ConnectInvitesMessage.PressedRetryList())
		: undefined

const loadedBody = (h: H, model: ConnectInvitesModel, invites: ReadonlyArray<Invite>) =>
	invites.length === 0
		? // HAZEL-GAP(p4-empty-state-height): today's empty state fills a 256px band (`h-64`).
			h.emptyState
				.key("empty")
				.icon("connect")
				.title("No connect invitations")
				.description("When another organization invites you to share a channel, it will appear here.")
		: h.table
				.key("invites")
				.label("Connect invitations")
				.columns(COLUMNS)
				.children(
					...[
						...invites.filter((invite) => invite.status === "pending"),
						...invites.filter((invite) => invite.status !== "pending"),
					].map((invite) => inviteRow(h, model, invite)),
				)

const body = (h: H, model: ConnectInvitesModel) =>
	Match.value(model.invites).pipe(
		Match.tag("Loading", () =>
			h.stack
				.key("loading")
				.inset("page")
				.align("center")
				.children(h.progress.style("spinner").label("Loading invitations...")),
		),
		Match.tag("Failed", ({ reason }) =>
			h.emptyState
				.key("failed")
				.icon("warning")
				.title("Couldn't load connect invitations")
				.description(commonCopy(reason).description ?? commonCopy(reason).title)
				.action(retryButton(h, reason)),
		),
		Match.tag("Loaded", ({ invites, refreshFailed }) =>
			h.stack
				.key("loaded")
				.density("none")
				.children(
					refreshFailed === null
						? null
						: h.stack
								.key("refresh-failed")
								.inset("page")
								.children(
									h.banner
										.tone("danger")
										.description(`Couldn't refresh: ${commonCopy(refreshFailed).title}`)
										.actions(retryButton(h, refreshFailed)),
								),
					loadedBody(h, model, invites),
				),
		),
		Match.exhaustive,
	)

/** "The shared channel looks like Acme", with its strongest reason, Link and Dismiss. */
/** Link or dismiss the shown suggestion; null unless one is shown and idle. */
const settleSuggestion = (model: ConnectInvitesModel, session: Session, link: boolean) => {
	const { suggestion } = model
	const organization = session.organization
	if (suggestion.status !== "Ready" || suggestion.item === null || organization === null) return null
	return SettleSuggestion.make({ organizationId: organization.id, suggestion: suggestion.item, link })
}

const suggestionPrompt = (h: H, suggestion: Suggestion) => {
	const item = suggestion.status === "Ready" || suggestion.status === "Linking" ? suggestion.item : null
	if (item === null) return null
	const isLinking = suggestion.status === "Linking"
	// HAZEL-GAP(p4-suggestion-prompt): today's prompt is a quiet row with the account in medium weight, a "Strong match" hint and a "+N" disclosure listing every reason.
	return h.banner
		.key("suggestion")
		.tone("info")
		.icon("office")
		.title(`The shared channel looks like ${item.accountName}`)
		.description(reasonSummary(item)?.top ?? undefined)
		.actions(
			h.button
				.key("link")
				.label(isLinking ? "Linking…" : "Link")
				.variant("outline")
				.size("xsmall")
				.disabled(isLinking)
				.on("press", ConnectInvitesMessage.PressedLinkSuggestion()),
			h.button
				.key("dismiss")
				.label("Dismiss")
				.variant("ghost")
				.size("xsmall")
				.disabled(isLinking)
				.on("press", ConnectInvitesMessage.PressedDismissSuggestion()),
		)
}

export const ConnectInvitesPageNoDeps = ConnectDef.make({
	init: () => ({
		version: 0,
		invites: Invites.Loading(),
		hostOrganizations: [],
		acceptingIds: [],
		decliningIds: [],
		suggestion: NO_SUGGESTION,
	}),
	update: {
		SucceededListInvites: ($, { version, invites }) =>
			version === $.model.version
				? $.evolve({ invites: () => Invites.Loaded({ invites, refreshFailed: null }) })
				: $.model,
		// A failed refetch keeps the rows it had; a failed first load shows the reason.
		FailedListInvites: ($, { version, reason }) =>
			version !== $.model.version
				? $.model
				: $.evolve({
						invites: (invites) =>
							invites._tag === "Loaded"
								? Invites.Loaded({ invites: invites.invites, refreshFailed: reason })
								: Invites.Failed({ reason }),
					}),
		PressedRetryList: ($) => $.evolve({ version: (version) => version + 1 }),
		UpdatedHostOrganizations: ($, { organizations }) =>
			$.evolve({ hostOrganizations: () => organizations }),
		PressedAccept: ($, { inviteId }) => {
			const organization = $.props.session.organization
			if (organization === null || isBusy($.model, inviteId)) return $.model
			return $.evolve({ acceptingIds: (ids) => [...ids, inviteId] }).run(
				AcceptInvite.make({ inviteId, guestOrganizationId: organization.id }),
			)
		},
		SucceededAccept: ($, { inviteId, channelId }) => {
			const organization = $.props.session.organization
			const next = $.evolve({
				acceptingIds: (ids) => without(ids, inviteId),
				version: (version) => version + 1,
			}).run(ShowToast.make({ toast: successToast("Channel connected") }))
			// A channel shared with this org may be a customer's: ask (members only).
			if (channelId === null || organization === null || $.props.session.member === null) return next
			return next
				.evolve({ suggestion: () => ({ channelId, item: null, status: "Loading" as const }) })
				.run(FetchChannelSuggestion.make({ organizationId: organization.id, channelId }))
		},
		FailedAccept: ($, { inviteId, reason }) =>
			$.evolve({ acceptingIds: (ids) => without(ids, inviteId) }).run(
				ShowToast.make({ toast: errorToast(acceptCopy(reason)) }),
			),
		PressedDecline: ($, { inviteId }) =>
			isBusy($.model, inviteId)
				? $.model
				: $.evolve({ decliningIds: (ids) => [...ids, inviteId] }).run(
						DeclineInvite.make({ inviteId }),
					),
		SucceededDecline: ($, { inviteId }) =>
			$.evolve({
				decliningIds: (ids) => without(ids, inviteId),
				version: (version) => version + 1,
			}).run(ShowToast.make({ toast: successToast("Invite declined") })),
		FailedDecline: ($, { inviteId, reason }) =>
			$.evolve({ decliningIds: (ids) => without(ids, inviteId) }).run(
				ShowToast.make({ toast: errorToast(declineCopy(reason)) }),
			),
		// An answer for a channel the prompt no longer asks about is dropped.
		FetchedSuggestion: ($, { channelId, item }) =>
			channelId !== $.model.suggestion.channelId
				? $.model
				: $.evolve({ suggestion: () => ({ channelId, item, status: "Ready" as const }) }),
		PressedLinkSuggestion: ($) => {
			const settle = settleSuggestion($.model, $.props.session, true)
			return settle === null
				? $.model
				: $.evolve({ suggestion: (state) => ({ ...state, status: "Linking" as const }) }).run(settle)
		},
		PressedDismissSuggestion: ($) => {
			const settle = settleSuggestion($.model, $.props.session, false)
			return settle === null
				? $.model
				: $.evolve({ suggestion: (state) => ({ ...state, status: "Dismissing" as const }) }).run(
						settle,
					)
		},
		SettledSuggestion: ($, { channelId, linked, failed }) => {
			const organization = $.props.session.organization
			const toast =
				linked !== null
					? ShowToast.make({ toast: successToast(`Linked to ${linked}`) })
					: failed
						? ShowToast.make({
								toast: errorToast({
									title: "Couldn't link the channel",
									description: "The suggestion or channel is no longer available.",
								}),
							})
						: null
			const shown = channelId === $.model.suggestion.channelId
			// Linked: the prompt is done; dismissed or failed: ask again for the next suggestion.
			const step =
				!shown || organization === null
					? $
					: linked !== null
						? $.evolve({
								suggestion: () => ({ channelId, item: null, status: "Ready" as const }),
							})
						: $.evolve({
								suggestion: () => ({ channelId, item: null, status: "Loading" as const }),
							}).run(
								FetchChannelSuggestion.make({ organizationId: organization.id, channelId }),
							)
			return toast === null ? step : step.run(toast)
		},
	},
	// The list is asked for once the organization is known, and again per `version`.
	subscriptions: ({ props, model }) => {
		const organization = props.session.organization
		const ids = [...new Set(invitesOf(model.invites).map((invite) => invite.hostOrganizationId))].sort()
		return [
			organization === null
				? null
				: Subscription.make("list", [organization.id, String(model.version)], ([id, version]) =>
						listStream(OrganizationId.make(id), Number(version)),
					),
			ids.length === 0
				? null
				: Subscription.make("hosts", [ids.join(",")], ([joined]) =>
						hostOrganizationsStream(joined.split(",").map((id) => OrganizationId.make(id))),
					),
		]
	},
	view: (h, model) => {
		const pending = invitesOf(model.invites).filter((invite) => invite.status === "pending").length
		return settingsColumn(
			h,
			"connect-invites-page",
			suggestionPrompt(h, model.suggestion),
			settingsCard(
				h,
				"invites-card",
				cardHeader(h, {
					title: "Connect invitations",
					subtitle: "Invitations from other organizations to share channels.",
					badge: pending > 0 ? `${pending} pending` : undefined,
				}),
				h.divider.key("header-rule"),
				body(h, model),
			),
		)
	},
})

export const ConnectInvitesPage = ConnectInvitesPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			AcceptInvite.layer,
			DeclineInvite.layer,
			FetchChannelSuggestion.layer,
			SettleSuggestion.layer,
		),
	),
)
