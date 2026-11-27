// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/` (`web-foldkit/src/page/root`, now deleted): a loader that forwards to where sign-in started,
 * onboarding, the organization last opened on this device, any of the user's, or the picker. The
 * page decides when it knows enough; the host knows the routes (`RedirectFromRoot`).
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { OrganizationId, type UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Effect, Queue, Schema, Stream } from "effect"
import { withData } from "../../app/live"
import { LoadPage } from "../../app/requests"
import { Session } from "../../app/session"

export const RootMembership = Schema.Struct({
	organizationId: OrganizationId,
	slug: Schema.NullOr(Schema.String),
})
export type RootMembership = typeof RootMembership.Type

export const RootMessage = UiSchema.TaggedEnum({
	/** The page sign-in started from, and the organization last opened here; null when none. */
	ReadRemembered: {
		returnTo: Schema.NullOr(Schema.String),
		lastOrganizationId: Schema.NullOr(OrganizationId),
	},
	UpdatedMemberships: { memberships: Schema.Array(RootMembership) },
	SettledOrgSources: {},
	StalledMemberships: {},
	/** The user is known (`user.me` may answer after the page mounts). */
	ReadyUser: {},
	PressedReload: {},
})
export type RootMessage = typeof RootMessage.Type

export const RootProps = Schema.Struct({
	session: Session,
	/** A phone lands on the chat list, a wide screen on the organization's home. */
	isMobile: Schema.Boolean,
})
export type RootProps = typeof RootProps.Type

export const RootModel = Schema.Struct({
	/** Null until read (`ReadRemembered`). */
	remembered: Schema.NullOr(
		Schema.Struct({
			returnTo: Schema.NullOr(Schema.String),
			lastOrganizationId: Schema.NullOr(OrganizationId),
		}),
	),
	/** Null until the membership query is ready; empty when the user has none. */
	memberships: Schema.NullOr(Schema.Array(RootMembership)),
	/** Every org source has answered: `memberships` is complete, not just the orgs synced so far. */
	areOrgsSettled: Schema.Boolean,
	hasRedirected: Schema.Boolean,
	/** The membership query has not loaded after a while: the loader offers a reload. */
	isStalled: Schema.Boolean,
})
export type RootModel = typeof RootModel.Type

/** What the host remembers on this device: where sign-in started, and the last organization opened. */
export class ReadRootRemembered extends Command.Service<ReadRootRemembered>()("hazel/root/ReadRemembered", {
	args: {},
	success: RootMessage,
}) {
	static readonly layerWith = (
		read: Effect.Effect<{
			readonly returnTo: string | null
			readonly lastOrganizationId: OrganizationId | null
		}>,
	) =>
		this.toLayer(
			Effect.succeed(() => Effect.map(read, (remembered) => RootMessage.ReadRemembered(remembered))),
		)
}

/**
 * Leaves `/` for good (a replace): back to `returnTo` once onboarded (the host then forgets it), else
 * onboarding, the membership's organization, or the picker when there is none.
 */
export class RedirectFromRoot extends Command.Service<RedirectFromRoot>()("hazel/root/Redirect", {
	args: {
		returnTo: Schema.NullOr(Schema.String),
		isOnboarded: Schema.Boolean,
		membership: Schema.NullOr(RootMembership),
		isMobile: Schema.Boolean,
	},
	success: Component.Noop,
}) {}

const lastMembershipOf = (model: RootModel) =>
	model.memberships?.find(({ organizationId }) => organizationId === model.remembered?.lastOrganizationId)

/** The last opened organization when the user is still in it, else any of theirs. */
const membershipOf = (model: RootModel) => lastMembershipOf(model) ?? model.memberships?.[0] ?? null

/**
 * Memberships arrive as each org source syncs: one missing the last opened organization only
 * means the user left it once every source has answered.
 */
const isMembershipKnown = (model: RootModel) =>
	model.memberships !== null &&
	model.remembered !== null &&
	(model.remembered.lastOrganizationId === null ||
		model.areOrgsSettled ||
		lastMembershipOf(model) !== undefined)

/** The redirect, once the user and the remembered page are known, and the membership if it decides. */
export const redirectOf = (model: RootModel, props: RootProps) => {
	const user = props.session.user
	if (model.hasRedirected || model.remembered === null || user === null) return null
	const returnTo = model.remembered.returnTo
	// The membership matters only without a page to return to, or before onboarding.
	const needsMembership = !(returnTo !== null && user.isOnboarded)
	if (needsMembership && !isMembershipKnown(model)) return null
	return RedirectFromRoot.make({
		returnTo,
		isOnboarded: user.isOnboarded,
		membership: membershipOf(model),
		isMobile: props.isMobile,
	})
}

interface MembershipRow {
	readonly org: { readonly id: OrganizationId; readonly slug?: string | null }
}

const membershipsStream = (userId: UserId) =>
	withData((data) =>
		data.liveQueryStream<MembershipRow, RootMessage>(
			(q) =>
				q
					.from({ member: data.collections.organizationMemberCollection })
					.innerJoin({ org: data.collections.organizationCollection }, ({ member, org }) =>
						eq(member.organizationId, org.id),
					)
					.where(({ member }) => eq(member.userId, userId)),
			(rows) =>
				RootMessage.UpdatedMemberships({
					memberships: rows.map(({ org }) => ({ organizationId: org.id, slug: org.slug ?? null })),
				}),
			{ onStalled: () => RootMessage.StalledMemberships() },
		),
	)

/** One message once every org source has answered (`orgSourcesSettled`). */
const settledStream = withData((data) =>
	Stream.callback<RootMessage>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const check = () => {
					if (data.orgSourcesSettled.isSettled())
						Queue.offerUnsafe(queue, RootMessage.SettledOrgSources())
				}
				check()
				return data.orgSourcesSettled.subscribe(check)
			}),
			(unsubscribe) => Effect.sync(unsubscribe),
		).pipe(Effect.flatMap(() => Effect.never)),
	).pipe(Stream.take(1)),
)

const RootDef = Hazel.component({
	name: "RootPage",
	props: RootProps,
	model: RootModel,
	message: RootMessage,
})

/** Runs the redirect when the new model knows enough. */
const settle = ($: { readonly props: RootProps }, model: RootModel) => {
	const redirect = redirectOf(model, $.props)
	return redirect === null
		? { model, commands: [] }
		: { model: { ...model, hasRedirected: true }, commands: [redirect] }
}

export const RootPage = RootDef.make({
	init: ($) =>
		$.set({
			remembered: null,
			memberships: null,
			areOrgsSettled: false,
			hasRedirected: false,
			isStalled: false,
		}).run(ReadRootRemembered.make({})),
	update: {
		ReadRemembered: ($, remembered) => {
			const next = settle($, { ...$.model, remembered })
			return $.set(next.model).run(...next.commands)
		},
		UpdatedMemberships: ($, { memberships }) => {
			const next = settle($, { ...$.model, memberships, isStalled: false })
			return $.set(next.model).run(...next.commands)
		},
		SettledOrgSources: ($) => {
			const next = settle($, { ...$.model, areOrgsSettled: true })
			return $.set(next.model).run(...next.commands)
		},
		ReadyUser: ($) => {
			const next = settle($, $.model)
			return next.commands.length === 0 ? $.model : $.set(next.model).run(...next.commands)
		},
		StalledMemberships: ($) => $.evolve({ isStalled: () => true }),
		PressedReload: ($) => $.run(LoadPage.make({ href: "/" })),
	},
	subscriptions: ({ props }) => {
		const userId = props.session.user?.id ?? null
		return userId === null
			? []
			: [
					Subscription.make("memberships", [userId], ([id]) => membershipsStream(id)),
					Subscription.make("orgSourcesSettled", [userId], () => settledStream),
					// The user may arrive after the rest (`user.me`): a chance to go.
					Subscription.make("user", [userId], () => Stream.make(RootMessage.ReadyUser())),
				]
	},
	view: (h, model) =>
		// HAZEL-GAP(p4-app-loader): today's loader is the squirrel picture over an indeterminate bar;
		// the vocabulary's nearest is a centred spinner.
		h.screen
			.key("root")
			.surface("centered")
			.children(
				h.progress.style("spinner").label("Loading"),
				model.isStalled
					? h.button.label("Reload").variant("outline").on("press", RootMessage.PressedReload())
					: null,
			),
})
