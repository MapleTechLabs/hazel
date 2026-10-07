import { OrganizationId, UserId } from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Submodel, Subscription } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { rootRedirect } from "../../redirect"
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

/** Redirects once both the user and their membership are known. */
const redirectWhenReady = (model: Model, shared: Shared): Return =>
	model.hasRedirected || model.membership === undefined || shared.currentUser === null
		? { model }
		: {
				model: modifyFields(model, { hasRedirected: () => true }),
				outMessage: PageOutMessage.RequestedNavigation({
					href: rootRedirect(shared.currentUser, Option.fromNullishOr(model.membership)),
					replace: true,
				}),
			}

interface MembershipRow {
	readonly org: { readonly id: OrganizationId; readonly slug?: string | null }
}

const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	membership: entry(
		{ userId: Schema.NullOr(UserId), organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				userId: shared.currentUser?.id ?? null,
				organizationId: shared.currentUser?.organizationId ?? null,
			}),
			dependenciesToStream: ({ userId, organizationId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<MembershipRow, Message>(
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.innerJoin({ org: organizationCollection }, ({ member, org }) =>
										eq(member.organizationId, org.id),
									)
									// With an org in the JWT, only that membership counts.
									.where(({ member }) =>
										organizationId
											? and(
													eq(member.userId, userId),
													eq(member.organizationId, organizationId),
												)
											: eq(member.userId, userId),
									)
									.findOne(),
							(rows) => {
								const row = rows[0]
								return Message.UpdatedMembership({
									membership: row
										? { organizationId: row.org.id, slug: row.org.slug ?? null }
										: null,
								})
							},
						),
		},
	),
}))

export const page = definePage(
	"Root",
	{ Model, Message },
	{
		routes: ["Root"],
		init: () => ({ model: { membership: undefined, hasRedirected: false } }),
		update: (model, message, shared) =>
			Message.match<Return>(message, {
				UpdatedMembership: ({ membership }) =>
					redirectWhenReady(modifyFields(model, { membership: () => membership }), shared),
			}),
		view: Submodel.defineView<Model, Message, PageViewInputs>((_model, _inputs, h) => appLoader(h)),
		subscriptions,
		sharedChanged: redirectWhenReady,
	},
)
