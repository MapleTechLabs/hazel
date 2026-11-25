import { Match } from "effect"
import { modifyFields } from "foldkit/struct"
import { commonMessage } from "~/lib/error-messages"
import { errorToastOf, infoToast, successToast } from "../../data/actions"
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
				toast: successToast(
					model.lookup._tag === "Found"
						? `You joined ${model.lookup.organization.name}`
						: "You joined the workspace",
				),
			}),
		}),
		FailedJoinWorkspace: ({ reason }) => {
			const settled = modifyFields(model, { isJoining: () => false })
			return Match.value(reason).pipe(
				// Nothing to join: they are in already, so take them there instead of a dead button.
				Match.when("AlreadyMember", (): Return => ({
					model: settled,
					outMessage: PageOutMessage.RequestedNavigation({
						route: AppRoute.OrgHome({ orgSlug: model.slug }),
						replace: false,
						toast: infoToast("You're already a member of this workspace"),
					}),
				})),
				// The link stopped working since the page loaded: show the not-found page, not a button that keeps failing.
				Match.whenOr("NotFound", "PublicInvitesDisabled", (): Return => ({
					model: modifyFields(settled, { lookup: () => Lookup.NotFound() }),
				})),
				Match.orElse((common): Return => ({
					model: settled,
					outMessage: PageOutMessage.RequestedToast({ toast: errorToastOf(commonMessage(common)) }),
				})),
			)
		},
		CompletedRedirectToSignIn: () => ({ model }),
		CompletedEnterAnimation: () => ({ model }),
	})
