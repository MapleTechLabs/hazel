import { InvitationId, OrganizationId } from "@hazel/schema"
import { Array, Effect, Option, Result, Schema } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import { listInvitations, revokeInvitation } from "../../../data/invitations"
import * as Menu from "../../../ui/menu"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { type Invitation, Invitations, type Model, type RowMenu } from "./model"

type Return = PageReturn<Model, Message>

export const REVOKE_KEY = "revoke"

// COMMAND

export const FetchInvitations = Command.define("FetchInvitations", {
	args: { organizationId: OrganizationId, version: Schema.Number },
	messages: [Message.SucceededFetchInvitations, Message.FailedFetchInvitations],
	execute: ({ organizationId, version }) =>
		listInvitations(organizationId).pipe(
			Effect.map((invitations) => Message.SucceededFetchInvitations({ version, invitations })),
			catchCommon((reason) => Message.FailedFetchInvitations({ version, reason })),
		),
})

export const RevokeInvitation = Command.define("RevokeInvitation", {
	args: { invitationId: InvitationId },
	messages: [Message.SucceededRevokeInvitation, Message.FailedRevokeInvitation],
	execute: ({ invitationId }) =>
		revokeInvitation(invitationId).pipe(
			Effect.as(Message.SucceededRevokeInvitation()),
			Effect.catchTags({
				InvitationNotFoundError: () =>
					Effect.succeed(Message.FailedRevokeInvitation({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedRevokeInvitation({ reason })),
		),
})

// MENUS

export const rowMenuEntries = (isRevoking: boolean): ReadonlyArray<Menu.Entry> => [
	Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: isRevoking }),
]

/** The invitations on screen: the loaded list, kept while a refetch runs or after one failed. */
export const invitationsOf = (model: Model): ReadonlyArray<Invitation> =>
	Option.getOrElse(AsyncData.getData(model.invitations), () => [])

/** One row menu per invitation, keeping open state for rows that stay. */
const reflectMenus = (
	menus: ReadonlyArray<RowMenu>,
	invitations: ReadonlyArray<Invitation>,
): ReadonlyArray<RowMenu> =>
	invitations.map((invitation) =>
		Option.getOrElse(
			Array.findFirst(menus, (row) => row.invitationId === invitation.id),
			() => ({
				invitationId: invitation.id,
				menu: Menu.init({ id: `invitation-${invitation.id}`, placement: "bottom end" }),
			}),
		),
	)

const withRevokingId = (model: Model, revokingId: InvitationId | null): Model =>
	modifyFields(model, { revokingId: () => revokingId })

// INIT

export const init = (_route: unknown, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	return {
		model: {
			organizationId,
			invitations: organizationId === null ? Invitations.Idle() : Invitations.Loading(),
			fetchVersion: 1,
			menus: [],
			revokingId: null,
		},
		commands: organizationId === null ? [] : [FetchInvitations({ organizationId, version: 1 })],
	}
}

/** A direct load knows the organization only once it synced: fetch then, and on a switch. */
export const sharedChanged = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.organizationId) return { model }
	const version = model.fetchVersion + 1
	return {
		model: modifyFields(model, {
			organizationId: () => organizationId,
			fetchVersion: () => version,
			invitations: () => Invitations.Loading(),
			menus: () => [],
		}),
		commands: [FetchInvitations({ organizationId, version })],
	}
}

// UPDATE

const updateRowMenu = (model: Model, invitationId: InvitationId, message: Menu.Message): Return =>
	Option.match(
		Array.findFirst(model.menus, (row) => row.invitationId === invitationId),
		{
			onNone: () => ({ model }),
			onSome: (row) => {
				const result = Menu.update(row.menu, message)
				const nextModel = modifyFields(model, {
					menus: Array.map((other) =>
						other.invitationId === invitationId ? { invitationId, menu: result.model } : other,
					),
				})
				const commands = Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotRowMenuMessage({ invitationId, message: child }),
				)
				const isRevokeSelected = Option.exists(
					Option.fromNullishOr(result.outMessage),
					(out) => out._tag === "SelectedItem" && out.key === REVOKE_KEY,
				)
				return isRevokeSelected && model.revokingId === null
					? {
							model: withRevokingId(nextModel, invitationId),
							commands: [...commands, RevokeInvitation({ invitationId })],
						}
					: { model: nextModel, commands }
			},
		},
	)

/** Fetches again under a new version; loaded rows stay on screen while it runs. */
const refetch = (model: Model): Return => {
	if (model.organizationId === null) return { model }
	const version = model.fetchVersion + 1
	return {
		model: modifyFields(model, {
			fetchVersion: () => version,
			invitations: (invitations) =>
				Option.getOrElse(AsyncData.revalidateOrLoad(invitations), () => invitations),
		}),
		commands: [FetchInvitations({ organizationId: model.organizationId, version })],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchInvitations: ({ version, invitations }) =>
			version !== model.fetchVersion
				? { model }
				: {
						model: modifyFields(model, {
							invitations: () => Invitations.Success({ data: invitations }),
							menus: (menus) => reflectMenus(menus, invitations),
						}),
					},
		// A failed refetch keeps the rows it had (`Stale`); a failed first load shows the error.
		FailedFetchInvitations: ({ version, reason }) =>
			version !== model.fetchVersion
				? { model }
				: {
						model: modifyFields(model, {
							invitations: (invitations) => AsyncData.settle(invitations, Result.fail(reason)),
						}),
					},
		ClickedRetryFetchInvitations: () => refetch(model),
		ClickedInviteUser: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }),
		}),
		GotRowMenuMessage: ({ invitationId, message: child }) => updateRowMenu(model, invitationId, child),
		// The list is a one-off query, so it is fetched again after a revoke.
		SucceededRevokeInvitation: () => ({
			...refetch(withRevokingId(model, null)),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Invitation revoked successfully"),
			}),
		}),
		FailedRevokeInvitation: ({ reason }) => ({
			...refetch(withRevokingId(model, null)),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Invitation not found",
							description: "It may have already been accepted or revoked.",
						},
					}),
				),
			}),
		}),
	})
