import { Array, Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Menu from "../../../ui/menu"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { errorToast, successToast } from "../../../data/actions"
import { fetchPendingInvitations, revokeInvitation } from "./clerk"
import { Message } from "./message"
import type { Invitation, Model, RowMenu } from "./model"

type Return = PageReturn<Model, Message>

export const REVOKE_KEY = "revoke"

// COMMAND

export const FetchInvitations = Command.define("FetchInvitations", {
	args: { version: Schema.Number },
	messages: [Message.CompletedFetchInvitations],
	execute: ({ version }) =>
		fetchPendingInvitations.pipe(
			Effect.map((invitations) => Message.CompletedFetchInvitations({ version, invitations })),
		),
})

export const RevokeInvitation = Command.define("RevokeInvitation", {
	args: { invitationId: Schema.String },
	messages: [Message.SucceededRevokeInvitation, Message.FailedRevokeInvitation],
	execute: ({ invitationId }) =>
		revokeInvitation(invitationId).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededRevokeInvitation(),
				onFailure: () => Message.FailedRevokeInvitation(),
			}),
		),
})

// MENUS

const menuEntries = (isRevoking: boolean) => [
	Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: isRevoking }),
]

/** One row menu per invitation, keeping open state for rows that stay. */
const reflectMenus = (
	menus: ReadonlyArray<RowMenu>,
	invitations: ReadonlyArray<Invitation>,
	revokingId: string | null,
): ReadonlyArray<RowMenu> =>
	invitations.map((invitation) => {
		const entries = menuEntries(revokingId === invitation.id)
		return Option.match(
			Array.findFirst(menus, (row) => row.invitationId === invitation.id),
			{
				onNone: () => ({
					invitationId: invitation.id,
					menu: Menu.init({ id: `invitation-${invitation.id}`, entries, placement: "bottom end" }),
				}),
				onSome: (row) => ({
					invitationId: row.invitationId,
					menu: Menu.reflectEntries(row.menu, entries),
				}),
			},
		)
	})

const withRevokingId = (model: Model, revokingId: string | null): Model =>
	modifyFields(model, {
		revokingId: () => revokingId,
		menus: (menus) => reflectMenus(menus, model.invitations, revokingId),
	})

// INIT

export const init = (): Return => ({
	model: { invitations: [], fetchVersion: 1, menus: [], revokingId: null },
	commands: [FetchInvitations({ version: 1 })],
})

// UPDATE

const updateRowMenu = (model: Model, invitationId: string, message: Menu.Message): Return =>
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

const refetch = (model: Model): Return => {
	const version = model.fetchVersion + 1
	return {
		model: modifyFields(model, { fetchVersion: () => version }),
		commands: [FetchInvitations({ version })],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		CompletedFetchInvitations: ({ version, invitations }) =>
			version !== model.fetchVersion
				? { model }
				: {
						model: modifyFields(model, {
							invitations: () => invitations,
							menus: (menus) => reflectMenus(menus, invitations, model.revokingId),
						}),
					},
		ClickedInviteUser: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }),
		}),
		GotRowMenuMessage: ({ invitationId, message: child }) => updateRowMenu(model, invitationId, child),
		// Clerk's infinite query doesn't refetch after a mutation; legacy revalidates it.
		SucceededRevokeInvitation: () => ({
			...refetch(withRevokingId(model, null)),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Invitation revoked successfully"),
			}),
		}),
		FailedRevokeInvitation: () => ({
			...refetch(withRevokingId(model, null)),
			outMessage: PageOutMessage.RequestedToast({ toast: errorToast("Failed to revoke invitation") }),
		}),
	})
