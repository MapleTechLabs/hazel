import { parseAgentScopes } from "@hazel/domain/http"
import { AgentClientId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { modifyFields } from "foldkit/struct"
import { hrefOf, type RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { AuthorizeAgent, FetchAgentClient, RedirectToAuthorizeSignIn } from "./command"
import { Message } from "./message"
import { Approval, Lookup, type Model, type Request } from "./model"

type Return = PageReturn<Model, Message>

const decodeClientId = Schema.decodeUnknownOption(AgentClientId)

/** The link's parameters; `null` when one is missing or malformed (only `code` with S256 PKCE). */
export const requestOf = (route: RouteOf<"OAuthAuthorize">): Request | null => {
	const clientId = Option.flatMap(route.clientId, decodeClientId)
	const method = Option.getOrElse(route.codeChallengeMethod, () => "S256")
	if (
		Option.isNone(clientId) ||
		Option.isNone(route.redirectUri) ||
		Option.isNone(route.codeChallenge) ||
		Option.getOrNull(route.responseType) !== "code" ||
		method !== "S256"
	)
		return null
	const scope = Option.getOrNull(route.scope)
	return {
		clientId: clientId.value,
		redirectUri: route.redirectUri.value,
		codeChallenge: route.codeChallenge.value,
		codeChallengeMethod: method,
		scope,
		state: Option.getOrNull(route.state),
		scopes: parseAgentScopes(scope),
	}
}

const fetchOf = (request: Request) =>
	FetchAgentClient({ clientId: request.clientId, redirectUri: request.redirectUri })

export const init = (route: RouteOf<"OAuthAuthorize">): Return => {
	const request = requestOf(route)
	const base = { returnTo: hrefOf(route), request, approval: Approval.Idle() }
	return request === null
		? { model: { ...base, lookup: Lookup.Invalid() } }
		: { model: { ...base, lookup: Lookup.Loading() }, commands: [fetchOf(request)] }
}

const isBusy = (model: Model) =>
	model.approval._tag === "Approving" ||
	model.approval._tag === "Denying" ||
	model.approval._tag === "Leaving"

const authorize = (model: Model, approve: boolean): Return =>
	isBusy(model) || model.request === null || model.lookup._tag !== "Loaded"
		? { model }
		: {
				model: modifyFields(model, {
					approval: () => (approve ? Approval.Approving() : Approval.Denying()),
				}),
				commands: [
					AuthorizeAgent({
						clientId: model.request.clientId,
						redirectUri: model.request.redirectUri,
						codeChallenge: model.request.codeChallenge,
						codeChallengeMethod: model.request.codeChallengeMethod,
						scope: model.request.scope,
						state: model.request.state,
						approve,
					}),
				],
			}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchClient: ({ client }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Loaded({ client }) }),
		}),
		FoundInvalidRequest: () => ({ model: modifyFields(model, { lookup: () => Lookup.Invalid() }) }),
		FailedFetchClient: ({ reason }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Failed({ reason }) }),
		}),
		ClickedRetryRequest: () =>
			model.lookup._tag !== "Failed" || model.request === null
				? { model }
				: {
						model: modifyFields(model, { lookup: () => Lookup.Loading() }),
						commands: [fetchOf(model.request)],
					},
		ClickedSignIn: () => ({
			model: modifyFields(model, { approval: () => Approval.Leaving() }),
			commands: [RedirectToAuthorizeSignIn({ returnTo: model.returnTo })],
		}),
		ClickedApprove: () => authorize(model, true),
		// Only once the client checked out: an unverified redirect is never followed.
		ClickedDeny: () => authorize(model, false),
		FailedAuthorize: ({ reason }) => ({
			model: modifyFields(model, { approval: () => Approval.Failed({ reason }) }),
		}),
		LeftPage: () => ({ model: modifyFields(model, { approval: () => Approval.Leaving() }) }),
	})
