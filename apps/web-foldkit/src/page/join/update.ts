import { modifyFields } from "foldkit/struct"
import type { RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { FetchOrganization, JoinWorkspace, NavigateToWorkspace, RedirectToSignIn } from "./command"
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
		ClickedSignIn: () => ({ model, commands: [RedirectToSignIn({ returnTo: `/join/${model.slug}` })] }),
		ClickedJoin: () => ({
			model: modifyFields(model, { isJoining: () => true }),
			commands: [JoinWorkspace({ slug: model.slug })],
		}),
		SucceededJoinWorkspace: () => ({
			model: modifyFields(model, { isJoining: () => false }),
			commands: [NavigateToWorkspace({ slug: model.slug })],
			outMessage: PageOutMessage.RequestedToast({
				toast: { intent: "success", title: "Successfully joined workspace!", description: null },
			}),
		}),
		FailedJoinWorkspace: ({ title, description }) => ({
			model: modifyFields(model, { isJoining: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } }),
		}),
		CompletedRedirectToSignIn: () => ({ model }),
		CompletedNavigateToWorkspace: () => ({ model }),
		CompletedEnterAnimation: () => ({ model }),
	})
