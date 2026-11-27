// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/settings/feature-flags` (`web-foldkit/src/page/customers/settings/feature-flags`,
 * now deleted): the boolean keys of the customers' records in their source, plus the ones created
 * here. A flag opens to the customers that have it; admins create, delete and assign flags.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Schema, Stream } from "effect"
import { Session } from "../../../../app/session"
import * as Confirm from "../../../../components/ConfirmAction"
import { commonCopy, errorToast, reasonOf, successToast, toast } from "../../../../modals/feedback"
import { modalServices } from "../../../../modals/services"
import { makeCustomerActions } from "../../../data/actions"
import { formatCount } from "../../../data/format"
import { featureFlagsSource } from "../../../data/providers"
import { AccountRow, makeCustomerQueries } from "../../../data/queries"
import { companyLogo } from "../../../ui/identity"
import { isCustomersAdmin, pageHeader, readOnlyNotice, settingsColumn } from "../settings-page"

const { name: SOURCE, accountNoun: RECORD } = featureFlagsSource

const SUBTITLE = `The boolean keys of your customers’ ${SOURCE} ${RECORD} metadata. Turning a flag on or off writes to ${SOURCE}.`

/** A new flag's key, as the server checks it (`customers.featureFlag.create`). */
export const FEATURE_FLAG_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

/** The flags: the ones created in Hazel and every key a live account holds (on or off), sorted. */
export const featureFlagKeysOf = (
	created: ReadonlyArray<string>,
	accounts: ReadonlyArray<AccountRow>,
): ReadonlyArray<string> =>
	[...new Set([...created, ...accounts.flatMap((account) => Object.keys(account.featureFlags))])].sort()

export const hasFlag = (account: AccountRow, key: string): boolean => account.featureFlags[key] === true

export const FlagAction = Schema.Literals(["create", "delete", "assign", "unassign"])
export type FlagAction = typeof FlagAction.Type

export const FeatureFlagsProps = Schema.Struct({ session: Session })
export type FeatureFlagsProps = typeof FeatureFlagsProps.Type

export const FeatureFlagsModel = Schema.Struct({
	/** The flags created in Hazel (`customer_feature_flags`). */
	created: Schema.Array(Schema.String),
	/** The org's live accounts; null until they sync. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	/** The flag whose customers show. */
	selectedKey: Schema.NullOr(Schema.String),
	newKey: TextField.State,
	isPickerOpen: Schema.Boolean,
	customerSearch: TextField.State,
	/** The customers ticked in the "Add customers" picker. */
	customerSelection: Schema.Array(CustomerAccountId),
	deleting: Confirm.ConfirmState(Schema.String),
})
export type FeatureFlagsModel = typeof FeatureFlagsModel.Type

export const FeatureFlagsMessage = UiSchema.TaggedEnum({
	UpdatedCreated: { keys: Schema.Array(Schema.String) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	PressedFlag: { key: Schema.String },
	ChangedNewKey: { payload: TextField.ChangePayload },
	SubmittedNewKey: {},
	PressedDeleteFlag: { key: Schema.String },
	PressedConfirmDelete: {},
	CancelledDelete: {},
	PressedAddCustomers: {},
	DismissedPicker: {},
	ChangedCustomerSearch: { payload: TextField.ChangePayload },
	ToggledCustomer: { accountId: CustomerAccountId, isSelected: Schema.Boolean },
	PressedTurnOn: {},
	PressedRemoveCustomer: { accountId: CustomerAccountId },
	SettledFlagAction: { action: FlagAction, ok: Schema.Boolean },
})
export type FeatureFlagsMessage = typeof FeatureFlagsMessage.Type

const FAILED_TITLE = {
	create: "Couldn't create the feature flag",
	delete: "Couldn't delete the feature flag",
	assign: "Couldn't turn the flag on",
	unassign: "Couldn't turn the flag off",
} satisfies Record<FlagAction, string>

/** One write: create or delete a flag, or turn it on or off for some customers. */
export class RunFlagAction extends Command.Service<RunFlagAction>()("hazel/customers/RunFlagAction", {
	args: {
		organizationId: OrganizationId,
		action: FlagAction,
		key: Schema.String,
		accountIds: Schema.Array(CustomerAccountId),
		createdBy: UserId,
	},
	success: FeatureFlagsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeCustomerActions(data)
			return ({ organizationId, action, key, accountIds, createdBy }) => {
				const write =
					action === "create"
						? Effect.asVoid(actions.createFeatureFlagAction({ organizationId, key, createdBy }))
						: action === "delete"
							? Effect.asVoid(actions.deleteFeatureFlagAction({ organizationId, key }))
							: Effect.asVoid(
									actions.setFeatureFlagsAction({
										organizationId,
										accountIds,
										keys: [key],
										enabled: action === "assign",
									}),
								)
				const failed = (description: string | null) =>
					toast({ intent: "error", title: FAILED_TITLE[action], description }).pipe(
						Effect.as(FeatureFlagsMessage.SettledFlagAction({ action, ok: false })),
					)
				return run(
					write.pipe(
						Effect.andThen(
							action === "delete" ? toast(successToast("Feature flag deleted")) : Effect.void,
						),
						Effect.as(FeatureFlagsMessage.SettledFlagAction({ action, ok: true })),
						// The collections roll back; what the source accepted comes back through the stream.
						Effect.catchTags({
							CustomerFeatureFlagsError: (error) => failed(error.message),
							CustomersInvalidRequestError: (error) => failed(error.message),
							CustomersNotFoundError: () => failed("The customer was removed."),
						}),
						// BOUNDARY: every other failure reads as its common reason.
						Effect.catchCause((cause) =>
							toast(
								errorToast(
									commonCopy(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause)))),
								),
							).pipe(Effect.as(FeatureFlagsMessage.SettledFlagAction({ action, ok: false }))),
						),
					),
				)
			}
		}),
	)
}

const FeatureFlagsDef = Hazel.component({
	name: "FeatureFlagsPage",
	props: FeatureFlagsProps,
	model: FeatureFlagsModel,
	message: FeatureFlagsMessage,
	restore: (model) => ({ ...model, isPickerOpen: false, deleting: Confirm.closed }),
})

type H = Parameters<Parameters<typeof FeatureFlagsDef.make>[0]["view"]>[0]

const customersWith = (model: FeatureFlagsModel, key: string): ReadonlyArray<AccountRow> =>
	(model.accounts ?? []).filter((account) => hasFlag(account, key))

const countLabel = (count: number) => (count === 1 ? "1 customer" : `${formatCount(count)} customers`)

const keyError = (text: string): string | undefined => {
	const key = text.trim()
	return key !== "" && !FEATURE_FLAG_KEY.test(key)
		? "Use letters, digits, _ . : or -, at most 64 characters, starting with a letter or digit."
		: undefined
}

const createForm = (h: H, model: FeatureFlagsModel) => {
	const key = model.newKey.text.trim()
	const error = keyError(model.newKey.text)
	// HAZEL-GAP(pk8-inline-field-button): today the field and "Create flag" share one row, the error under both.
	return h.stack
		.axis("horizontal")
		.density("compact")
		.align("start")
		.children(
			h.textField
				.placeholder("new_flag_key")
				.value(model.newKey)
				.error(error)
				.on("change", (payload) => FeatureFlagsMessage.ChangedNewKey({ payload }))
				.on("submit", () => FeatureFlagsMessage.SubmittedNewKey()),
			h.button
				.label("Create flag")
				.icon("plus")
				.size("small")
				.disabled(key === "" || error !== undefined)
				.on("press", FeatureFlagsMessage.SubmittedNewKey()),
		)
}

/** The "Add customers" picker: tick the customers that don't have the flag, then turn it on for all. */
const customerPicker = (h: H, model: FeatureFlagsModel, key: string) => {
	const search = model.customerSearch.text.trim().toLowerCase()
	const accounts = model.accounts ?? []
	const candidates = accounts.filter(
		(account) =>
			account.featureFlags[key] !== true &&
			(search === "" ||
				account.name.toLowerCase().includes(search) ||
				(account.domain ?? "").includes(search)),
	)
	const count = model.customerSelection.length
	return h.popover
		.open(model.isPickerOpen)
		.on("dismiss", FeatureFlagsMessage.DismissedPicker())
		.anchor(
			h.button
				.label("Add customers")
				.icon("plus")
				.variant("outline")
				.size("xsmall")
				.on("press", FeatureFlagsMessage.PressedAddCustomers()),
		)
		.children(
			h.searchField
				.placeholder("Search customers")
				.value(model.customerSearch)
				.on("change", (payload) => FeatureFlagsMessage.ChangedCustomerSearch({ payload })),
			candidates.length === 0
				? h.text
						.tone("muted")
						.children(
							accounts.length === 0
								? "No customers yet."
								: search === ""
									? "Every customer already has this flag."
									: "No customer matches.",
						)
				: h.stack.density("tight").children(
						// HAZEL-GAP(pk8-checkbox-leading): today each checkbox's label leads with the company logo.
						...candidates.map((account) =>
							h.toggle
								.key(account.id)
								.style("checkbox")
								.label(account.name)
								.checked(model.customerSelection.includes(account.id))
								.on("change", ({ checked }) =>
									FeatureFlagsMessage.ToggledCustomer({
										accountId: account.id,
										isSelected: checked,
									}),
								),
						),
					),
			h.button
				.label(count <= 1 ? "Turn on" : `Turn on for ${formatCount(count)} customers`)
				.size("small")
				.disabled(count === 0)
				.on("press", FeatureFlagsMessage.PressedTurnOn()),
		)
}

/** The selected flag's customers: each links to its page; admins take it off or add more. */
const flagCustomers = (h: H, model: FeatureFlagsModel, key: string, orgSlug: string, canEdit: boolean) => {
	const customers = customersWith(model, key)
	// HAZEL-GAP(pk8-open-row-wash): today the open flag's customers sit on a `secondary/30` band.
	return h.stack
		.key(`${key}-customers`)
		.inset("bar")
		.density("tight")
		.children(
			...(customers.length === 0
				? [h.text.tone("muted").children("No customer has this flag on.")]
				: customers.map((account) =>
						h.stack
							.key(account.id)
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								companyLogo(h, { name: account.name, logoUrl: account.logoUrl }),
								h.link
									.tone("muted")
									.label(account.name)
									.href(`/${orgSlug}/customers/${account.id}`),
								h.spacer,
								canEdit
									? h.button
											.label(`Turn ${key} off for ${account.name}`)
											.icon("close")
											.iconOnly()
											.variant("ghost")
											.size("xsmall")
											.on(
												"press",
												FeatureFlagsMessage.PressedRemoveCustomer({
													accountId: account.id,
												}),
											)
									: null,
							),
					)),
			canEdit ? customerPicker(h, model, key) : null,
		)
}

const flagRow = (h: H, model: FeatureFlagsModel, key: string, orgSlug: string, canEdit: boolean) => {
	const isOpen = model.selectedKey === key
	// HAZEL-GAP(pk8-flag-row): today the row is a full-width plain button, the key in mono and the count at its end.
	return h.stack.key(key).children(
		h.stack
			.axis("horizontal")
			.align("center")
			.density("compact")
			.children(
				h.button
					.label(key)
					.icon(isOpen ? "chevron-down" : "chevron-right")
					.variant("ghost")
					.size("small")
					.on("press", FeatureFlagsMessage.PressedFlag({ key })),
				h.spacer,
				h.text
					.role("caption")
					.tone("muted")
					.children(countLabel(customersWith(model, key).length)),
				canEdit
					? h.button
							.label(`Delete ${key}`)
							.icon("trash")
							.iconOnly()
							.variant("ghost")
							.size("xsmall")
							.on("press", FeatureFlagsMessage.PressedDeleteFlag({ key }))
					: null,
			),
		isOpen ? flagCustomers(h, model, key, orgSlug, canEdit) : null,
	)
}

const flagsCard = (h: H, model: FeatureFlagsModel, orgSlug: string, canEdit: boolean) => {
	const keys = featureFlagKeysOf(model.created, model.accounts ?? [])
	if (keys.length === 0)
		return h.frame
			.surface("card")
			.children(
				h.emptyState
					.icon("rocket")
					.title("No feature flags yet")
					.description(
						`Flags show up here once a ${SOURCE} ${RECORD} has a boolean in its public metadata, or when you create one.`,
					),
			)
	return h.frame
		.surface("flush")
		.children(
			...keys.flatMap((key, index) => [
				index === 0 ? null : h.divider.key(`divider-${key}`),
				flagRow(h, model, key, orgSlug, canEdit),
			]),
		)
}

const deleteDescription = (model: FeatureFlagsModel, key: string) => {
	const count = (model.accounts ?? []).filter((account) => Object.hasOwn(account.featureFlags, key)).length
	return count === 0
		? `No customer has it, so nothing changes in ${SOURCE}.`
		: `It's removed from the ${SOURCE} metadata of ${countLabel(count)}. This can't be undone.`
}

/** The organization and user, when an admin acts. */
const adminActor = (session: Session) =>
	isCustomersAdmin(session) && session.organization !== null && session.user !== null
		? { organizationId: session.organization.id, createdBy: session.user.id }
		: null

export const FeatureFlagsPageNoDeps = FeatureFlagsDef.make({
	init: () => ({
		created: [],
		accounts: null,
		selectedKey: null,
		newKey: TextField.empty,
		isPickerOpen: false,
		customerSearch: TextField.empty,
		customerSelection: [],
		deleting: Confirm.closed,
	}),
	update: {
		UpdatedCreated: ($, { keys }) => $.evolve({ created: () => keys }),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts: () => accounts }),
		PressedFlag: ($, { key }) =>
			$.evolve({
				selectedKey: (selected) => (selected === key ? null : key),
				isPickerOpen: () => false,
				customerSelection: () => [],
				customerSearch: () => TextField.empty,
			}),
		ChangedNewKey: ($, { payload }) => $.evolve({ newKey: (state) => TextField.changed(state, payload) }),
		SubmittedNewKey: ($) => {
			const actor = adminActor($.props.session)
			const key = $.model.newKey.text.trim()
			if (actor === null || !FEATURE_FLAG_KEY.test(key)) return $.model
			// The new or existing flag opens with an empty picker: another flag's ticks do not carry over.
			const opened = {
				...$.model,
				newKey: TextField.set($.model.newKey, ""),
				selectedKey: key,
				isPickerOpen: false,
				customerSelection: [],
				customerSearch: TextField.empty,
			}
			if (featureFlagKeysOf($.model.created, $.model.accounts ?? []).includes(key)) return opened
			return $.set(opened).run(RunFlagAction.make({ ...actor, action: "create", key, accountIds: [] }))
		},
		PressedDeleteFlag: ($, { key }) => $.evolve({ deleting: (state) => Confirm.ask(state, key) }),
		CancelledDelete: ($) => $.evolve({ deleting: Confirm.cancel }),
		PressedConfirmDelete: ($) => {
			const actor = adminActor($.props.session)
			const confirmed = Confirm.confirm($.model.deleting)
			if (actor === null || confirmed === undefined) return $.model
			const [, key] = confirmed
			// The dialog closes at once, as today's; the toast says how it went.
			return $.set({
				...$.model,
				deleting: Confirm.closed,
				selectedKey: $.model.selectedKey === key ? null : $.model.selectedKey,
			}).run(RunFlagAction.make({ ...actor, action: "delete", key, accountIds: [] }))
		},
		PressedAddCustomers: ($) => $.evolve({ isPickerOpen: (open) => !open }),
		// Closed without adding: the ticks and the search are dropped.
		DismissedPicker: ($) =>
			$.evolve({
				isPickerOpen: () => false,
				customerSelection: () => [],
				customerSearch: () => TextField.empty,
			}),
		ChangedCustomerSearch: ($, { payload }) =>
			$.evolve({ customerSearch: (state) => TextField.changed(state, payload) }),
		ToggledCustomer: ($, { accountId, isSelected }) =>
			$.evolve({
				customerSelection: (selection) =>
					isSelected ? [...selection, accountId] : selection.filter((id) => id !== accountId),
			}),
		PressedTurnOn: ($) => {
			const actor = adminActor($.props.session)
			const key = $.model.selectedKey
			const accountIds = $.model.customerSelection
			const closed = {
				...$.model,
				isPickerOpen: false,
				customerSelection: [],
				customerSearch: TextField.empty,
			}
			if (actor === null || key === null || accountIds.length === 0) return closed
			return $.set(closed).run(RunFlagAction.make({ ...actor, action: "assign", key, accountIds }))
		},
		PressedRemoveCustomer: ($, { accountId }) => {
			const actor = adminActor($.props.session)
			const key = $.model.selectedKey
			return actor === null || key === null
				? $.model
				: $.run(RunFlagAction.make({ ...actor, action: "unassign", key, accountIds: [accountId] }))
		},
		SettledFlagAction: ($) => $.model,
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? ""
		const live = <A>(
			name: string,
			stream: (queries: ReturnType<typeof makeCustomerQueries>, id: OrganizationId) => Stream.Stream<A>,
		) =>
			Subscription.make(name, [organizationId], ([id]) =>
				id === ""
					? Stream.empty
					: Stream.unwrap(
							Effect.map(ClientData.useSync(makeCustomerQueries), (queries) =>
								stream(queries, OrganizationId.make(id)),
							),
						),
			)
		return [
			live("created", (queries, id) =>
				queries.createdFeatureFlagsStream(id, (keys) => FeatureFlagsMessage.UpdatedCreated({ keys })),
			),
			live("accounts", (queries, id) =>
				queries.accountsStream(id, (accounts) => FeatureFlagsMessage.UpdatedAccounts({ accounts })),
			),
		]
	},
	view: (h, model) => {
		const { session } = h.props
		const canEdit = isCustomersAdmin(session)
		const deletingKey = Confirm.targetOf(model.deleting) ?? ""
		return settingsColumn(h, "customers-settings-feature-flags", [
			pageHeader(h, { title: "Feature flags", subtitle: SUBTITLE }),
			canEdit ? createForm(h, model) : readOnlyNotice(h, "feature flags"),
			model.accounts === null
				? h.progress.style("spinner").label("Loading feature flags")
				: flagsCard(h, model, session.orgSlug ?? "", canEdit),
			Confirm.confirmDialog(h, model.deleting, {
				key: "delete-flag",
				title: `Delete ${deletingKey}?`,
				description: deleteDescription(model, deletingKey),
				confirmLabel: "Delete flag",
				runningLabel: "Deleting...",
				confirmed: FeatureFlagsMessage.PressedConfirmDelete(),
				cancelled: FeatureFlagsMessage.CancelledDelete(),
			}),
		])
	},
})

/** The page with its write Command, on the host's data and RPC client. */
export const FeatureFlagsPage = FeatureFlagsPageNoDeps.pipe(Component.provide(RunFlagAction.layer))
