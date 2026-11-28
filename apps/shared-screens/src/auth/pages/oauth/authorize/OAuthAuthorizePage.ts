// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/oauth/authorize` (`web-foldkit/src/page/oauth-authorize`, now deleted): an agent (an MCP
 * client) asks to act for the signed-in user. What it may do, where it sends them back, then
 * allow or deny; either answer leaves for the client's redirect.
 */
import { Command, Query, UiSchema } from "@effect/ui"
import { AgentScope } from "@hazel/domain/http"
import { AgentClientId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Match, Option, Schema } from "effect"
import { Leave } from "../../../../app/requests"
import { isSessionLoading, Session } from "../../../../app/session"
import { authFrame, authWaiting, homeLink, messageText } from "../../../components/AuthFrame"
import { CommonReason, failureMessage, type UserErrorMessage } from "../../../domain/AuthFailure"

/** What the consent page shows about the client asking for access. */
export const ClientSummary = Schema.Struct({
	id: AgentClientId,
	name: Schema.String,
	clientUri: Schema.NullOr(Schema.String),
	logoUri: Schema.NullOr(Schema.String),
	redirectHost: Schema.String,
})
export type ClientSummary = typeof ClientSummary.Type

/** The link's OAuth parameters, once they check out (authorization code with S256 PKCE). */
export const AgentRequest = Schema.Struct({
	clientId: AgentClientId,
	redirectUri: Schema.String,
	codeChallenge: Schema.String,
	codeChallengeMethod: Schema.String,
	scope: Schema.NullOr(Schema.String),
	state: Schema.NullOr(Schema.String),
	scopes: Schema.Array(AgentScope),
})
export type AgentRequest = typeof AgentRequest.Type

/**
 * `Invalid` is a link that cannot be honoured: an unknown client, or a redirect it never
 * registered. It never sends the browser anywhere.
 */
export const LookupFailure = Schema.Union([Schema.Literal("Invalid"), CommonReason])
export type LookupFailure = typeof LookupFailure.Type

/** `Invalid`: the link stopped checking out between the lookup and the answer. */
export const ApproveFailure = Schema.Union([Schema.Literal("Invalid"), CommonReason])
export type ApproveFailure = typeof ApproveFailure.Type

/** Approving (or denying) stays in flight until the browser leaves for the client's redirect. */
export const Approval = UiSchema.TaggedEnum({
	Idle: {},
	Approving: {},
	Denying: {},
	Leaving: {},
	Failed: { reason: ApproveFailure },
})
export type Approval = typeof Approval.Type

export const OAuthAuthorizeMessage = UiSchema.TaggedEnum({
	PressedRetryRequest: {},
	PressedSignIn: {},
	PressedApprove: {},
	PressedDeny: {},
	/** The backend's answer: the client's redirect, with the code or the refusal. */
	SucceededAuthorize: { redirectTo: Schema.String },
	FailedAuthorize: { reason: ApproveFailure },
})
export type OAuthAuthorizeMessage = typeof OAuthAuthorizeMessage.Type

export const OAuthAuthorizeProps = Schema.Struct({
	/** `null` when a parameter is missing or malformed (the host parses the route). */
	request: Schema.NullOr(AgentRequest),
	session: Session,
	/** Sign in, then come back to this link. */
	signInHref: Schema.String,
})
export type OAuthAuthorizeProps = typeof OAuthAuthorizeProps.Type

export const OAuthAuthorizeModel = Schema.Struct({
	attempt: Schema.Finite,
	approval: Approval,
})
export type OAuthAuthorizeModel = typeof OAuthAuthorizeModel.Type

/** `agentAccess.getAgentClient` (the HTTP API, which the host implements). */
export class GetAgentClient extends Query.Service<GetAgentClient>()("hazel/oauth/GetAgentClient", {
	args: { clientId: AgentClientId, redirectUri: Schema.String, attempt: Schema.Finite },
	success: ClientSummary,
	error: LookupFailure,
	staleTime: "5 minutes",
}) {}

/** `agentAccess.authorizeAgent`, approving or denying; answers with the redirect to load. */
export class AuthorizeAgent extends Command.Service<AuthorizeAgent>()("hazel/oauth/AuthorizeAgent", {
	args: { request: AgentRequest, approve: Schema.Boolean },
	success: OAuthAuthorizeMessage,
}) {}

/** What each scope lets the agent do, in the user's words. */
const SCOPE_ABILITIES = {
	"messages:read": ["Read your channels, direct messages and threads", "See messages that mention you"],
	"messages:write": [
		"Send messages and replies as you",
		"Share files in your channels",
		"React to messages",
		"Edit and delete your messages",
		"Set your status",
	],
	"customers:read": [
		"See your organizations' customers: revenue, billing and signals",
		"See which channels each customer is linked to",
	],
} satisfies Readonly<Record<AgentScope, ReadonlyArray<string>>>

const approveFailureMessage = (reason: ApproveFailure): UserErrorMessage =>
	failureMessage(reason, {
		Invalid: { title: "This link is no longer valid", description: "Start again from your agent." },
	})

const OAuthAuthorizeDef = Hazel.component({
	name: "OAuthAuthorizePage",
	props: OAuthAuthorizeProps,
	model: OAuthAuthorizeModel,
	message: OAuthAuthorizeMessage,
	queries: {
		client: {
			query: GetAgentClient,
			args: ({ props, model }) =>
				props.request === null
					? undefined
					: {
							clientId: props.request.clientId,
							redirectUri: props.request.redirectUri,
							attempt: model.attempt,
						},
		},
	},
	// After Back, an answer that was in flight is not running any more.
	restore: (model) => (model.approval._tag === "Failed" ? model : { ...model, approval: Approval.Idle() }),
})

type H = Parameters<Parameters<typeof OAuthAuthorizeDef.make>[0]["view"]>[0]

const isBusy = (approval: Approval) =>
	approval._tag === "Approving" || approval._tag === "Denying" || approval._tag === "Leaving"

const signInButton = (h: H, model: OAuthAuthorizeModel) =>
	h.button
		.label("Sign in to continue")
		.disabled(model.approval._tag === "Leaving")
		.on("press", OAuthAuthorizeMessage.PressedSignIn())

const actions = (h: H, model: OAuthAuthorizeModel) => {
	if (h.props.session.user === null) return signInButton(h, model)
	const isApproving = model.approval._tag === "Approving"
	return h.stack.density("compact").children(
		h.button
			.label(isApproving ? "Allowing..." : "Allow")
			.loading(isApproving)
			.disabled(isBusy(model.approval))
			.on("press", OAuthAuthorizeMessage.PressedApprove()),
		// HAZEL-GAP(p4-button-muted): today's Deny is the kit's `plain` button (muted ink, no fill).
		h.button
			.label("Deny")
			.variant("ghost")
			.disabled(isBusy(model.approval))
			.on("press", OAuthAuthorizeMessage.PressedDeny()),
	)
}

/**
 * The scopes' abilities as check rows in a card (today's `ul` in `cardClassName`).
 * HAZEL-GAP(p4-frame-snug): today's card is padded 12px; `frame` `card` pads 16px.
 */
const abilities = (h: H, scopes: ReadonlyArray<AgentScope>) =>
	h.frame.children(
		h.stack.density("compact").children(
			...scopes
				.flatMap((scope) => SCOPE_ABILITIES[scope])
				.map((ability) =>
					// HAZEL-GAP(p4-check-row): today's glyph is muted and top-aligned beside a wrapping line.
					h.stack
						.key(ability)
						.axis("horizontal")
						.density("compact")
						.align("start")
						.children(h.icon.name("check"), h.text.role("label").children(ability)),
				),
		),
	)

const consent = (h: H, model: OAuthAuthorizeModel, client: ClientSummary) =>
	authFrame(
		h,
		{
			title: `Connect ${client.name}`,
			subtitle: `${client.name} wants to act for you in Hazel. It will be able to:`,
		},
		// Today's gaps: 16 under the card, 8 between the notes, 24 above the buttons.
		h.stack.density("relaxed").children(
			h.stack.density("regular").children(
				abilities(h, h.props.request?.scopes ?? []),
				h.stack.density("compact").children(
					h.text
						.role("caption")
						.tone("muted")
						.children(
							`Messages it sends are shown as written by an agent ("via ${client.name}") to people in your organization.`,
						),
					// HAZEL-GAP(p4-inline-text): today's host is a strong fg run inside the muted sentence.
					h.text
						.role("caption")
						.tone("muted")
						.children(
							`You'll return to ${client.redirectHost}. You can disconnect it any time in My Settings → Agents.`,
						),
				),
			),
			actions(h, model),
			model.approval._tag === "Failed"
				? messageText(h, approveFailureMessage(model.approval.reason))
				: null,
		),
	).leading(
		h.avatar
			.name(client.name)
			.src(client.logoUri ?? undefined)
			.size("xlarge"),
	)

const invalid = (h: H) =>
	authFrame(
		h,
		{
			title: "This link is invalid",
			subtitle:
				"It may be incomplete, or the agent that sent you here isn't registered with Hazel. Start again from your agent.",
		},
		homeLink(h),
	)

const failed = (h: H, model: OAuthAuthorizeModel, reason: CommonReason) =>
	// Looking the client up needs a session: a signed-out visitor signs in and comes back.
	reason === "SignedOut" && h.props.session.user === null
		? authFrame(
				h,
				{ title: "Sign in to connect your agent", subtitle: "You'll come back here afterwards." },
				signInButton(h, model),
			)
		: authFrame(
				h,
				{ title: "Couldn't load this request", subtitle: failureMessage(reason, {}).title },
				h.button
					.label("Try again")
					.variant("outline")
					.on("press", OAuthAuthorizeMessage.PressedRetryRequest()),
			)

/** The request to answer, once its client checked out and nothing is in flight. */
const authorizable = (model: OAuthAuthorizeModel, props: OAuthAuthorizeProps, client: string) =>
	isBusy(model.approval) || client !== "Success" ? null : props.request

/** The page; the host provides `GetAgentClient` and `AuthorizeAgent` (the HTTP API). */
export const OAuthAuthorizePage = OAuthAuthorizeDef.make({
	init: () => ({ attempt: 0, approval: Approval.Idle() }),
	update: {
		PressedRetryRequest: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		PressedSignIn: ($) =>
			$.set({ ...$.model, approval: Approval.Leaving() }).run(Leave.make({ href: $.props.signInHref })),
		// Only once the client checked out: an unverified redirect is never followed.
		PressedApprove: ($) => {
			const request = authorizable($.model, $.props, $.queries.client._tag)
			return request === null
				? $.model
				: $.set({ ...$.model, approval: Approval.Approving() }).run(
						AuthorizeAgent.make({ request, approve: true }),
					)
		},
		PressedDeny: ($) => {
			const request = authorizable($.model, $.props, $.queries.client._tag)
			return request === null
				? $.model
				: $.set({ ...$.model, approval: Approval.Denying() }).run(
						AuthorizeAgent.make({ request, approve: false }),
					)
		},
		SucceededAuthorize: ($, { redirectTo }) =>
			$.set({ ...$.model, approval: Approval.Leaving() }).run(Leave.make({ href: redirectTo })),
		FailedAuthorize: ($, { reason }) => $.evolve({ approval: () => Approval.Failed({ reason }) }),
	},
	view: (h, model) => {
		if (isSessionLoading(h.props.session)) return authWaiting(h, "Loading request...")
		if (h.props.request === null) return invalid(h)
		return Match.value(h.queries.client).pipe(
			Match.tag("Initial", () => authWaiting(h, "Loading request...")),
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
