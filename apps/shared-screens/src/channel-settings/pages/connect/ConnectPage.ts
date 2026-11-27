// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/channels/:channelId/settings/connect` (the deleted Foldkit `page/channel-settings/connect`):
 * the workspaces the channel is shared with over Hazel Connect, its outgoing invitations, and the
 * share dialog. Disconnecting asks first; a guest leaves the shared channel instead.
 */
import { Command, Component, Query, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import {
	getConnectInviteStatusBadge,
	getSharedConversationMountsForChannel,
} from "@hazel/client-data/connect-shared-channels"
import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq, inArray } from "@tanstack/db"
import { Cause, DateTime, Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { liveQuery } from "../../../app/live"
import { AppRequests } from "../../../app/requests"
import { Session } from "../../../app/session"
import {
	CommonReason,
	commonCopy,
	copyOf,
	errorToast,
	reasonOf,
	successToast,
	toast,
} from "../../../modals/feedback"
import { channelStream } from "../../../shell/queries"
import { isRetryable, pageHeader } from "../../ui"
import { ShareChannelModal } from "./ShareChannelModal"

export const Mount = Schema.Struct({
	id: Schema.String,
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	role: Schema.Literals(["host", "guest"]),
})
export type Mount = typeof Mount.Type

export const OrgSummary = Schema.Struct({
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type OrgSummary = typeof OrgSummary.Type

export const Invite = Schema.Struct({
	id: ConnectInviteId,
	targetValue: Schema.String,
	status: Schema.String,
	createdAtMs: Schema.Finite,
})
export type Invite = typeof Invite.Type

export const ConnectProps = Schema.Struct({ channelId: ChannelId, session: Session })
export type ConnectProps = typeof ConnectProps.Type

export const ConnectModel = Schema.Struct({
	channelName: Schema.NullOr(Schema.String),
	/** Every active mount of the channel's shared conversation (none until it is shared). */
	mounts: Schema.Array(Mount),
	orgs: Schema.Record(Schema.String, OrgSummary),
	/** Bumped after a write and on retry: the invitations are fetched again. */
	attempt: Schema.Finite,
	revoking: Schema.Array(ConnectInviteId),
	disconnecting: Schema.Array(Schema.String),
	/** The connection row asking to confirm its Disconnect or Leave (the first press arms it). */
	confirming: Schema.NullOr(Schema.String),
	isSharing: Schema.Boolean,
})
export type ConnectModel = typeof ConnectModel.Type

export const ConnectMessage = UiSchema.TaggedEnum({
	UpdatedChannelName: { name: Schema.NullOr(Schema.String) },
	UpdatedMounts: { mounts: Schema.Array(Mount) },
	UpdatedOrgs: { orgs: Schema.Record(Schema.String, OrgSummary) },
	PressedRetryInvites: {},
	PressedShare: {},
	ClosedShare: {},
	SentInvite: {},
	PressedRevoke: { inviteId: ConnectInviteId },
	SettledRevoke: { inviteId: ConnectInviteId, succeeded: Schema.Boolean },
	PressedDisconnect: { mountId: Schema.String },
	PressedCancelDisconnect: {},
	PressedConfirmDisconnect: { mountId: Schema.String },
	SettledDisconnect: { mountId: Schema.String },
})
export type ConnectMessage = typeof ConnectMessage.Type

const msOf = (date: unknown): number =>
	DateTime.isDateTime(date) ? DateTime.toEpochMillis(date) : new Date(date as string | Date).getTime()

/** `listOutgoingInvitesQuery`, filtered to the invites this channel hosts. */
export class GetOutgoingInvites extends Query.Service<GetOutgoingInvites>()(
	"hazel/connect/GetOutgoingInvites",
	{
		args: { organizationId: OrganizationId, channelId: ChannelId, attempt: Schema.Finite },
		success: Schema.Array(Invite),
		error: CommonReason,
		staleTime: "0 millis",
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, channelId }) =>
					rpc("connectShare.invite.listOutgoing", { organizationId }).pipe(
						Effect.map((response) =>
							response.data
								.filter((invite) => invite.hostChannelId === channelId)
								.map((invite): Invite => ({
									id: invite.id,
									targetValue: invite.targetValue,
									status: invite.status,
									createdAtMs: msOf(invite.createdAt),
								})),
						),
						// BOUNDARY: a failed load reads as its common reason.
						Effect.catchCause((cause) =>
							Effect.fail(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause)))),
						),
					),
		),
	)
}

/** The RPC client and the app's requests, captured when a Command's Layer builds. */
const services = Effect.gen(function* () {
	const rpc = yield* HazelRpc
	const requests = yield* AppRequests
	return {
		rpc,
		run: <A, E>(effect: Effect.Effect<A, E, AppRequests>) =>
			Effect.provideService(effect, AppRequests, requests),
	}
})

const failureCopy = (
	cause: Cause.Cause<unknown>,
	own: Readonly<Record<string, { title: string; description: string }>>,
) => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
	return own[tag] ?? copyOf(reasonOf(error), {})
}

export class RevokeInvite extends Command.Service<RevokeInvite>()("hazel/connect/RevokeInvite", {
	args: { inviteId: ConnectInviteId },
	success: ConnectMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc, run }) =>
				({ inviteId }) =>
					run(
						rpc("connectShare.invite.revoke", { inviteId }).pipe(
							Effect.andThen(toast(successToast("Invite revoked"))),
							Effect.as(ConnectMessage.SettledRevoke({ inviteId, succeeded: true })),
							// BOUNDARY: every failure is a toast.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										failureCopy(cause, {
											ConnectInviteNotFoundError: {
												title: "Invite not found",
												description:
													"This invite may have already been revoked or expired.",
											},
											ConnectInviteInvalidStateError: {
												title: "Cannot revoke",
												description: "This invite is no longer in a revokable state.",
											},
										}),
									),
								).pipe(
									Effect.as(ConnectMessage.SettledRevoke({ inviteId, succeeded: false })),
								),
							),
						),
					),
		),
	)
}

export class DisconnectOrganization extends Command.Service<DisconnectOrganization>()(
	"hazel/connect/DisconnectOrganization",
	{
		args: {
			mountId: Schema.String,
			conversationId: ConnectConversationId,
			organizationId: OrganizationId,
			isLeaving: Schema.Boolean,
		},
		success: ConnectMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc, run }) =>
				({ mountId, conversationId, organizationId, isLeaving }) =>
					run(
						rpc("connectShare.organization.disconnect", { conversationId, organizationId }).pipe(
							Effect.andThen(
								toast(
									successToast(
										isLeaving ? "Left shared channel" : "Organization disconnected",
									),
								),
							),
							// BOUNDARY: every failure is a toast.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										failureCopy(cause, {
											ConnectConversationNotFoundError: {
												title: "Connection not found",
												description: "This organization may already be disconnected.",
											},
										}),
									),
								),
							),
							Effect.as(ConnectMessage.SettledDisconnect({ mountId })),
						),
					),
		),
	)
}

/** `ConnectionRow`'s roles: who may disconnect whom. */
export const rowRoles = (
	mount: Mount,
	viewerRole: Mount["role"] | undefined,
	currentOrgId: OrganizationId | null,
) => {
	const isGuestLeaving = viewerRole === "guest" && mount.role === "host"
	return {
		isOwnOrg: mount.organizationId === currentOrgId,
		isGuestLeaving,
		canDisconnect: viewerRole === "host" || isGuestLeaving,
		targetOrganizationId: isGuestLeaving ? currentOrgId : mount.organizationId,
	}
}

const ConnectDef = Hazel.component({
	name: "ChannelSettingsConnect",
	props: ConnectProps,
	model: ConnectModel,
	message: ConnectMessage,
	queries: {
		invites: {
			query: GetOutgoingInvites,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							channelId: props.channelId,
							attempt: model.attempt,
						},
		},
	},
	restore: (model) => ({ ...model, revoking: [], disconnecting: [], confirming: null, isSharing: false }),
})

type H = Parameters<Parameters<typeof ConnectDef.make>[0]["view"]>[0]

const viewerRoleOf = (model: ConnectModel, currentOrgId: OrganizationId | null) =>
	model.mounts.find((mount) => mount.organizationId === currentOrgId)?.role

/** The row a Disconnect acts on, or null when it is gone, already running, or not the viewer's to cut. */
const disconnectTarget = (model: ConnectModel, mountId: string, currentOrgId: OrganizationId | null) => {
	const mount = model.mounts.find((candidate) => candidate.id === mountId)
	if (mount === undefined || model.disconnecting.includes(mountId)) return null
	const roles = rowRoles(mount, viewerRoleOf(model, currentOrgId), currentOrgId)
	if (!roles.canDisconnect || roles.targetOrganizationId === null) return null
	return { mount, organizationId: roles.targetOrganizationId, isLeaving: roles.isGuestLeaving }
}

const connectionRow = (h: H, model: ConnectModel, mount: Mount) => {
	const currentOrgId = h.props.session.organization?.id ?? null
	const roles = rowRoles(mount, viewerRoleOf(model, currentOrgId), currentOrgId)
	if (roles.isOwnOrg) return null
	const org = model.orgs[mount.organizationId]
	const orgName = org?.name ?? mount.organizationId
	const isConfirming = model.confirming === mount.id
	const isDisconnecting = model.disconnecting.includes(mount.id)
	const subtitle = isConfirming
		? roles.isGuestLeaving
			? "Leave this shared channel? Your workspace stops seeing its messages."
			: `Disconnect ${orgName}? They stop seeing this channel.`
		: (org?.slug ?? undefined)
	const trailing = !roles.canDisconnect
		? h.text.role("caption").tone("muted").children("Managed by host workspace")
		: isConfirming
			? h.stack
					.axis("horizontal")
					.density("compact")
					.children(
						h.button
							.label("Cancel")
							.variant("outline")
							.size("small")
							.on("press", ConnectMessage.PressedCancelDisconnect()),
						// HAZEL-GAP(p4-button-aria-label): today's names it "Confirm disconnect <org>" for assistive tech.
						h.button
							.label(roles.isGuestLeaving ? "Leave" : "Disconnect")
							.variant("danger")
							.size("small")
							.on("press", ConnectMessage.PressedConfirmDisconnect({ mountId: mount.id })),
					)
			: h.button
					.label(
						isDisconnecting
							? roles.isGuestLeaving
								? "Leaving..."
								: "Disconnecting..."
							: roles.isGuestLeaving
								? "Leave shared channel"
								: "Disconnect",
					)
					.variant("outline")
					.size("small")
					.disabled(isDisconnecting)
					.loading(isDisconnecting)
					.on("press", ConnectMessage.PressedDisconnect({ mountId: mount.id }))
	// Today's row: a 32pt square logo by the name over the slug, the action at the end (`px-4 py-3`).
	return h.stack
		.key(mount.id)
		.axis("horizontal")
		.density("cozy")
		.align("center")
		.inset("bar")
		.children(
			h.avatar
				.name(org?.name ?? "")
				.src(org?.logoUrl ?? undefined)
				.size("small")
				.corners("square"),
			h.stack.density("none").children(
				h.text.role("label").strong().truncate().children(orgName),
				subtitle === undefined
					? null
					: h.text
							.role("caption")
							.tone(isConfirming ? "default" : "muted")
							.children(subtitle),
			),
			h.spacer,
			trailing,
		)
}

/** A card: its titled header over a hairline, then its rows edge to edge. */
const card = (
	h: H,
	title: ReadonlyArray<Hazel.NoTextInput<ConnectMessage>>,
	body: Hazel.NoTextInput<ConnectMessage>,
) =>
	// HAZEL-GAP(p4-card-header): today's `cardHeader` and rows pad `md:px-6`; the stack insets are `px-4`.
	// Sent is today's `w-36` (144), the nearest width `regular` (128).
	h.frame.surface("flush").children(
		h.stack
			.axis("horizontal")
			.density("compact")
			.align("center")
			.inset("page")
			.children(...title),
		h.divider,
		body,
	)

const activeConnections = (h: H, model: ConnectModel) => {
	const currentOrgId = h.props.session.organization?.id ?? null
	const others = model.mounts.filter((mount) => mount.organizationId !== currentOrgId).length
	return card(
		h,
		[
			h.heading.level("3").children("Active connections"),
			h.badge.label(String(others)).tone("success").size("small"),
		],
		h.stack
			.density("none")
			.children(
				...model.mounts
					.map((mount) => connectionRow(h, model, mount))
					.flatMap((row, index) => (row === null ? [] : index === 0 ? [row] : [h.divider, row])),
			),
	)
}

const INVITE_COLUMNS = [
	{ key: "target", label: "Target", width: "fill" as const },
	{ key: "status", label: "Status", width: "regular" as const },
	{ key: "sent", label: "Sent", width: "regular" as const, optional: true },
	{ key: "actions", label: "Actions", align: "end" as const, width: "regular" as const },
]

const invitations = (h: H, model: ConnectModel, invites: ReadonlyArray<Invite>) =>
	card(
		h,
		[h.heading.level("3").children("Invitations")],
		h.table
			.label("Invitations")
			.columns(INVITE_COLUMNS)
			.children(
				...invites.map((invite) => {
					const status = getConnectInviteStatusBadge(invite.status)
					const isRevoking = model.revoking.includes(invite.id)
					return h.tableRow
						.key(invite.id)
						.title(invite.targetValue)
						.children(
							h.tableCell
								.column("target")
								.children(
									h.stack
										.density("none")
										.children(
											h.text.strong().truncate().children(invite.targetValue),
											h.text.role("caption").tone("muted").children("Workspace"),
										),
								),
							h.tableCell.column("status").children(
								h.stack.axis("horizontal").children(
									h.badge
										.label(status.label)
										.tone(status.intent === "secondary" ? "neutral" : status.intent)
										.size("small"),
								),
							),
							h.tableCell
								.column("sent")
								.children(
									h.text
										.tone("muted")
										.children(new Date(invite.createdAtMs).toLocaleDateString()),
								),
							h.tableCell.column("actions").children(
								invite.status !== "pending"
									? null
									: h.button
											.label(isRevoking ? "Revoking..." : "Revoke")
											.variant("outline")
											.size("small")
											.disabled(isRevoking)
											.on(
												"press",
												ConnectMessage.PressedRevoke({ inviteId: invite.id }),
											),
							),
						)
				}),
			),
	)

const invitesFailed = (h: H, reason: CommonReason) => {
	const copy = commonCopy(reason)
	return h.banner
		.tone("danger")
		.title("Couldn't load invitations")
		.description(copy.description ?? copy.title)
		.actions(
			isRetryable(reason)
				? h.button
						.label("Try again")
						.variant("outline")
						.size("small")
						.on("press", ConnectMessage.PressedRetryInvites())
				: null,
		)
}

const notShared = (h: H) =>
	h.emptyState
		.icon("connect")
		.title("Not shared yet")
		.description("Share this channel with another organization to start collaborating across teams.")
		.action(
			h.button
				.label("Share this channel")
				.icon("plus")
				.variant("secondary")
				.size("small")
				.on("press", ConnectMessage.PressedShare()),
		)

/** The invitations table, a load failure, or (with no connections either) the "not shared" empty state. */
const invitationsSection = (h: H, model: ConnectModel, isConnected: boolean) =>
	Match.value(h.queries.invites).pipe(
		Match.tag("Failure", ({ cause }) =>
			invitesFailed(
				h,
				Option.getOrElse(Cause.findErrorOption(cause), () => "Unexpected" as const),
			),
		),
		Match.tag("Success", ({ value }) =>
			value.length > 0 ? invitations(h, model, value) : isConnected ? null : notShared(h),
		),
		Match.orElse(() => null),
	)

const mountsStream = (channelId: ChannelId) =>
	liveQuery<
		{
			readonly id: string
			readonly channelId: ChannelId
			readonly conversationId: ConnectConversationId
			readonly organizationId: OrganizationId
			readonly role: "host" | "guest"
			readonly isActive: boolean
			readonly deletedAt: Date | null
		},
		ConnectMessage
	>(
		(data) => (q) =>
			q
				.from({ ccc: data.collections.connectConversationChannelCollection })
				.where(({ ccc }) => eq(ccc.isActive, true))
				.select(({ ccc }) => ({ ...ccc })),
		(rows) =>
			ConnectMessage.UpdatedMounts({
				mounts: getSharedConversationMountsForChannel(channelId, rows).map((mount) => ({
					id: mount.id,
					conversationId: mount.conversationId,
					organizationId: mount.organizationId,
					role: mount.role,
				})),
			}),
	)

const orgsStream = (ids: ReadonlyArray<string>) =>
	liveQuery<
		{
			readonly id: string
			readonly name: string
			readonly slug?: string | null
			readonly logoUrl?: string | null
		},
		ConnectMessage
	>(
		(data) => (q) =>
			q
				.from({ org: data.collections.organizationCollection })
				.where(({ org }) => inArray(org.id, [...ids]))
				.select(({ org }) => ({ id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl })),
		(rows) =>
			ConnectMessage.UpdatedOrgs({
				orgs: Object.fromEntries(
					rows.map((row): [string, OrgSummary] => [
						row.id,
						{ name: row.name, slug: row.slug ?? null, logoUrl: row.logoUrl ?? null },
					]),
				),
			}),
	)

/** Joined with "," so the key is a stable string. */
const mountOrgIds = (model: ConnectModel) =>
	[...new Set(model.mounts.map((mount) => mount.organizationId))].sort().join(",")

const without = <Id extends string>(ids: ReadonlyArray<Id>, id: Id): ReadonlyArray<Id> =>
	ids.filter((candidate) => candidate !== id)

export const ConnectPageNoDeps = ConnectDef.make({
	init: () => ({
		channelName: null,
		mounts: [],
		orgs: {},
		attempt: 0,
		revoking: [],
		disconnecting: [],
		confirming: null,
		isSharing: false,
	}),
	update: {
		UpdatedChannelName: ($, { name }) => $.evolve({ channelName: () => name }),
		UpdatedMounts: ($, { mounts }) => $.evolve({ mounts: () => mounts }),
		UpdatedOrgs: ($, { orgs }) => $.evolve({ orgs: () => orgs }),
		PressedRetryInvites: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		PressedShare: ($) => $.evolve({ isSharing: () => true }),
		ClosedShare: ($) => $.evolve({ isSharing: () => false }),
		// A new invite shows in the list: it is fetched again.
		SentInvite: ($) => $.evolve({ isSharing: () => false, attempt: (attempt) => attempt + 1 }),
		PressedRevoke: ($, { inviteId }) =>
			$.model.revoking.includes(inviteId)
				? $.model
				: $.evolve({ revoking: (ids) => [...ids, inviteId] }).run(RevokeInvite.make({ inviteId })),
		SettledRevoke: ($, { inviteId, succeeded }) =>
			$.evolve({
				revoking: (ids) => without(ids, inviteId),
				attempt: (attempt) => (succeeded ? attempt + 1 : attempt),
			}),
		// Disconnecting another workspace (or leaving) ends the shared channel for it: the first press asks.
		PressedDisconnect: ($, { mountId }) =>
			disconnectTarget($.model, mountId, $.props.session.organization?.id ?? null) === null
				? $.model
				: $.evolve({ confirming: () => mountId }),
		PressedCancelDisconnect: ($) => $.evolve({ confirming: () => null }),
		PressedConfirmDisconnect: ($, { mountId }) => {
			const target = disconnectTarget($.model, mountId, $.props.session.organization?.id ?? null)
			if (target === null || $.model.confirming !== mountId) return $.model
			return $.evolve({ confirming: () => null, disconnecting: (ids) => [...ids, mountId] }).run(
				DisconnectOrganization.make({
					mountId,
					conversationId: target.mount.conversationId,
					organizationId: target.organizationId,
					isLeaving: target.isLeaving,
				}),
			)
		},
		SettledDisconnect: ($, { mountId }) => $.evolve({ disconnecting: (ids) => without(ids, mountId) }),
	},
	subscriptions: ({ props, model }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) =>
			channelStream(ChannelId.make(channelId), (channel) =>
				ConnectMessage.UpdatedChannelName({ name: channel?.name ?? null }),
			),
		),
		Subscription.make("mounts", [props.channelId], ([channelId]) =>
			mountsStream(ChannelId.make(channelId)),
		),
		Subscription.make("orgs", [mountOrgIds(model)], ([ids]) =>
			ids === "" ? Stream.empty : orgsStream(ids.split(",")),
		),
	],
	view: (h, model) => {
		const isConnected = model.mounts.length > 0
		return h.stack
			.key("channel-settings-connect")
			.density("relaxed")
			.children(
				pageHeader(h, {
					title: "Hazel Connect",
					subtitle: "Share this channel with another organization to collaborate together.",
					actions: [
						h.button
							.label("Share channel")
							.icon("plus")
							.variant("secondary")
							.on("press", ConnectMessage.PressedShare()),
					],
				}),
				isConnected ? activeConnections(h, model) : null,
				invitationsSection(h, model, isConnected),
				model.channelName === null || !model.isSharing
					? null
					: ShareChannelModal(h, {
							props: {
								channelId: h.props.channelId,
								channelName: model.channelName,
								organizationId: h.props.session.organization?.id ?? null,
							},
							onEmit: {
								RequestedClose: () => ConnectMessage.ClosedShare(),
								Sent: () => ConnectMessage.SentInvite(),
							},
						}),
			)
	},
})

export const ConnectPage = ConnectPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(GetOutgoingInvites.layer, RevokeInvite.layer, DisconnectOrganization.layer),
	),
)
