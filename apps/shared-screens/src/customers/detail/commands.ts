// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customer page shell's reads and writes (today's `page/customers/detail/commands.ts`, the
 * shell's half): the detail and suggestions as queries; the account, channel, people and flag
 * writes as Commands over the optimistic actions, each silent unless it fails.
 */
import { Command, Component, Query } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import * as Customers from "@hazel/domain/customers"
import {
	ChannelId,
	CustomerAccountId,
	CustomerChannelSuggestionId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Layer, Option, Predicate, Schema } from "effect"
import { makeChannelData } from "../data/channels"
import { makeChatAuthorData } from "../data/chat-authors"
import { makeCustomerActions } from "../data/actions"
import { fetchSuggestions } from "../data/suggestions"
import { type AccountWrite, CustomerDetailMessage, DetailFailure } from "./model"

const target = { organizationId: OrganizationId, accountId: CustomerAccountId }

const tagOf = (cause: Cause.Cause<unknown>): string => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	return Predicate.hasProperty(error, "_tag") ? String(error._tag) : ""
}

/** The server's own words for a refusal it explains (an invalid request, a group or flag error). */
const messageOf = (cause: Cause.Cause<unknown>): string | null => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	const tag = tagOf(cause)
	return (tag === "CustomersInvalidRequestError" ||
		tag === "CustomerGroupError" ||
		tag === "CustomerFeatureFlagsError") &&
		Predicate.hasProperty(error, "message") &&
		typeof error.message === "string"
		? error.message
		: null
}

/** Logs a failed write and reads it as the page's failure message; a success says nothing. */
const settled =
	(label: string, onFailure: (cause: Cause.Cause<unknown>) => CustomerDetailMessage) =>
	<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<CustomerDetailMessage | Component.Noop> =>
		effect.pipe(
			Effect.as<CustomerDetailMessage | Component.Noop>(Component.noop),
			Effect.tapCause((cause) => Effect.logWarning(`${label} failed`, cause)),
			// BOUNDARY: every failure reads as the server's explanation or the shared copy.
			Effect.catchCause((cause) => Effect.succeed(onFailure(cause))),
		)

const Silent = Schema.Union([CustomerDetailMessage, Component.Noop])

// READS

/** `customers.account.detail`: the account's own record, refs, subscriptions and open invoices. */
export class GetCustomerDetail extends Query.Service<GetCustomerDetail>()("hazel/customers/GetDetail", {
	args: { ...target, attempt: Schema.Int },
	success: Customers.AccountDetail,
	error: DetailFailure,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, accountId }) =>
				rpc("customers.account.detail", { organizationId, accountId }).pipe(
					Effect.tapError((error) =>
						error._tag === "CustomersNotFoundError"
							? Effect.void
							: Effect.logWarning("customer detail failed", error),
					),
					Effect.mapError((error): DetailFailure =>
						error._tag === "CustomersNotFoundError" ? "NotFound" : "Other",
					),
				)
		}),
	)
}

/** The customer's open suggested channel links; `accountId` is the customer (its group's primary). */
export class GetCustomerSuggestions extends Query.Service<GetCustomerSuggestions>()(
	"hazel/customers/GetSuggestions",
	{
		args: { ...target, attempt: Schema.Int },
		success: Schema.Array(Customers.ChannelSuggestion),
		error: Schema.Literal("Failed"),
		staleTime: "1 minute",
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, accountId }) =>
				fetchSuggestions(organizationId, { accountId }).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.tapError((error) => Effect.logWarning("customer suggestions failed", error)),
					Effect.mapError(() => "Failed" as const),
				)
		}),
	)
}

// ACCOUNT

const failedWrite = (write: AccountWrite) => (cause: Cause.Cause<unknown>) =>
	CustomerDetailMessage.FailedAccountWrite({
		write,
		message: tagOf(cause) === "CustomersNotFoundError" ? "It was removed." : messageOf(cause),
	})

/** The owner (null removes it) or the tags, at once; the RPC follows. */
export class UpdateCustomerAccount extends Command.Service<UpdateCustomerAccount>()(
	"hazel/customers/UpdateAccount",
	{
		args: {
			...target,
			ownerUserId: Schema.optionalKey(Schema.NullOr(UserId)),
			tags: Schema.optionalKey(Schema.Array(Schema.String)),
		},
		success: Silent,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { updateAccountAction } = makeCustomerActions(data)
			return (args) =>
				updateAccountAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					settled("account update", failedWrite(args.tags === undefined ? "owner" : "tags")),
				)
		}),
	)
}

/** Mute the customer in Needs attention until `untilMs` (null: until unmuted), or unmute (`mute` null). */
export class SetAttentionMute extends Command.Service<SetAttentionMute>()(
	"hazel/customers/SetAttentionMute",
	{
		args: {
			...target,
			userId: UserId,
			mute: Schema.NullOr(Schema.Struct({ untilMs: Schema.NullOr(Schema.Finite) })),
		},
		success: Silent,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { setAttentionMuteAction } = makeCustomerActions(data)
			return ({ mute, ...args }) =>
				setAttentionMuteAction({
					...args,
					mute:
						mute === null
							? null
							: { until: mute.untilMs === null ? null : new Date(mute.untilMs) },
				}).pipe(Effect.provideService(HazelRpc, rpc), settled("attention mute", failedWrite("mute")))
		}),
	)
}

/** Make this environment its customer's primary, or unlink it from its primary. */
export class RegroupAccount extends Command.Service<RegroupAccount>()("hazel/customers/RegroupAccount", {
	args: { ...target, change: Schema.Literals(["make_primary", "unlink"]) },
	success: Silent,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { setPrimaryAccountAction, unlinkAccountAction } = makeCustomerActions(data)
			return ({ change, ...args }) =>
				(change === "make_primary" ? setPrimaryAccountAction(args) : unlinkAccountAction(args)).pipe(
					Effect.provideService(HazelRpc, rpc),
					settled("regroup", failedWrite("regroup")),
				)
		}),
	)
}

/** Turn flags on (all of `keys`) or off for this customer, in its source. */
export class SetFeatureFlags extends Command.Service<SetFeatureFlags>()("hazel/customers/SetFeatureFlags", {
	args: { ...target, keys: Schema.Array(Schema.String), enabled: Schema.Boolean },
	success: Silent,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { setFeatureFlagsAction } = makeCustomerActions(data)
			return ({ accountId, ...args }) =>
				setFeatureFlagsAction({ ...args, accountIds: [accountId] }).pipe(
					Effect.provideService(HazelRpc, rpc),
					settled("feature flags", failedWrite("flags")),
				)
		}),
	)
}

// COMPANY

/** Give the customer a company domain, first; with `removeDomain`, in place of that one. */
export class AddCustomerDomain extends Command.Service<AddCustomerDomain>()("hazel/customers/AddDomain", {
	args: { ...target, addDomain: Schema.String, removeDomain: Schema.optionalKey(Schema.String) },
	success: CustomerDetailMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { addDomainAction } = makeCustomerActions(data)
			return (args) =>
				addDomainAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(CustomerDetailMessage.SucceededAddDomain()),
					Effect.tapCause((cause) => Effect.logWarning("add domain failed", cause)),
					Effect.catchCause((cause) =>
						Effect.succeed(CustomerDetailMessage.FailedAddDomain({ message: messageOf(cause) })),
					),
				)
		}),
	)
}

/** Look the customer's company up again; the profile syncs in after. */
export class RefreshCompany extends Command.Service<RefreshCompany>()("hazel/customers/RefreshCompany", {
	args: target,
	success: Silent,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) =>
				rpc("customers.account.refreshCompany", args).pipe(
					settled("company refresh", (cause) =>
						CustomerDetailMessage.FailedCompanyRefresh({ message: messageOf(cause) }),
					),
				)
		}),
	)
}

// CHANNELS

/** Link a channel to the customer (stored on its primary), or unlink one (`link` null). */
export class WriteChannelLink extends Command.Service<WriteChannelLink>()(
	"hazel/customers/WriteChannelLink",
	{
		args: {
			organizationId: OrganizationId,
			channelId: ChannelId,
			link: Schema.NullOr(Schema.Struct({ accountId: CustomerAccountId, userId: UserId })),
		},
		success: Silent,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { linkChannelAction, unlinkChannelAction } = makeChannelData(data)
			return ({ organizationId, channelId, link }) =>
				(link === null
					? Effect.asVoid(unlinkChannelAction({ organizationId, channelId }))
					: Effect.asVoid(linkChannelAction({ organizationId, channelId, ...link }))
				).pipe(
					Effect.provideService(HazelRpc, rpc),
					settled("channel link", (cause) => {
						const tag = tagOf(cause)
						return CustomerDetailMessage.FailedChannelWrite({
							action: link === null ? "unlink" : "link",
							reason:
								tag === "CustomersNotFoundError"
									? "NotFound"
									: tag === "CustomersInvalidRequestError"
										? "Stale"
										: "Other",
						})
					}),
				)
		}),
	)
}

/** Accept a suggested link (the channel joins the customer's) or dismiss it. */
export class ActOnSuggestion extends Command.Service<ActOnSuggestion>()("hazel/customers/ActOnSuggestion", {
	args: {
		organizationId: OrganizationId,
		suggestionId: CustomerChannelSuggestionId,
		action: Schema.Literals(["accept", "dismiss"]),
	},
	success: Silent,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, suggestionId, action }) =>
				(action === "accept"
					? rpc("customers.channel.suggestion.accept", { organizationId, suggestionId })
					: rpc("customers.channel.suggestion.dismiss", { organizationId, suggestionId })
				).pipe(
					settled("suggestion", () =>
						CustomerDetailMessage.FailedSuggestionAction({ suggestionId, action }),
					),
				)
		}),
	)
}

/** Mark someone as our team or the customer in the org's linked channels, or clear the mark. */
export class SetChatPersonSide extends Command.Service<SetChatPersonSide>()(
	"hazel/customers/SetChatPersonSide",
	{
		args: {
			organizationId: OrganizationId,
			userId: UserId,
			side: Schema.NullOr(Customers.AuthorSideOverride),
			by: UserId,
		},
		success: Silent,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { setChatAuthorSideAction } = makeChatAuthorData(data)
			return (args) =>
				setChatAuthorSideAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					settled("chat author side", () => CustomerDetailMessage.FailedChatPersonSide()),
				)
		}),
	)
}

// CLIPBOARD

/** Where an in-app path lives on this host, when it has one (the web); as is elsewhere. */
const absolute = (path: string): string => {
	const origin = (globalThis as { readonly location?: { readonly origin?: string } }).location?.origin
	return origin === undefined ? path : new URL(path, origin).href
}

/** Copies `text` through the platform's clipboard; with `isPath`, as a full link. */
export class CopyText extends Command.Service<CopyText>()("hazel/customers/CopyText", {
	args: { text: Schema.String, label: Schema.String, isPath: Schema.optionalKey(Schema.Boolean) },
	success: CustomerDetailMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const clipboard = yield* Clipboard
			return ({ text, label, isPath }) =>
				clipboard.write(isPath === true ? absolute(text) : text).pipe(
					Effect.match({
						onSuccess: () => CustomerDetailMessage.SucceededCopy({ label }),
						onFailure: () => CustomerDetailMessage.FailedCopy(),
					}),
				)
		}),
	)
}

/** Every read and write of the shell, on the host's data, RPC client and clipboard. */
export const customerDetailLayer = Layer.mergeAll(
	GetCustomerDetail.layer,
	GetCustomerSuggestions.layer,
	UpdateCustomerAccount.layer,
	SetAttentionMute.layer,
	RegroupAccount.layer,
	SetFeatureFlags.layer,
	AddCustomerDomain.layer,
	RefreshCompany.layer,
	WriteChannelLink.layer,
	ActOnSuggestion.layer,
	SetChatPersonSide.layer,
	CopyText.layer,
)
