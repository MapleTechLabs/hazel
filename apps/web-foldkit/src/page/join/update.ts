import { modifyFields } from "foldkit/struct"
import { successToast } from "../../data/actions"
import type { RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { FetchOrganization, JoinWorkspace, RedirectToSignIn } from "./command"
import { Message } from "./message"
import { Lookup, type Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"Join">): Return => ({
	model: { slug: route.slug, lookup: Lookup.Loading(), isJoining: false },
	commands: [FetchOrganization({ slug: route.slug })],
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchOrganization: ({ organization }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Loaded({ organization }) }),
		}),
		FailedFetchOrganization: () => ({ model: modifyFields(model, { lookup: () => Lookup.Failed() }) }),
		ClickedSignIn: () => ({ model, commands: [RedirectToSignIn({ returnTo: `/join/${model.slug}` })] }),
		ClickedJoin: () =>
			model.isJoining
				? { model }
				: {
						model: modifyFields(model, { isJoining: () => true }),
						commands: [JoinWorkspace({ slug: model.slug })],
					},
		SucceededJoinWorkspace: () => ({
			model: modifyFields(model, { isJoining: () => false }),
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.slug}`,
				replace: false,
				toast: successToast("Successfully joined workspace!"),
			}),
		}),
		FailedJoinWorkspace: ({ toast }) => ({
			model: modifyFields(model, { isJoining: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
		CompletedRedirectToSignIn: () => ({ model }),
		CompletedEnterAnimation: () => ({ model }),
	})
