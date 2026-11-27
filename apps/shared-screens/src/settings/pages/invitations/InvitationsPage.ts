// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/invitations` (`web-foldkit/src/page/settings/invitations`, now deleted): the
 * workspace's pending email invitations, each revocable, and a way to invite more.
 */
import { Command, Component, Query, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { InvitationRole } from "@hazel/domain/rpc"
import { InvitationId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { DateTime, Effect, Layer, Schema } from "effect"
import { OpenModal, ShowToast } from "../../../app/requests"
import { Session } from "../../../app/session"
import { CommonReason, copyOf, errorToast, reasonOf, successToast } from "../../../modals/feedback"
import { asyncListBody } from "../../shared/async-list"
import { settingsCard, settingsColumn } from "../../shared/card"

export const Invitation = Schema.Struct({
	id: InvitationId,
	emailAddress: Schema.String,
	role: InvitationRole,
	createdAtMs: Schema.Finite,
})
export type Invitation = typeof Invitation.Type

/** Why a revoke failed, beyond the common reasons. */
export const RevokeFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type RevokeFailure = typeof RevokeFailure.Type

export const InvitationsMessage = UiSchema.TaggedEnum({
	PressedRetry: {},
	PressedInvite: {},
	SelectedRowAction: { invitationId: InvitationId, action: Schema.String },
	SucceededRevoke: {},
	FailedRevoke: { reason: RevokeFailure },
})
export type InvitationsMessage = typeof InvitationsMessage.Type

export const InvitationsProps = Schema.Struct({ session: Session })
export type InvitationsProps = typeof InvitationsProps.Type

export const InvitationsModel = Schema.Struct({ revokingId: Schema.NullOr(InvitationId) })
export type InvitationsModel = typeof InvitationsModel.Type

export const REVOKE = "revoke"

/** Every pending-invitations entry: a revoke or a retry refetches them. */
const Invitations = Query.Tag("hazel/settings/invitations")

export class ListInvitations extends Query.Service<ListInvitations>()("hazel/settings/ListInvitations", {
	args: { organizationId: OrganizationId },
	success: Schema.Array(Invitation),
	error: CommonReason,
	staleTime: "30 seconds",
	tags: [Invitations],
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId }) =>
				rpc("invitation.list", { organizationId }).pipe(
					Effect.map((rows) =>
						rows.map((row): Invitation => ({
							id: row.id,
							emailAddress: row.email,
							role: row.role,
							createdAtMs: DateTime.toEpochMillis(row.createdAt),
						})),
					),
					// BOUNDARY: `invitation.list` fails only with the transport's and the server's catch-alls.
					Effect.mapError(reasonOf),
				)
		}),
	)
}

/** Fetches the list again (after a failure), keeping what it shows meanwhile. */
export class RefetchInvitations extends Command.Service<RefetchInvitations>()(
	"hazel/settings/RefetchInvitations",
	{ args: {}, success: Component.Noop, invalidates: () => [Invitations] },
) {
	static readonly layer = this.toLayer(Effect.succeed(() => Effect.succeed(Component.noop)))
}

export class RevokeInvitation extends Command.Service<RevokeInvitation>()("hazel/settings/RevokeInvitation", {
	args: { invitationId: InvitationId },
	success: InvitationsMessage,
	invalidates: () => [Invitations],
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ invitationId }) =>
				rpc("invitation.revoke", { id: invitationId }).pipe(
					Effect.as(InvitationsMessage.SucceededRevoke()),
					Effect.catchTags({
						InvitationNotFoundError: () =>
							Effect.succeed(InvitationsMessage.FailedRevoke({ reason: "NotFound" })),
					}),
					// BOUNDARY: any other failure reads as its common reason.
					Effect.catch((error) =>
						Effect.succeed(InvitationsMessage.FailedRevoke({ reason: reasonOf(error) })),
					),
				)
		}),
	)
}

const formatSent = (createdAtMs: number) =>
	new Date(createdAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

const roleLabel = (role: InvitationRole) => (role === "admin" ? "Admin" : "Member")

// HAZEL-GAP(p4-table-widths): today's Sent column is 144px wide; the nearest step is 128.
const COLUMNS = [
	{ key: "email", label: "Email", width: "fill" },
	{ key: "role", label: "Role", width: "regular" },
	{ key: "status", label: "Status", width: "regular", optional: true },
	{ key: "sent", label: "Sent", width: "regular", optional: true },
	{ key: "actions", label: "Actions", width: "narrow", align: "end" },
] as const

const InvitationsDef = Hazel.component({
	name: "InvitationsPage",
	props: InvitationsProps,
	model: InvitationsModel,
	message: InvitationsMessage,
	queries: {
		invitations: {
			query: ListInvitations,
			args: ({ props }) =>
				props.session.organization === null
					? undefined
					: { organizationId: props.session.organization.id },
		},
	},
	// After Back, a revoke that was in flight is not running any more.
	restore: (model) => ({ ...model, revokingId: null }),
})

type H = Parameters<Parameters<typeof InvitationsDef.make>[0]["view"]>[0]

const rowActions = (h: H, invitation: Invitation, isRevoking: boolean) =>
	h.menu
		.key(`menu:${invitation.id}`)
		.label("Invitation actions")
		.entries([
			{
				entries: [
					{
						id: REVOKE,
						label: isRevoking ? "Revoking..." : "Revoke invitation",
						icon: "close",
						destructive: true,
						disabled: isRevoking,
					},
				],
			},
		])
		.on("select", ({ id }) =>
			InvitationsMessage.SelectedRowAction({ invitationId: invitation.id, action: id }),
		)
		.trigger(
			h.button
				.label("Invitation actions")
				.icon("dots")
				.iconOnly()
				.variant("ghost")
				.size("xsmall")
				.loading(isRevoking)
				.disabled(isRevoking),
		)

const invitationRow = (h: H, invitation: Invitation, revokingId: InvitationId | null) => {
	const cell = (column: string, ...content: ReadonlyArray<Hazel.NoTextInput<InvitationsMessage>>) =>
		h.tableCell.column(column).children(...content)
	return h.tableRow
		.key(invitation.id)
		.title(invitation.emailAddress)
		.children(
			cell("email", h.text.role("label").strong().truncate().children(invitation.emailAddress)),
			cell("role", h.text.role("label").tone("muted").children(roleLabel(invitation.role))),
			// HAZEL-GAP(p4-badge-dot): today's Pending badge leads with a warning dot.
			cell("status", h.stack.axis("horizontal").children(h.badge.label("Pending").tone("warning"))),
			cell("sent", h.text.role("label").tone("muted").children(formatSent(invitation.createdAtMs))),
			cell("actions", rowActions(h, invitation, revokingId === invitation.id)),
		)
}

const inviteButton = (h: H, label: string) =>
	h.button.label(label).icon("plus").variant("secondary").on("press", InvitationsMessage.PressedInvite())

const loadedBody = (h: H, model: InvitationsModel, invitations: ReadonlyArray<Invitation>) =>
	invitations.length === 0
		? h.emptyState
				.key("invitations:empty")
				.icon("user-plus")
				.title("No pending invitations")
				.description("Invite team members to join your organization.")
				.action(inviteButton(h, "Invite a team member").size("small"))
		: h.table
				.key("invitations:table")
				.label("Pending invitations")
				.columns(COLUMNS)
				.children(...invitations.map((invitation) => invitationRow(h, invitation, model.revokingId)))

const revokeCopy = {
	NotFound: { title: "Invitation not found", description: "It may have already been accepted or revoked." },
}

export const InvitationsPageNoDeps = InvitationsDef.make({
	init: () => ({ revokingId: null }),
	update: {
		PressedRetry: ($) => $.run(RefetchInvitations.make({})),
		PressedInvite: ($) => $.run(OpenModal.make({ modal: { _tag: "EmailInvite" } })),
		SelectedRowAction: ($, { invitationId, action }) =>
			action !== REVOKE || $.model.revokingId !== null
				? $.model
				: $.set({ revokingId: invitationId }).run(RevokeInvitation.make({ invitationId })),
		SucceededRevoke: ($) =>
			$.set({ revokingId: null }).run(
				ShowToast.make({ toast: successToast("Invitation revoked successfully") }),
			),
		FailedRevoke: ($, { reason }) =>
			$.set({ revokingId: null }).run(
				ShowToast.make({ toast: errorToast(copyOf(reason, revokeCopy)) }),
			),
	},
	view: (h, model) => {
		const result = h.queries.invitations
		const count = result._tag === "Success" ? result.value.length : 0
		return settingsColumn(
			h,
			"invitations",
			settingsCard(
				h,
				"invitations:card",
				{
					title: "Pending invitations",
					subtitle:
						"Pending invitations to this workspace. Each link expires 7 days after it was sent.",
					badge: count > 0 ? `${count} pending` : undefined,
					action: inviteButton(h, "Invite user"),
				},
				asyncListBody(h, result, {
					loadingLabel: "Loading invitations...",
					failedTitle: "Couldn't load invitations",
					onRetry: InvitationsMessage.PressedRetry(),
					reasonOf: (reason) => reason,
					loaded: (invitations) => loadedBody(h, model, invitations),
				}),
			),
		)
	},
})

/** The page with its list query and Commands, on the host's `HazelRpc`. */
export const InvitationsPage = InvitationsPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(ListInvitations.layer, RefetchInvitations.layer, RevokeInvitation.layer),
	),
)
