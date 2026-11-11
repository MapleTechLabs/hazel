import { OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Option, Schema, Stream } from "effect"
import { Command, Submodel, Subscription } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { forgetReturnTo, readReturnTo } from "../../auth/return-to"
import { liveQueryStream } from "../../data/live-query"
import { rootRedirect } from "../../redirect"
import { type AppRoute, routeOfPath } from "../../route"
import type { CurrentUser } from "../../session"
import { appLoader } from "../../shell/layouts"
import {
	definePage,
	type PageReturn,
	type PageSubscriptionInput,
	type PageViewInputs,
	type Shared,
} from "../contract"
import { PageOutMessage } from "../out-message"
import { Message, Model } from "./model"

/** `_app/index.tsx`: a loader that forwards to the user's org, onboarding or org selection. */

type Return = PageReturn<Model, Message>

/** The page sign-in started from; it stays remembered until the redirect goes there. */
export const ReadReturnTo = Command.define("ReadReturnTo", {
	messages: [Message.ReadReturnTo],
	execute: readReturnTo.pipe(Effect.map((returnTo) => Message.ReadReturnTo({ returnTo }))),
})

export const ForgetReturnTo = Command.define("ForgetReturnTo", {
	messages: [Message.CompletedForgetReturnTo],
	execute: forgetReturnTo.pipe(Effect.as(Message.CompletedForgetReturnTo())),
})

/**
 * Where to go: back to where sign-in started, unless onboarding comes first; else `rootRedirect`.
 * Before onboarding the remembered page is kept, so `/` after onboarding still goes back to it.
 */
const targetOf = (
	model: Model,
	user: CurrentUser,
): { readonly route: AppRoute; readonly isReturn: boolean } =>
	model.returnTo && user.isOnboarded
		? { route: routeOfPath(model.returnTo), isReturn: true }
		: { route: rootRedirect(user, Option.fromNullishOr(model.membership)), isReturn: false }

export const Reload = Command.define("Reload", {
	messages: [Message.CompletedReload],
	execute: Effect.sync(() => window.location.reload()).pipe(Effect.as(Message.CompletedReload())),
})

/** The membership matters only without a page to return to, or before onboarding. */
const needsMembership = (model: Model, user: CurrentUser): boolean => !(model.returnTo && user.isOnboarded)

/** Redirects once the user and the remembered page are known, and the membership if it decides. */
const redirectWhenReady = (model: Model, shared: Shared): Return => {
	if (
		model.hasRedirected ||
		model.returnTo === undefined ||
		shared.currentUser === null ||
		(model.membership === undefined && needsMembership(model, shared.currentUser))
	)
		return { model }
	const target = targetOf(model, shared.currentUser)
	return {
		model: modifyFields(model, { hasRedirected: () => true }),
		commands: target.isReturn ? [ForgetReturnTo()] : [],
		outMessage: PageOutMessage.RequestedNavigation({ route: target.route, replace: true }),
	}
}

interface MembershipRow {
	readonly org: { readonly id: OrganizationId; readonly slug?: string | null }
}

const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	membership: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<MembershipRow, Message>(
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.innerJoin({ org: organizationCollection }, ({ member, org }) =>
										eq(member.organizationId, org.id),
									)
									.where(({ member }) => eq(member.userId, userId))
									.findOne(),
							(rows) => {
								const row = rows[0]
								return Message.UpdatedMembership({
									membership: row
										? { organizationId: row.org.id, slug: row.org.slug ?? null }
										: null,
								})
							},
							{ onStalled: () => Message.StalledMembership() },
						),
		},
	),
}))

export const init = (): Return => ({
	model: { membership: undefined, returnTo: undefined, hasRedirected: false, isStalled: false },
	commands: [ReadReturnTo()],
})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedMembership: ({ membership }) =>
			redirectWhenReady(
				modifyFields(model, { membership: () => membership, isStalled: () => false }),
				shared,
			),
		StalledMembership: () => ({ model: modifyFields(model, { isStalled: () => true }) }),
		PressedReload: () => ({ model, commands: [Reload()] }),
		CompletedReload: () => ({ model }),
		ReadReturnTo: ({ returnTo }) =>
			redirectWhenReady(modifyFields(model, { returnTo: () => returnTo }), shared),
		CompletedForgetReturnTo: () => ({ model }),
	})

export const page = definePage(
	"Root",
	{ Model, Message },
	{
		routes: ["Root"],
		init,
		update,
		view: Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
			appLoader(h, model.isStalled ? Message.PressedReload() : undefined),
		),
		subscriptions,
		sharedChanged: redirectWhenReady,
	},
)
