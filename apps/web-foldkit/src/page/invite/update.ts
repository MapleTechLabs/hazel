import { modifyFields } from "foldkit/struct"
import type { RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { AcceptInvitation, FetchPreview, RedirectToInviteSignIn } from "./command"
import { Message } from "./message"
import { Acceptance, Lookup, type Model } from "./model"

type Return = PageReturn<Model, Message>

/** The contract's token length: anything else would fail the payload schema, so it can't be an invitation. */
const isWellFormedToken = (token: string) => token.length >= 16 && token.length <= 128

export const init = (route: RouteOf<"Invite">): Return =>
	isWellFormedToken(route.token)
		? {
				model: { token: route.token, lookup: Lookup.Loading(), acceptance: Acceptance.Idle() },
				commands: [FetchPreview({ token: route.token })],
			}
		: { model: { token: route.token, lookup: Lookup.NotFound(), acceptance: Acceptance.Idle() } }

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchPreview: ({ preview }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Loaded({ preview }) }),
		}),
		FailedFetchPreview: ({ reason }) => ({
			model: modifyFields(model, {
				lookup: () => (reason === "NotFound" ? Lookup.NotFound() : Lookup.Failed({ reason })),
			}),
		}),
		ClickedRetryPreview: () =>
			model.lookup._tag !== "Failed"
				? { model }
				: {
						model: modifyFields(model, { lookup: () => Lookup.Loading() }),
						commands: [FetchPreview({ token: model.token })],
					},
		ClickedSignIn: () => ({ model, commands: [RedirectToInviteSignIn({ token: model.token })] }),
		ClickedAccept: () =>
			model.acceptance._tag === "Accepting"
				? { model }
				: {
						model: modifyFields(model, { acceptance: () => Acceptance.Accepting() }),
						commands: [AcceptInvitation({ token: model.token })],
					},
		ClickedSignOut: () => ({ model, outMessage: PageOutMessage.RequestedSignOut() }),
		LeftPage: () => ({ model }),
		FailedAccept: ({ reason }) => ({
			model: modifyFields(model, { acceptance: () => Acceptance.Failed({ reason }) }),
		}),
	})
