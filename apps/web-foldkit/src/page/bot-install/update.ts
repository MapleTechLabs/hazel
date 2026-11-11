import { BotId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { modifyFields } from "foldkit/struct"
import { hrefOf, type RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { ApproveInstall, DeclineInstall, FetchInstallRequest, RedirectToBotInstallSignIn } from "./command"
import { Message } from "./message"
import { Approval, Lookup, type Model, type Request } from "./model"

type Return = PageReturn<Model, Message>

const decodeBotId = Schema.decodeUnknownOption(BotId)

/** The link's parameters; `null` when one is missing or malformed. */
const requestOf = (route: RouteOf<"BotInstall">): Request | null => {
	const botId = Option.flatMap(route.botId, decodeBotId)
	if (Option.isNone(botId) || Option.isNone(route.redirectUri) || Option.isNone(route.state)) return null
	return { botId: botId.value, redirectUri: route.redirectUri.value, state: route.state.value }
}

export const init = (route: RouteOf<"BotInstall">): Return => {
	const request = requestOf(route)
	const base = {
		returnTo: hrefOf(route),
		request,
		targets: null,
		selectedOrganizationId: null,
		approval: Approval.Idle(),
	}
	return request === null
		? { model: { ...base, lookup: Lookup.Invalid() } }
		: {
				model: { ...base, lookup: Lookup.Loading() },
				commands: [FetchInstallRequest({ botId: request.botId, redirectUri: request.redirectUri })],
			}
}

const isBusy = (model: Model) => model.approval._tag === "Approving" || model.approval._tag === "Leaving"

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchRequest: ({ bot }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Loaded({ bot }) }),
		}),
		FoundInvalidRequest: () => ({ model: modifyFields(model, { lookup: () => Lookup.Invalid() }) }),
		FailedFetchRequest: ({ reason }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Failed({ reason }) }),
		}),
		ClickedRetryRequest: () =>
			model.lookup._tag !== "Failed" || model.request === null
				? { model }
				: {
						model: modifyFields(model, { lookup: () => Lookup.Loading() }),
						commands: [
							FetchInstallRequest({
								botId: model.request.botId,
								redirectUri: model.request.redirectUri,
							}),
						],
					},
		UpdatedTargets: ({ targets }) => {
			const [first] = targets
			// Keep the pick while it is still a target; otherwise the first one.
			const selected =
				model.selectedOrganizationId !== null &&
				targets.some((target) => target.id === model.selectedOrganizationId)
					? model.selectedOrganizationId
					: (first?.id ?? null)
			return {
				model: modifyFields(model, {
					targets: () => targets,
					selectedOrganizationId: () => selected,
				}),
			}
		},
		SelectedOrganization: ({ organizationId }) =>
			isBusy(model)
				? { model }
				: {
						model: modifyFields(model, {
							selectedOrganizationId: () => organizationId,
							approval: () => Approval.Idle(),
						}),
					},
		ClickedSignIn: () => ({
			model: modifyFields(model, { approval: () => Approval.Leaving() }),
			commands: [RedirectToBotInstallSignIn({ returnTo: model.returnTo })],
		}),
		ClickedApprove: () =>
			isBusy(model) || model.request === null || model.selectedOrganizationId === null
				? { model }
				: {
						model: modifyFields(model, { approval: () => Approval.Approving() }),
						commands: [
							ApproveInstall({
								botId: model.request.botId,
								organizationId: model.selectedOrganizationId,
								redirectUri: model.request.redirectUri,
								state: model.request.state,
							}),
						],
					},
		// Only once the request checked out: an unverified redirect is never followed.
		ClickedCancel: () =>
			isBusy(model) || model.request === null || model.lookup._tag !== "Loaded"
				? { model }
				: {
						model: modifyFields(model, { approval: () => Approval.Leaving() }),
						commands: [
							DeclineInstall({
								redirectUri: model.request.redirectUri,
								state: model.request.state,
							}),
						],
					},
		FailedApprove: ({ reason }) => ({
			model: modifyFields(model, { approval: () => Approval.Failed({ reason }) }),
		}),
		LeftPage: () => ({ model }),
	})
