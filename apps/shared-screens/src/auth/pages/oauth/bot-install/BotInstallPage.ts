// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/oauth/bot-install` (`web-foldkit/src/page/bot-install`, now deleted): a bot's install link,
 * where an owner or admin picks one of their workspaces and approves. Approving hands the grant to
 * the bot's redirect; cancelling tells it the install was declined.
 */
import { Command, Component, Query, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { installRedirectUrl } from "@hazel/domain/bot-install"
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Cause, Effect, Layer, Match, Option, Schema } from "effect"
import { liveQuery } from "../../../../app/live"
import { LoadPage } from "../../../../app/requests"
import { isSessionLoading, Session } from "../../../../app/session"
import { reasonOf } from "../../../../modals/feedback"
import { authFrame, authWaiting, homeLink, messageText } from "../../../components/AuthFrame"
import { CommonReason, failureMessage, type UserErrorMessage } from "../../../domain/AuthFailure"

/** What the consent page shows about the bot asking to be installed. */
export const BotSummary = Schema.Struct({
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	creatorName: Schema.String,
})
export type BotSummary = typeof BotSummary.Type

/** An organization the signed-in user could install into (they administer it). */
export const InstallTarget = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
})
export type InstallTarget = typeof InstallTarget.Type

/** The link's own parameters, once they check out. */
export const InstallRequest = Schema.Struct({
	botId: BotId,
	redirectUri: Schema.String,
	state: Schema.String,
})
export type InstallRequest = typeof InstallRequest.Type

/** `Invalid`: an unknown bot, or a redirect it never registered. It never sends the browser anywhere. */
export const LookupFailure = Schema.Union([Schema.Literal("Invalid"), CommonReason])
export type LookupFailure = typeof LookupFailure.Type

export const ApproveFailure = Schema.Union([
	Schema.Literals(["NotAdmin", "Invalid", "RegionConflict"]),
	CommonReason,
])
export type ApproveFailure = typeof ApproveFailure.Type

/** Approving (or cancelling) stays in flight until the browser leaves for the redirect. */
export const Approval = UiSchema.TaggedEnum({
	Idle: {},
	Approving: {},
	Leaving: {},
	Failed: { reason: ApproveFailure },
})
export type Approval = typeof Approval.Type

export const BotInstallMessage = UiSchema.TaggedEnum({
	PressedRetryRequest: {},
	UpdatedTargets: { targets: Schema.Array(InstallTarget) },
	PickedOrganization: { selected: Schema.Array(Schema.String) },
	PressedSignIn: {},
	PressedApprove: {},
	PressedCancel: {},
	/** Installed: `href` is the bot's redirect with the grant. */
	SucceededApprove: { href: Schema.String },
	FailedApprove: { reason: ApproveFailure },
})
export type BotInstallMessage = typeof BotInstallMessage.Type

export const BotInstallProps = Schema.Struct({
	/** `null` when a parameter is missing or malformed (the host parses the route). */
	request: Schema.NullOr(InstallRequest),
	session: Session,
	/** Sign in, then come back to this link. */
	signInHref: Schema.String,
})
export type BotInstallProps = typeof BotInstallProps.Type

export const BotInstallModel = Schema.Struct({
	attempt: Schema.Finite,
	/** `null` until the membership query answers. */
	targets: Schema.NullOr(Schema.Array(InstallTarget)),
	selectedOrganizationId: Schema.NullOr(OrganizationId),
	approval: Approval,
})
export type BotInstallModel = typeof BotInstallModel.Type

export class GetInstallRequest extends Query.Service<GetInstallRequest>()("hazel/bot-install/GetRequest", {
	args: { botId: BotId, redirectUri: Schema.String, attempt: Schema.Finite },
	success: BotSummary,
	error: LookupFailure,
	staleTime: "5 minutes",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ botId, redirectUri }) =>
				rpc("bot.getInstallRequest", { botId, redirectUri }).pipe(
					Effect.map((bot): BotSummary => ({
						id: bot.id,
						name: bot.name,
						description: bot.description,
						avatarUrl: bot.avatarUrl,
						creatorName: bot.creatorName,
					})),
					Effect.catchTags({
						BotNotFoundError: () => Effect.fail("Invalid" as const),
						BotInstallRedirectMismatchError: () => Effect.fail("Invalid" as const),
					}),
					Effect.mapError((error): LookupFailure =>
						error === "Invalid" ? error : reasonOf(error),
					),
				)
		}),
	)
}

/** Installs, then answers with the bot's redirect carrying the grant. */
export class ApproveInstall extends Command.Service<ApproveInstall>()("hazel/bot-install/Approve", {
	args: { request: InstallRequest, organizationId: OrganizationId },
	success: BotInstallMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const failed = (reason: ApproveFailure) =>
				Effect.succeed(BotInstallMessage.FailedApprove({ reason }))
			return ({ request, organizationId }) =>
				rpc("bot.authorizeInstall", {
					botId: request.botId,
					organizationId,
					redirectUri: request.redirectUri,
				}).pipe(
					Effect.map(({ code }) =>
						BotInstallMessage.SucceededApprove({
							href: installRedirectUrl(request.redirectUri, { code, state: request.state }),
						}),
					),
					Effect.catchTags({
						UnauthorizedError: () => failed("NotAdmin"),
						BotNotFoundError: () => failed("Invalid"),
						BotInstallRedirectMismatchError: () => failed("Invalid"),
						BotInstallRegionConflictError: () => failed("RegionConflict"),
						ActiveOrganizationRequiredError: () => failed("Invalid"),
					}),
					// BOUNDARY: the shared reasons (offline, signed out, the server) read as today's copy.
					Effect.catchCause((cause) =>
						Option.match(Cause.findErrorOption(cause), {
							onSome: (error) => failed(reasonOf(error)),
							onNone: () =>
								Effect.logError("bot install failed unexpectedly", cause).pipe(
									Effect.andThen(failed("Unexpected")),
								),
						}),
					),
				)
		}),
	)
}

interface TargetRow {
	readonly member: { readonly role: "owner" | "admin" | "member" }
	readonly org: { readonly id: OrganizationId; readonly name: string; readonly logoUrl?: string | null }
}

/** The organizations the user administers: only an owner or admin can install (`BotPolicy.canInstall`). */
const targetsStream = (userId: UserId) =>
	liveQuery<TargetRow, BotInstallMessage>(
		(data) => (q) =>
			q
				.from({ member: data.collections.organizationMemberCollection })
				.innerJoin({ org: data.collections.organizationCollection }, ({ member, org }) =>
					eq(member.organizationId, org.id),
				)
				.where(({ member }) => eq(member.userId, userId))
				.orderBy(({ member }) => member.joinedAt, "asc")
				.select(({ member, org }) => ({ member, org })),
		(rows) =>
			BotInstallMessage.UpdatedTargets({
				targets: rows
					.filter(({ member }) => member.role === "owner" || member.role === "admin")
					.map(({ org }) => ({ id: org.id, name: org.name, logoUrl: org.logoUrl ?? null })),
			}),
	)

const approveFailureMessage = (reason: ApproveFailure): UserErrorMessage =>
	failureMessage(reason, {
		NotAdmin: { title: "Only an owner or admin can install apps in this workspace" },
		Invalid: { title: "This install link is no longer valid", description: "Start again from the app." },
		RegionConflict: {
			title: "This app is already installed in this workspace from another region",
			description: "Remove it in Settings → Integrations first, then install it again.",
		},
	})

const BotInstallDef = Hazel.component({
	name: "BotInstallPage",
	props: BotInstallProps,
	model: BotInstallModel,
	message: BotInstallMessage,
	queries: {
		bot: {
			query: GetInstallRequest,
			args: ({ props, model }) =>
				props.request === null
					? undefined
					: {
							botId: props.request.botId,
							redirectUri: props.request.redirectUri,
							attempt: model.attempt,
						},
		},
	},
	// After Back, an answer that was in flight is not running any more.
	restore: (model) => (model.approval._tag === "Failed" ? model : { ...model, approval: Approval.Idle() }),
})

type H = Parameters<Parameters<typeof BotInstallDef.make>[0]["view"]>[0]

const isBusy = (approval: Approval) => approval._tag === "Approving" || approval._tag === "Leaving"

const signInButton = (h: H, model: BotInstallModel) =>
	h.button
		.label("Sign in to continue")
		.disabled(model.approval._tag === "Leaving")
		.on("press", BotInstallMessage.PressedSignIn())

const targets = (h: H, model: BotInstallModel) => {
	if (model.targets === null) return h.progress.style("spinner").label("Loading workspaces...")
	if (model.targets.length === 0)
		// HAZEL-GAP(p4-text-alert): today's line is `role=alert`.
		return h.text
			.role("label")
			.tone("muted")
			.children("You need to be an owner or admin of a workspace to install apps.")
	// HAZEL-GAP(p4-choice-avatar): today's rows lead with the workspace's avatar (its dither when it
	// has no logo) at 32pt; an option's `image` is the logo only.
	return h.choiceGroup
		.key("targets")
		.label("Install in")
		.style("cards")
		.options(
			model.targets.map((target) =>
				target.logoUrl === null
					? { value: target.id, label: target.name }
					: { value: target.id, label: target.name, image: target.logoUrl },
			),
		)
		.selected(model.selectedOrganizationId === null ? [] : [model.selectedOrganizationId])
		.disabled(isBusy(model.approval))
		.on("change", ({ selected }) => BotInstallMessage.PickedOrganization({ selected }))
}

const actions = (h: H, model: BotInstallModel) => {
	if (h.props.session.user === null) return signInButton(h, model)
	const isApproving = model.approval._tag === "Approving"
	return h.stack.density("compact").children(
		h.button
			.label(isApproving ? "Installing..." : "Install")
			.loading(isApproving)
			.disabled(isBusy(model.approval) || model.selectedOrganizationId === null)
			.on("press", BotInstallMessage.PressedApprove()),
		// HAZEL-GAP(p4-button-muted): today's Cancel is the kit's `plain` button (muted ink, no fill).
		h.button
			.label("Cancel")
			.variant("ghost")
			.disabled(isBusy(model.approval))
			.on("press", BotInstallMessage.PressedCancel()),
	)
}

const consent = (h: H, model: BotInstallModel, bot: BotSummary) =>
	authFrame(
		h,
		{
			title: `Install ${bot.name}`,
			subtitle: bot.description ?? `${bot.name} by ${bot.creatorName} wants to join a workspace.`,
		},
		// Today's gaps: 24 under the note, the workspaces and above the buttons.
		h.stack
			.density("relaxed")
			.children(
				h.text
					.role("caption")
					.tone("muted")
					.children(
						`${bot.name} will join the workspace as a member: it can read and post in its public channels, and in the private channels and threads it is added to. Built by ${bot.creatorName}.`,
					),
				h.props.session.user === null ? null : targets(h, model),
				actions(h, model),
				model.approval._tag === "Failed"
					? messageText(h, approveFailureMessage(model.approval.reason))
					: null,
			),
	).leading(
		h.avatar
			.name(bot.name)
			.src(bot.avatarUrl ?? undefined)
			.size("xlarge"),
	)

const invalid = (h: H) =>
	authFrame(
		h,
		{
			title: "This install link isn't valid",
			subtitle:
				"It may be incomplete, or the app it names doesn't accept installs from here. Start again from the app.",
		},
		homeLink(h),
	)

const failed = (h: H, model: BotInstallModel, reason: CommonReason) =>
	// Looking the app up needs a session: a signed-out visitor signs in and comes back.
	reason === "SignedOut" && h.props.session.user === null
		? authFrame(
				h,
				{ title: "Sign in to install this app", subtitle: "You'll come back here afterwards." },
				signInButton(h, model),
			)
		: authFrame(
				h,
				{ title: "Couldn't load this app", subtitle: failureMessage(reason, {}).title },
				h.button
					.label("Try again")
					.variant("outline")
					.on("press", BotInstallMessage.PressedRetryRequest()),
			)

/** Keep the pick while it is still a target; otherwise the first one. */
const selectionAfter = (
	selected: OrganizationId | null,
	targets: ReadonlyArray<InstallTarget>,
): OrganizationId | null =>
	selected !== null && targets.some((target) => target.id === selected)
		? selected
		: (targets[0]?.id ?? null)

export const BotInstallPageNoDeps = BotInstallDef.make({
	init: () => ({ attempt: 0, targets: null, selectedOrganizationId: null, approval: Approval.Idle() }),
	update: {
		PressedRetryRequest: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		UpdatedTargets: ($, { targets }) =>
			$.evolve({
				targets: () => targets,
				selectedOrganizationId: (selected) => selectionAfter(selected, targets),
			}),
		PickedOrganization: ($, { selected }) => {
			const picked = $.model.targets?.find((target) => selected.includes(target.id))
			return isBusy($.model.approval) || picked === undefined
				? $.model
				: $.evolve({ selectedOrganizationId: () => picked.id, approval: () => Approval.Idle() })
		},
		PressedSignIn: ($) =>
			$.set({ ...$.model, approval: Approval.Leaving() }).run(
				LoadPage.make({ href: $.props.signInHref }),
			),
		PressedApprove: ($) => {
			const { request } = $.props
			const organizationId = $.model.selectedOrganizationId
			return isBusy($.model.approval) || request === null || organizationId === null
				? $.model
				: $.set({ ...$.model, approval: Approval.Approving() }).run(
						ApproveInstall.make({ request, organizationId }),
					)
		},
		// Only once the request checked out: an unverified redirect is never followed.
		PressedCancel: ($) => {
			const { request } = $.props
			return isBusy($.model.approval) || request === null || $.queries.bot._tag !== "Success"
				? $.model
				: $.set({ ...$.model, approval: Approval.Leaving() }).run(
						LoadPage.make({
							href: installRedirectUrl(request.redirectUri, {
								error: "access_denied",
								state: request.state,
							}),
						}),
					)
		},
		SucceededApprove: ($, { href }) =>
			$.set({ ...$.model, approval: Approval.Leaving() }).run(LoadPage.make({ href })),
		FailedApprove: ($, { reason }) => $.evolve({ approval: () => Approval.Failed({ reason }) }),
	},
	subscriptions: ({ props }) => {
		const user = props.session.user
		return [user === null ? null : Subscription.make("targets", [user.id], ([id]) => targetsStream(id))]
	},
	view: (h, model) => {
		if (isSessionLoading(h.props.session)) return authWaiting(h, "Loading app...")
		if (h.props.request === null) return invalid(h)
		return Match.value(h.queries.bot).pipe(
			Match.tag("Initial", () => authWaiting(h, "Loading app...")),
			Match.tag("Failure", ({ cause }) => {
				const reason = Option.getOrElse(
					Cause.findErrorOption(cause),
					(): LookupFailure => "Unexpected",
				)
				return reason === "Invalid" ? invalid(h) : failed(h, model, reason)
			}),
			Match.tag("Success", ({ value }) => consent(h, model, value)),
			Match.exhaustive,
		)
	},
})

/** The page with its lookup and install, on the host's `HazelRpc`; the host provides `ClientData`. */
export const BotInstallPage = BotInstallPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(GetInstallRequest.layer, ApproveInstall.layer)),
)
