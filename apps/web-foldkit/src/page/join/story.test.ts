import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToastOf, infoToast } from "../../data/actions"
import { commonMessage } from "~/lib/error-messages"
import { AppRoute, routeOfPath } from "../../route"
import { PageOutMessage } from "../out-message"
import { FetchPublicOrganization, JoinWorkspace, RedirectToSignIn } from "./command"
import { Message } from "./message"
import { Lookup, type Model } from "./model"
import { init, update } from "./update"

/** `/join/$slug`: the public lookup, the sign-in detour and joining. */

const route = AppRoute.Join.make({ slug: "hazel" })
const organization = { name: "Hazel Labs", logoUrl: null, memberCount: 3 }
const loaded: Model = { slug: "hazel", lookup: Lookup.Found({ organization }), isJoining: false }

describe("join workspace", () => {
	test("looks the slug up on load; a missing workspace reads as not found", () => {
		const started = init(route)
		expect(started.commands?.map((command) => command.name)).toEqual([FetchPublicOrganization.name])
		story(
			update,
			given(started.model),
			message(Message.SucceededFetchOrganization({ organization: null })),
			model((current) => expect(current.lookup).toEqual(Lookup.NotFound())),
		)
	})

	test("a failed lookup is recorded apart from a missing workspace, and can be retried", () => {
		story(
			update,
			given(init(route).model),
			message(Message.FailedFetchOrganization({ reason: "Offline" })),
			model((current) => expect(current.lookup).toEqual(Lookup.Failed({ reason: "Offline" }))),
			message(Message.ClickedRetryLookup()),
			Command.expectExact(FetchPublicOrganization({ slug: "hazel" })),
			model((current) => expect(current.lookup).toEqual(Lookup.Loading())),
			Command.resolve(FetchPublicOrganization, Message.SucceededFetchOrganization({ organization })),
			model((current) => expect(current.lookup).toEqual(Lookup.Found({ organization }))),
		)
	})

	test("signing in comes back to this invite link", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedSignIn()),
			Command.expectExact(RedirectToSignIn({ returnTo: "/join/hazel" })),
			Command.resolve(RedirectToSignIn, Message.CompletedRedirectToSignIn()),
			expectNoOutMessage(),
		)
	})

	test("joining opens the workspace through the root, with the success toast", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedJoin()),
			Command.expectExact(JoinWorkspace({ slug: "hazel" })),
			model((current) => expect(current.isJoining).toBe(true)),
			Command.resolve(JoinWorkspace, Message.SucceededJoinWorkspace()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel"),
					replace: false,
					toast: { intent: "success", title: "You joined Hazel Labs", description: null },
				}),
			),
			Command.expectNone(),
			model((current) => expect(current.isJoining).toBe(false)),
		)
	})

	test("joining a workspace they are already in takes them there", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedJoin()),
			Command.resolve(JoinWorkspace, Message.FailedJoinWorkspace({ reason: "AlreadyMember" })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel"),
					replace: false,
					toast: infoToast("You're already a member of this workspace"),
				}),
			),
			model((current) => expect(current.isJoining).toBe(false)),
		)
	})

	test("a link that stopped working shows the not-found page instead of the join button", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedJoin()),
			Command.resolve(JoinWorkspace, Message.FailedJoinWorkspace({ reason: "PublicInvitesDisabled" })),
			expectNoOutMessage(),
			model((current) => {
				expect(current.lookup).toEqual(Lookup.NotFound())
				expect(current.isJoining).toBe(false)
			}),
		)
	})

	test("a failed join says why and unlocks the button", () => {
		const failure = errorToastOf(commonMessage("Offline"))
		story(
			update,
			given(loaded),
			message(Message.ClickedJoin()),
			Command.resolve(JoinWorkspace, Message.FailedJoinWorkspace({ reason: "Offline" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failure })),
			model((current) => expect(current.isJoining).toBe(false)),
		)
	})

	// ClickedJoin is guarded on isJoining, so a second press sends no second join request.
	test("a press while joining sends nothing", () => {
		story(
			update,
			given({ ...loaded, isJoining: true }),
			message(Message.ClickedJoin()),
			Command.expectNone(),
		)
	})
})
