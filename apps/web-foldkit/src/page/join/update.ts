import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, successToast } from "../../data/actions"
import { AppRoute, hrefOf, type RouteOf } from "../../route"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { FetchPublicOrganization, JoinWorkspace, RedirectToSignIn } from "./command"
import { Message } from "./message"
import { Lookup, type Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"Join">): Return => ({
	model: { slug: route.slug, lookup: Lookup.Loading(), isJoining: false },
	commands: [FetchPublicOrganization({ slug: route.slug })],
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchOrganization: ({ organization }) => ({
			model: modifyFields(model, {
				lookup: () => (organization === null ? Lookup.NotFound() : Lookup.Found({ organization })),
			}),
		}),
		FailedFetchOrganization: ({ reason }) => ({
			model: modifyFields(model, { lookup: () => Lookup.Failed({ reason }) }),
		}),
		ClickedRetryLookup: () =>
			model.lookup._tag !== "Failed"
				? { model }
				: {
						model: modifyFields(model, { lookup: () => Lookup.Loading() }),
						commands: [FetchPublicOrganization({ slug: model.slug })],
					},
		ClickedSignIn: () => ({
			model,
			commands: [RedirectToSignIn({ returnTo: hrefOf(AppRoute.Join({ slug: model.slug })) })],
		}),
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
				route: AppRoute.OrgHome({ orgSlug: model.slug }),
				replace: false,
				toast: successToast("Successfully joined workspace!"),
			}),
		}),
		FailedJoinWorkspace: ({ reason }) => ({
			model: modifyFields(model, { isJoining: () => false }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Organization not found",
							description: "This organization may have been deleted.",
						},
						PublicInvitesDisabled: {
							title: "Public invites disabled",
							description: "This organization has disabled public invites.",
						},
						AlreadyMember: {
							title: "Already a member",
							description: "You're already a member of this workspace.",
						},
					}),
				),
			}),
		}),
		CompletedRedirectToSignIn: () => ({ model }),
		CompletedEnterAnimation: () => ({ model }),
	})
