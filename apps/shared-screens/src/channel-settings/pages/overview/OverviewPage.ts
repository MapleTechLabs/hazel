// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/channels/:channelId/settings/overview` (the deleted Foldkit `page/channel-settings/overview`):
 * the channel's icon and name, and the customer it is linked to. The section layout around it
 * (back link, the channel's header, the tabs) is the root's.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ChannelIcon, ChannelId, CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Option, Schema, Stream } from "effect"
import { withData } from "../../../app/live"
import { AppRequests } from "../../../app/requests"
import { Session } from "../../../app/session"
import { EmojiPicker } from "../../../chat/pickers/EmojiPicker"
import { ChannelCustomerLink, linkOf, makeChannelData, searchOptions } from "../../../customers/data/channels"
import { groupIdOf } from "../../../customers/data/groups"
import { makeCustomerQueries } from "../../../customers/data/queries"
import { SuggestionPrompt } from "../../../customers/ui/SuggestionPrompt"
import { copyOf, type ErrorCopy, errorToast, reasonOf, successToast, toast } from "../../../modals/feedback"
import { channelStream } from "../../../shell/queries"
import { channelNameError } from "../../name-rules"
import { pageHeader } from "../../ui"

export const OverviewProps = Schema.Struct({
	channelId: ChannelId,
	session: Session,
	/** The customer's page, by account (`/:org/customers/:id`); null when the org has no slug yet. */
	customerHrefPrefix: Schema.NullOr(Schema.String),
})
export type OverviewProps = typeof OverviewProps.Type

/** The form, once the channel loads: the saved values, the edited ones, and whether a save runs. */
export const OverviewForm = Schema.Struct({
	savedName: Schema.String,
	savedIcon: Schema.NullOr(Schema.String),
	name: TextField.State,
	/** Null until the name is edited (today's `NotValidated`), then its first broken rule or none. */
	nameError: Schema.NullOr(Schema.String),
	icon: Schema.NullOr(Schema.String),
	/** The values being saved; they become the saved ones on success. */
	saving: Schema.NullOr(Schema.Struct({ name: Schema.String, icon: Schema.NullOr(Schema.String) })),
})
export type OverviewForm = typeof OverviewForm.Type

export const CustomerOption = Schema.Struct({ id: CustomerAccountId, name: Schema.String })
export type CustomerOption = typeof CustomerOption.Type

export const CustomerLinking = Schema.Literals(["Idle", "Linking", "Unlinking"])

export const OverviewModel = Schema.Struct({
	form: Schema.NullOr(OverviewForm),
	/** The channel's customer (`channel_customers`); null when none. */
	customer: Schema.NullOr(ChannelCustomerLink),
	/** Until the row answers once, `customer: null` means unknown, not none. */
	hasLoadedCustomer: Schema.Boolean,
	/** Loaded only while the picker is open (it opens the Customers source). */
	customers: Schema.NullOr(Schema.Array(CustomerOption)),
	isPickerOpen: Schema.Boolean,
	search: TextField.State,
	linking: CustomerLinking,
	isPickingIcon: Schema.Boolean,
})
export type OverviewModel = typeof OverviewModel.Type

const LoadedChannel = Schema.Struct({ name: Schema.String, icon: Schema.NullOr(Schema.String) })

export const OverviewMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { channel: Schema.NullOr(LoadedChannel) },
	ChangedName: { payload: TextField.ChangePayload },
	PressedIcon: {},
	PickedIcon: { emoji: Schema.String },
	ClosedIconPicker: {},
	PressedClearIcon: {},
	PressedSave: {},
	SucceededSave: {},
	FailedSave: {},
	UpdatedCustomer: { customer: Schema.NullOr(ChannelCustomerLink) },
	UpdatedCustomers: { customers: Schema.Array(CustomerOption) },
	PressedPicker: {},
	DismissedPicker: {},
	ChangedSearch: { payload: TextField.ChangePayload },
	PressedLinkCustomer: { accountId: CustomerAccountId },
	PressedUnlinkCustomer: {},
	SettledCustomerLink: { failed: Schema.Boolean },
})
export type OverviewMessage = typeof OverviewMessage.Type

/** The failure's own copy by its tag, else its common reason's (no server text is shown). */
const failureToast = (cause: Cause.Cause<unknown>, own: Readonly<Record<string, ErrorCopy>>) => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
	return errorToast(own[tag] ?? copyOf(reasonOf(error), {}))
}

/** The RPC client and the app's requests, captured when a Command's Layer builds. */
const services = Effect.gen(function* () {
	const rpc = yield* HazelRpc
	const requests = yield* AppRequests
	return {
		rpc,
		run: <A, E>(effect: Effect.Effect<A, E, AppRequests>) =>
			Effect.provideService(effect, AppRequests, requests),
	}
})

/** `channel.update` with the form's name and icon; its toast outlives the page. */
export class SaveChannel extends Command.Service<SaveChannel>()("hazel/channel-settings/SaveChannel", {
	args: { id: ChannelId, name: Schema.String, icon: Schema.NullOr(Schema.String) },
	success: OverviewMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc, run }) =>
				({ id, name, icon }) =>
					run(
						rpc("channel.update", {
							id,
							name,
							icon: icon === null ? null : ChannelIcon.make(icon),
						}).pipe(
							Effect.andThen(toast(successToast("Channel updated successfully"))),
							Effect.as(OverviewMessage.SucceededSave()),
							// BOUNDARY: every failure is a toast; the form keeps its edits.
							Effect.catchCause((cause) =>
								toast(
									failureToast(cause, {
										ChannelNotFoundError: {
											title: "Channel not found",
											description: "This channel may have been deleted.",
										},
									}),
								).pipe(Effect.as(OverviewMessage.FailedSave())),
							),
						),
					),
		),
	)
}

/** Link the channel to a customer (a link to another customer moves), or unlink it (`accountId` null). */
export class LinkCustomer extends Command.Service<LinkCustomer>()("hazel/channel-settings/LinkCustomer", {
	args: {
		organizationId: OrganizationId,
		channelId: ChannelId,
		accountId: Schema.NullOr(CustomerAccountId),
	},
	success: OverviewMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc, run }) =>
				({ organizationId, channelId, accountId }) =>
					run(
						(accountId === null
							? Effect.asVoid(rpc("customers.channel.unlink", { organizationId, channelId }))
							: Effect.asVoid(
									rpc("customers.channel.link", { organizationId, channelId, accountId }),
								)
						).pipe(
							Effect.as(OverviewMessage.SettledCustomerLink({ failed: false })),
							// BOUNDARY: every failure is a toast; the link stays as the server holds it.
							Effect.catchCause((cause) =>
								toast(
									failureToast(cause, {
										CustomersNotFoundError: {
											title:
												accountId === null
													? "Couldn't unlink the customer"
													: "Couldn't link the customer",
											description: "The customer or channel is no longer available.",
										},
										CustomersInvalidRequestError: {
											title: "Couldn't link the customer",
											description:
												"Threads and direct messages can't be linked to a customer.",
										},
									}),
								).pipe(Effect.as(OverviewMessage.SettledCustomerLink({ failed: true }))),
							),
						),
					),
		),
	)
}

const OverviewDef = Hazel.component({
	name: "ChannelSettingsOverview",
	props: OverviewProps,
	model: OverviewModel,
	message: OverviewMessage,
	// A save or link in flight at Back is not running any more.
	restore: (model) => ({
		...model,
		form: model.form === null ? null : { ...model.form, saving: null },
		linking: "Idle" as const,
		isPickerOpen: false,
		isPickingIcon: false,
	}),
})

type H = Parameters<Parameters<typeof OverviewDef.make>[0]["view"]>[0]

const isDirty = (form: OverviewForm) => form.name.text !== form.savedName || form.icon !== form.savedIcon

export const canSave = (form: OverviewForm) =>
	isDirty(form) && form.nameError === null && form.saving === null

const withForm = (model: OverviewModel, f: (form: OverviewForm) => OverviewForm): OverviewModel =>
	model.form === null ? model : { ...model, form: f(model.form) }

const iconField = (h: H, form: OverviewForm) =>
	h.stack.density("compact").children(
		// HAZEL-GAP(p4-textfield-kit-parity): today's field label is 14/24 wide; `body` is 14/20 there, 16/24 on a phone as today.
		h.text.strong().children("Channel icon"),
		h.stack
			.axis("horizontal")
			.density("compact")
			.align("center")
			.children(
				// HAZEL-GAP(p4-button-emoji): today's square button shows the emoji itself; `button` takes an `IconName`.
				h.button
					.label("Change channel icon")
					.icon("hashtag")
					.iconOnly()
					.variant("outline")
					.on("press", OverviewMessage.PressedIcon()),
				form.icon === null
					? null
					: h.button
							.label("Remove channel icon")
							.icon("close")
							.iconOnly()
							.variant("ghost")
							.size("small")
							.on("press", OverviewMessage.PressedClearIcon()),
				h.text
					.role("label")
					.tone("muted")
					.children(
						form.icon === null
							? "Click to add an emoji icon"
							: `${form.icon} Click to change icon`,
					),
			),
	)

const settingsForm = (h: H, form: OverviewForm) =>
	h.stack.density("relaxed").children(
		iconField(h, form),
		h.textField
			.label("Channel name")
			.placeholder("Channel name")
			.value(form.name)
			.error(form.nameError ?? undefined)
			.on("change", (payload) => OverviewMessage.ChangedName({ payload }))
			.on("submit", () => OverviewMessage.PressedSave()),
		h.stack.axis("horizontal").children(
			h.button
				.label(form.saving === null ? "Save changes" : "Saving...")
				.disabled(!canSave(form))
				.on("press", OverviewMessage.PressedSave()),
		),
	)

const customerPicker = (h: H, model: OverviewModel, label: string) => {
	const { customers, customer } = model
	const candidates =
		customers === null
			? []
			: searchOptions(
					customers.filter((option) => option.id !== customer?.accountId),
					model.search.text,
				)
	const note = (text: string) => h.text.role("label").tone("muted").children(text)
	const trigger = h.button
		.label(model.linking === "Linking" ? "Linking…" : label)
		.variant("outline")
		.size("small")
		.disabled(model.linking !== "Idle")
		.on("press", OverviewMessage.PressedPicker())
	return h.popover
		.open(model.isPickerOpen)
		.anchor(trigger)
		.on("dismiss", OverviewMessage.DismissedPicker())
		.children(
			h.frame.surface("overlay").children(
				h.searchField
					.placeholder("Search customers")
					.value(model.search)
					.on("change", (payload) => OverviewMessage.ChangedSearch({ payload })),
				customers === null
					? note("Loading customers…")
					: candidates.length === 0
						? note(
								customers.length === 0
									? "No customers yet. Connect a data source in Customers."
									: "No customer matches.",
							)
						: h.section.style("list").children(
								...candidates.map((option) =>
									h.item
										.key(option.id)
										.title(option.name)
										.leading(h.icon.name("office"))
										.on(
											"press",
											OverviewMessage.PressedLinkCustomer({ accountId: option.id }),
										),
								),
							),
			),
		)
}

const customerSection = (h: H, model: OverviewModel) => {
	const { organization, member } = h.props.session
	const { customer } = model
	const prefix = h.props.customerHrefPrefix
	const linked =
		customer === null
			? h.stack
					.density("cozy")
					.align("start")
					.children(
						organization === null || member === null || !model.hasLoadedCustomer
							? null
							: SuggestionPrompt(h, {
									key: h.props.channelId,
									props: { organizationId: organization.id, channelId: h.props.channelId },
								}),
						customerPicker(h, model, "Link to customer"),
					)
			: h.stack
					.axis("horizontal")
					.density("cozy")
					.align("center")
					.wrap()
					.children(
						h.frame.surface("inset").children(
							h.stack
								.axis("horizontal")
								.density("compact")
								.align("center")
								.children(
									h.icon.name("office"),
									prefix === null
										? h.text
												.role("label")
												.strong()
												.truncate()
												.children(customer.accountName)
										: h.link
												.label(customer.accountName)
												.href(`${prefix}${customer.accountId}`)
												.tone("muted"),
								),
						),
						customerPicker(h, model, "Change"),
						h.button
							.label(model.linking === "Unlinking" ? "Unlinking…" : "Unlink")
							.variant("ghost")
							.size("small")
							.disabled(model.linking !== "Idle")
							.on("press", OverviewMessage.PressedUnlinkCustomer()),
					)
	// Today's `border-t pt-6` above the section.
	return h.stack.density("relaxed").children(
		h.divider,
		h.stack.density("cozy").children(
			// HAZEL-GAP(p4-stack-gap-1): today's title sits 4px over its description; `tight` is 2px.
			h.stack
				.density("tight")
				.children(
					h.heading.level("3").children("Customer"),
					h.text
						.role("label")
						.tone("muted")
						.children(
							"Link this channel to the customer you talk to in it. Members see the customer in the channel, and the channel shows on the customer's page.",
						),
				),
			linked,
		),
	)
}

const subscriptionsOf = (props: OverviewProps, model: OverviewModel) => {
	const organizationId = props.session.organization?.id ?? null
	return [
		Subscription.make("channel", [props.channelId], ([channelId]) =>
			channelStream(ChannelId.make(channelId), (channel) =>
				OverviewMessage.UpdatedChannel({
					channel: channel === null ? null : { name: channel.name, icon: channel.icon },
				}),
			),
		),
		Subscription.make("customer", [props.channelId], ([channelId]) =>
			withData((data) =>
				makeChannelData(data).channelCustomerStream(ChannelId.make(channelId), (row) =>
					OverviewMessage.UpdatedCustomer({ customer: row === null ? null : linkOf(row) }),
				),
			),
		),
		// The Customers source opens only while the picker is open.
		Subscription.make("customers", [model.isPickerOpen ? (organizationId ?? "") : ""], ([orgId]) =>
			orgId === ""
				? Stream.empty
				: withData((data) =>
						makeCustomerQueries(data).accountsStream(OrganizationId.make(orgId), (accounts) => {
							// A channel is linked to a customer, not one of its environments.
							const liveIds = new Set<string>(accounts.map((account) => account.id))
							return OverviewMessage.UpdatedCustomers({
								customers: accounts
									.filter((account) => groupIdOf(account, liveIds) === account.id)
									.map((account) => ({ id: account.id, name: account.name })),
							})
						}),
					),
		),
	]
}

export const OverviewPageNoDeps = OverviewDef.make({
	init: () => ({
		form: null,
		customer: null,
		hasLoadedCustomer: false,
		customers: null,
		isPickerOpen: false,
		search: TextField.empty,
		linking: "Idle" as const,
		isPickingIcon: false,
	}),
	update: {
		// A loaded form keeps its edits (today's `key={channel.id}` form); a gone channel drops it.
		UpdatedChannel: ($, { channel }) =>
			channel === null
				? $.evolve({ form: () => null })
				: $.model.form !== null
					? $.model
					: $.evolve({
							form: () => ({
								savedName: channel.name,
								savedIcon: channel.icon,
								name: TextField.set(TextField.empty, channel.name),
								nameError: null,
								icon: channel.icon,
								saving: null,
							}),
						}),
		ChangedName: ($, { payload }) =>
			$.set(
				withForm($.model, (form) => {
					const name = TextField.changed(form.name, payload)
					return { ...form, name, nameError: channelNameError(name.text) }
				}),
			),
		PressedIcon: ($) => $.evolve({ isPickingIcon: () => true }),
		PickedIcon: ($, { emoji }) =>
			$.set(withForm({ ...$.model, isPickingIcon: false }, (form) => ({ ...form, icon: emoji }))),
		ClosedIconPicker: ($) => $.evolve({ isPickingIcon: () => false }),
		PressedClearIcon: ($) => $.set(withForm($.model, (form) => ({ ...form, icon: null }))),
		PressedSave: ($) => {
			const form = $.model.form
			if (form === null || !canSave(form)) return $.model
			const name = form.name.text
			return $.set(withForm($.model, () => ({ ...form, saving: { name, icon: form.icon } }))).run(
				SaveChannel.make({ id: $.props.channelId, name, icon: form.icon }),
			)
		},
		// The sent values are now the saved ones, so the form is clean until the next edit.
		SucceededSave: ($) =>
			$.set(
				withForm($.model, (form) =>
					form.saving === null
						? form
						: { ...form, savedName: form.saving.name, savedIcon: form.saving.icon, saving: null },
				),
			),
		FailedSave: ($) => $.set(withForm($.model, (form) => ({ ...form, saving: null }))),
		// The projection landing ends the pending state: the change is what the server now holds.
		UpdatedCustomer: ($, { customer }) =>
			$.evolve({
				customer: () => customer,
				hasLoadedCustomer: () => true,
				linking: () => "Idle" as const,
			}),
		UpdatedCustomers: ($, { customers }) => $.evolve({ customers: () => customers }),
		PressedPicker: ($) => $.evolve({ isPickerOpen: (open) => !open }),
		DismissedPicker: ($) => $.evolve({ isPickerOpen: () => false, search: () => TextField.empty }),
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		PressedLinkCustomer: ($, { accountId }) => {
			const closed = $.evolve({ isPickerOpen: () => false, search: () => TextField.empty })
			const organizationId = $.props.session.organization?.id
			if (organizationId === undefined || accountId === $.model.customer?.accountId) return closed
			return closed
				.evolve({ linking: () => "Linking" as const })
				.run(LinkCustomer.make({ organizationId, channelId: $.props.channelId, accountId }))
		},
		PressedUnlinkCustomer: ($) => {
			const organizationId = $.props.session.organization?.id
			if (organizationId === undefined || $.model.customer === null) return $.model
			return $.evolve({ linking: () => "Unlinking" as const }).run(
				LinkCustomer.make({ organizationId, channelId: $.props.channelId, accountId: null }),
			)
		},
		// Success waits for the projection (`UpdatedCustomer`); a failure ends the pending state now.
		SettledCustomerLink: ($, { failed }) =>
			failed ? $.evolve({ linking: () => "Idle" as const }) : $.model,
	},
	subscriptions: ({ props, model }) => subscriptionsOf(props, model),
	view: (h, model) =>
		h.stack
			.key("channel-settings-overview")
			.density("relaxed")
			.children(
				pageHeader(h, { title: "Overview", subtitle: "General information about this channel." }),
				model.form === null ? null : settingsForm(h, model.form),
				model.form === null ? null : customerSection(h, model),
				// Mounted while open, so the emoji set loads only when asked for.
				model.isPickingIcon
					? EmojiPicker(h, {
							props: { open: true },
							onEmit: {
								Picked: ({ emoji }) => OverviewMessage.PickedIcon({ emoji }),
								RequestedClose: () => OverviewMessage.ClosedIconPicker(),
							},
						})
					: null,
			),
})

/** The page with its Commands, on the host's `HazelRpc`. */
export const OverviewPage = OverviewPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(SaveChannel.layer, LinkCustomer.layer)),
)
