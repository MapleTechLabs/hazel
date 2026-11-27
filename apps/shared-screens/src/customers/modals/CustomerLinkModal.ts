// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "Link to another customer…" from the customer page's More menu (today's `linkDialog`): search,
 * pick the customer this one joins as an environment, confirm. The store's refusal shows in the
 * dialog, beside the pick to change; anything else is a toast.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Predicate, Schema } from "effect"
import { withData } from "../../app/live"
import { errorToast, ModalEvents, successToast, toast } from "../../modals/feedback"
import { modalServices } from "../../modals/services"
import { makeCustomerActions } from "../data/actions"
import { formatMoney } from "../data/format"
import { accountLabelOf, environmentCounts, environmentsHintOf, groupIdOf } from "../data/groups"
import { AccountRow, makeCustomerQueries } from "../data/queries"

export const CustomerLinkProps = Schema.Struct({
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
})
export type CustomerLinkProps = typeof CustomerLinkProps.Type

export const CustomerLinkModel = Schema.Struct({
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	query: TextField.State,
	picked: Schema.NullOr(CustomerAccountId),
	isLinking: Schema.Boolean,
	/** The store's refusal, in its words. */
	refusal: Schema.NullOr(Schema.String),
})
export type CustomerLinkModel = typeof CustomerLinkModel.Type

export const CustomerLinkMessage = UiSchema.TaggedEnum({
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	ChangedQuery: { payload: TextField.ChangePayload },
	PickedCustomer: { selected: Schema.Array(Schema.String) },
	PressedLink: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededLinkCustomer: {},
	FailedLinkCustomer: { refusal: Schema.NullOr(Schema.String) },
})
export type CustomerLinkMessage = typeof CustomerLinkMessage.Type

/**
 * The customers this one can join: the other customers' primaries and standalone accounts (an
 * environment can't lead), by name, environment or domain, never its own group.
 */
export const linkCandidates = (
	accounts: ReadonlyArray<AccountRow>,
	accountId: CustomerAccountId,
	query: string,
): ReadonlyArray<AccountRow> => {
	const liveIds = new Set<string>(accounts.map((account) => account.id))
	const own = accounts.find((account) => account.id === accountId)
	const ownGroupId = own === undefined ? accountId : groupIdOf(own, liveIds)
	const needle = query.trim().toLowerCase()
	return accounts.filter(
		(account) =>
			groupIdOf(account, liveIds) === account.id &&
			account.id !== ownGroupId &&
			(needle === "" ||
				account.name.toLowerCase().includes(needle) ||
				(account.environment?.toLowerCase().includes(needle) ?? false) ||
				(account.domain?.toLowerCase().includes(needle) ?? false)),
	)
}

const refusalOf = (cause: Cause.Cause<unknown>): string | null => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	return Predicate.hasProperty(error, "_tag") &&
		error._tag === "CustomerGroupError" &&
		Predicate.hasProperty(error, "message") &&
		typeof error.message === "string"
		? error.message
		: null
}

/** Joins `primaryAccountId`'s customer; the success toast names it. */
export class LinkCustomer extends Command.Service<LinkCustomer>()("hazel/customers/LinkCustomer", {
	args: {
		organizationId: OrganizationId,
		accountId: CustomerAccountId,
		primaryAccountId: CustomerAccountId,
		primaryLabel: Schema.String,
	},
	success: CustomerLinkMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { linkAccountAction } = makeCustomerActions(data)
			return ({ primaryLabel, ...args }) =>
				run(
					linkAccountAction(args).pipe(
						Effect.andThen(toast(successToast(`Linked to ${primaryLabel}`))),
						Effect.as(CustomerLinkMessage.SucceededLinkCustomer()),
						Effect.tapCause((cause) => Effect.logWarning("link customer failed", cause)),
						// BOUNDARY: the store's refusal stays in the dialog; anything else is a toast.
						Effect.catchCause((cause) => {
							const refusal = refusalOf(cause)
							return refusal !== null
								? Effect.succeed(CustomerLinkMessage.FailedLinkCustomer({ refusal }))
								: toast(errorToast({ title: "Couldn't link the customers" })).pipe(
										Effect.as(CustomerLinkMessage.FailedLinkCustomer({ refusal: null })),
									)
						}),
					),
				)
		}),
	)
}

const close = ModalEvents.RequestedClose()

/** "acme.com · +2 environments · $1,200 MRR", or "No domain". */
const candidateLine = (account: AccountRow, environments: number): string =>
	[
		account.domain,
		environmentsHintOf(environments),
		account.mrrMinor > 0 ? `${formatMoney(account.mrrMinor, account.currency)} MRR` : null,
	]
		.filter((part) => part !== null)
		.join(" · ") || "No domain"

export const CustomerLinkModalNoDeps = Hazel.component({
	name: "CustomerLinkModal",
	props: CustomerLinkProps,
	model: CustomerLinkModel,
	message: CustomerLinkMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, isLinking: false }),
}).make({
	init: () => ({ accounts: null, query: TextField.empty, picked: null, isLinking: false, refusal: null }),
	update: {
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts: () => accounts }),
		ChangedQuery: ($, { payload }) => $.evolve({ query: (query) => TextField.changed(query, payload) }),
		PickedCustomer: ($, { selected }) => {
			const id = selected[0]
			const candidates = linkCandidates($.model.accounts ?? [], $.props.accountId, $.model.query.text)
			return $.evolve({
				picked: candidates.find((account) => account.id === id)?.id ?? null,
				refusal: null,
			})
		},
		PressedLink: ($) => {
			const picked = ($.model.accounts ?? []).find((account) => account.id === $.model.picked)
			return $.model.isLinking || picked === undefined
				? $.model
				: $.evolve({ isLinking: true, refusal: null }).run(
						LinkCustomer.make({
							organizationId: $.props.organizationId,
							accountId: $.props.accountId,
							primaryAccountId: picked.id,
							primaryLabel: accountLabelOf(picked),
						}),
					)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededLinkCustomer: ($) => $.emit(close),
		FailedLinkCustomer: ($, { refusal }) => $.evolve({ isLinking: false, refusal }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("accounts", [props.organizationId], ([organizationId]) =>
			withData((data) =>
				makeCustomerQueries(data).accountsStream(OrganizationId.make(organizationId), (accounts) =>
					CustomerLinkMessage.UpdatedAccounts({ accounts }),
				),
			),
		),
	],
	view: (h, model) => {
		const accounts = model.accounts ?? []
		const candidates = linkCandidates(accounts, h.props.accountId, model.query.text)
		const own = accounts.find((account) => account.id === h.props.accountId)
		const picked = candidates.find((account) => account.id === model.picked) ?? null
		const counts = environmentCounts(accounts)
		const name = own === undefined ? "this customer" : accountLabelOf(own)
		return h.dialog
			.open(true)
			.title(`Link ${name} to another customer`)
			.description(
				"It becomes an environment of the customer you pick, with its own environments if it has any. Each environment keeps its own numbers, users and billing; signals are raised for the whole customer, on its primary. You can unlink it again.",
			)
			.on("dismiss", CustomerLinkMessage.DismissedDialog())
			.children(
				h.searchField
					.placeholder("Search customers…")
					.value(model.query)
					.on("change", (payload) => CustomerLinkMessage.ChangedQuery({ payload })),
				candidates.length === 0
					? h.text.tone("muted").children("No other customers match.")
					: // HAZEL-GAP(pk5-choice-logo): today's options lead with the company logo and an
						// environment badge after the name; `ChoiceOption.image` is a picture, not a logo
						// with an initials fallback.
						h.choiceGroup
							.label("Customer to join")
							.labelHidden()
							.options(
								candidates.slice(0, 100).map((account) => ({
									value: account.id,
									label:
										account.environment === null
											? account.name
											: `${account.name} · ${account.environment}`,
									description: candidateLine(account, counts.get(account.id) ?? 0),
								})),
							)
							.selected(picked === null ? [] : [picked.id])
							.on("change", ({ selected }) => CustomerLinkMessage.PickedCustomer({ selected })),
				model.refusal === null ? null : h.banner.tone("danger").description(model.refusal),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", CustomerLinkMessage.PressedCancel()),
				h.button
					.label(picked === null ? "Link" : `Link to ${accountLabelOf(picked)}`)
					.loading(model.isLinking)
					.disabled(picked === null || model.isLinking)
					.on("press", CustomerLinkMessage.PressedLink()),
			)
	},
})

export const CustomerLinkModal = CustomerLinkModalNoDeps.pipe(Component.provide(LinkCustomer.layer))
