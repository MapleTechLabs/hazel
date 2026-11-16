import { modifyFields } from "foldkit/struct"
import { commonMessage } from "~/lib/error-messages"
import { errorToast, successToast } from "../../../data/actions"
import type { RouteOf } from "../../../route"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { CopyText, CreateToken, FetchGrants, RevokeGrant } from "./command"
import { Message } from "./message"
import { Grants, type Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"MySettingsAgents">): Return => ({
	model: {
		orgSlug: route.orgSlug,
		grants: Grants.Loading(),
		tokenName: "",
		tokenAccess: "write",
		isCreating: false,
		createdToken: null,
		confirmingRevoke: null,
		revoking: null,
	},
	commands: [FetchGrants()],
})

const toast = (
	model: Model,
	request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"],
): Return => ({
	model,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchGrants: ({ grants, mcpUrl }) => ({
			model: modifyFields(model, { grants: () => Grants.Loaded({ grants, mcpUrl }) }),
		}),
		FailedFetchGrants: ({ reason }) => ({
			model: modifyFields(model, { grants: () => Grants.Failed({ reason }) }),
		}),
		ClickedRetry: () => ({
			model: modifyFields(model, { grants: () => Grants.Loading() }),
			commands: [FetchGrants()],
		}),
		ClickedRevoke: ({ grantId }) =>
			model.revoking !== null
				? { model }
				: { model: modifyFields(model, { confirmingRevoke: () => grantId }) },
		ClickedCancelRevoke: () => ({ model: modifyFields(model, { confirmingRevoke: () => null }) }),
		ClickedConfirmRevoke: ({ grantId }) =>
			model.revoking !== null
				? { model }
				: {
						model: modifyFields(model, { confirmingRevoke: () => null, revoking: () => grantId }),
						commands: [RevokeGrant({ grantId })],
					},
		SucceededRevoke: ({ grantId }) =>
			toast(
				modifyFields(model, {
					revoking: () => null,
					grants: (grants) =>
						grants._tag === "Loaded"
							? Grants.Loaded({
									mcpUrl: grants.mcpUrl,
									grants: grants.grants.filter((grant) => grant.id !== grantId),
								})
							: grants,
				}),
				successToast("Agent disconnected"),
			),
		FailedRevoke: ({ reason }) =>
			toast(
				modifyFields(model, { revoking: () => null }),
				errorToast("Couldn't disconnect the agent", commonMessage(reason).title),
			),
		ChangedTokenName: ({ value }) => ({ model: modifyFields(model, { tokenName: () => value }) }),
		SelectedTokenAccess: ({ access }) => ({ model: modifyFields(model, { tokenAccess: () => access }) }),
		ClickedCreateToken: () => {
			const name = model.tokenName.trim()
			return model.isCreating || name.length === 0
				? { model }
				: {
						model: modifyFields(model, { isCreating: () => true }),
						commands: [CreateToken({ name, access: model.tokenAccess })],
					}
		},
		SucceededCreateToken: ({ token, grant }) => ({
			model: modifyFields(model, {
				isCreating: () => false,
				tokenName: () => "",
				createdToken: () => token,
				grants: (grants) =>
					grants._tag === "Loaded"
						? Grants.Loaded({ mcpUrl: grants.mcpUrl, grants: [grant, ...grants.grants] })
						: grants,
			}),
		}),
		FailedCreateToken: ({ reason }) =>
			toast(
				modifyFields(model, { isCreating: () => false }),
				errorToast("Couldn't create the token", commonMessage(reason).title),
			),
		ClickedDismissToken: () => ({ model: modifyFields(model, { createdToken: () => null }) }),
		ClickedCopy: ({ target, text }) => ({ model, commands: [CopyText({ target, text })] }),
		SucceededCopy: ({ target }) =>
			toast(model, successToast(target === "Token" ? "Token copied" : "MCP URL copied")),
		FailedCopy: () => toast(model, errorToast("Couldn't copy to the clipboard")),
	})
