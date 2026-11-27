// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/$accountId?tab=`: one customer (today's `page/customers/detail`): the crumbs
 * and prev and next, the header with its menus, the tabs and the details panel, and the dialogs the
 * More menu opens. The tab's content is the host's `tab` slot.
 */
import { Component, Subscription } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import type * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { and, eq, isNull } from "@tanstack/db"
import { Cause, Match, Option, Stream } from "effect"
import { Navigate, OpenModal, ShowToast } from "../../app/requests"
import { withData } from "../../app/live"
import { errorToast, successToast } from "../../modals/feedback"
import { makeChannelData } from "../data/channels"
import { makeChatAuthorData } from "../data/chat-authors"
import { madePrimary, unlinked } from "../data/groups"
import { makeCustomerQueries, withCustomersSourceIn } from "../data/queries"
import {
	ActOnSuggestion,
	AddCustomerDomain,
	CopyText,
	customerDetailLayer,
	GetCustomerDetail,
	GetCustomerSuggestions,
	RefreshCompany,
	RegroupAccount,
	SetAttentionMute,
	SetChatPersonSide,
	SetFeatureFlags,
	UpdateCustomerAccount,
	WriteChannelLink,
} from "../detail/commands"
import { header, type HeaderInputs, tabs, topBar } from "../detail/header"
import {
	accountOf,
	ActionKey,
	CHAT_PERSON_SIDE,
	ChatPersonKey,
	CustomerDetailMessage,
	CustomerDetailModel,
	CustomerDetailProps,
	customerHref,
	customerOfAccount,
	customersListHref,
	featureFlagKeysOf,
	groupOfState,
	initialModel,
	isCompanyRefreshPending,
	isMuteKey,
	isNotFound,
	MUTE_LABEL,
	muteUntilMs,
	OWNER_NONE,
	positionOf,
	primaryOf,
	userIdOfOwnerKey,
} from "../detail/model"
import { sidebar } from "../detail/sidebar"

const CustomerDetailDef = Hazel.component({
	name: "CustomerDetailPage",
	props: CustomerDetailProps,
	model: CustomerDetailModel,
	message: CustomerDetailMessage,
	slots: ["tab"],
	queries: {
		detail: {
			query: GetCustomerDetail,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							accountId: props.accountId,
							attempt: model.detailAttempt,
						},
		},
		suggestions: {
			query: GetCustomerSuggestions,
			// Asked once the accounts say which customer this is: an environment's are its primary's.
			args: ({ props, model }) =>
				props.session.organization === null || model.accounts === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							accountId: customerOfAccount(model.accounts)(props.accountId),
							attempt: model.hiddenSuggestions.length,
						},
		},
	},
})

const toast = (title: string, description: string | null = null) =>
	ShowToast.make({ toast: { ...errorToast({ title }), description } })

const success = (title: string) => ShowToast.make({ toast: successToast(title) })

/** The organization the page writes to, and who writes. */
const writerOf = (props: CustomerDetailProps) =>
	props.session.organization === null || props.session.user === null
		? null
		: { organizationId: props.session.organization.id, userId: props.session.user.id }

const isAdminOf = (props: CustomerDetailProps) =>
	props.session.member?.role === "admin" || props.session.member?.role === "owner"

const orgSlugOf = (props: CustomerDetailProps) => props.session.orgSlug ?? ""

/** The account's notes, counted for the Notes tab. */
const noteCountStream = (organizationId: OrganizationId, accountId: CustomerAccountId) =>
	withData((data) =>
		withCustomersSourceIn(data)(
			organizationId,
			data.liveQueryStream<{ readonly id: string }, CustomerDetailMessage>(
				(q) =>
					q
						.from({ note: data.collections.customerNoteCollection })
						.where(({ note }) =>
							and(
								eq(note.organizationId, organizationId),
								eq(note.accountId, accountId),
								isNull(note.deletedAt),
							),
						)
						.select(({ note }) => ({ id: note.id })),
				(rows) => CustomerDetailMessage.UpdatedNoteCount({ count: rows.length }),
			),
		),
	)

const WRITE_FAILURE = {
	owner: "Couldn't update the customer",
	tags: "Couldn't update the customer",
	mute: "Couldn't update the customer",
	regroup: "Couldn't change the customer's group",
	flags: "Couldn't change the feature flags",
} as const

const CHANNEL_FAILURE = {
	NotFound: "The channel or customer is no longer available.",
	Stale: "Threads and direct messages can't be linked to a customer.",
} as const

export const CustomerDetailPageNoDeps = CustomerDetailDef.make({
	init: () => initialModel,
	update: {
		UpdatedAccounts: ($, { accounts }) =>
			$.evolve({
				accounts: () => accounts,
				hasSeenAccount: (seen) =>
					seen || accounts.some((account) => account.id === $.props.accountId),
			}),
		UpdatedNoteCount: ($, { count }) => $.evolve({ noteCount: count }),
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		UpdatedConnectedProviders: ($, { providers }) => $.evolve({ connectedProviders: () => providers }),
		UpdatedChannelLinks: ($, { links }) => $.evolve({ channelLinks: () => links }),
		UpdatedChannelOptions: ($, { channels }) => $.evolve({ channelOptions: () => channels }),
		UpdatedChatParticipants: ($, { participants }) => $.evolve({ chatParticipants: () => participants }),
		UpdatedChatAuthors: ($, { authors }) => $.evolve({ chatAuthors: () => authors }),
		UpdatedCreatedFeatureFlags: ($, { keys }) => $.evolve({ createdFeatureFlags: () => keys }),
		PressedNeighbour: ($, { step }) => {
			const position = positionOf({ model: $.model, accountId: $.props.accountId })
			const neighbour = step === -1 ? position?.previous : position?.next
			return neighbour == null
				? $.model
				: $.run(
						Navigate.make({
							href: customerHref(orgSlugOf($.props), neighbour.id, $.props.tab),
							replace: false,
						}),
					)
		},
		PressedToggleSidebar: ($) => $.evolve({ isSidebarOpen: (isOpen) => !isOpen }),
		PressedRetryDetail: ($) => $.evolve({ detailAttempt: (attempt) => attempt + 1 }),
		SelectedTab: ($, { tab }) =>
			tab === $.props.tab
				? $.model
				: $.run(
						Navigate.make({
							href: customerHref(orgSlugOf($.props), $.props.accountId, tab),
							replace: false,
						}),
					),
		// HAZEL-GAP(pk5-focus-composer): today's Add note also focuses the notes tab's composer,
		// which is the host's until PK6b.
		PressedAddNote: ($) =>
			$.run(
				Navigate.make({
					href: customerHref(orgSlugOf($.props), $.props.accountId, "notes"),
					replace: false,
				}),
			),
		SelectedOwner: ($, { id }) => {
			const writer = writerOf($.props)
			const member = $.model.members.find((entry) => entry.id === userIdOfOwnerKey(id))
			const ownerUserId = id === OWNER_NONE ? null : (member?.id ?? undefined)
			if (writer === null || ownerUserId === undefined) return $.model
			return $.evolve({
				accounts: (accounts) =>
					accounts?.map((account) =>
						account.id === $.props.accountId ? { ...account, ownerUserId } : account,
					) ?? null,
			}).run(
				UpdateCustomerAccount.make({
					organizationId: writer.organizationId,
					accountId: $.props.accountId,
					ownerUserId,
				}),
			)
		},
		SelectedAction: ($, { id }) => {
			const writer = writerOf($.props)
			const state = { model: $.model, accountId: $.props.accountId }
			const account = accountOf(state)
			if (writer === null || account === undefined) return $.model
			const target = { organizationId: writer.organizationId, accountId: $.props.accountId }
			const mute = (untilMs: number | null, label: string | null) =>
				$.evolve({
					accounts: (accounts) =>
						accounts?.map((row) =>
							row.id === account.id
								? {
										...row,
										attentionMutedAtMs: label === null ? null : $.props.nowMs,
										attentionMutedUntilMs: label === null ? null : untilMs,
										attentionMutedByUserId: label === null ? null : writer.userId,
									}
								: row,
						) ?? null,
				})
					.run(
						SetAttentionMute.make({
							...target,
							userId: writer.userId,
							mute: label === null ? null : { untilMs },
						}),
					)
					.run(
						success(
							label === null
								? "Back in Needs attention"
								: `Muted in Needs attention ${label.toLowerCase()}`,
						),
					)
			if (isMuteKey(id)) return mute(muteUntilMs(id, $.props.nowMs), MUTE_LABEL[id])
			const regroup = (change: "make_primary" | "unlink") =>
				primaryOf(state) === null
					? $.model
					: $.evolve({
							accounts: (accounts) =>
								accounts === null
									? null
									: (change === "make_primary" ? madePrimary : unlinked)(
											accounts,
											account.id,
										),
						}).run(RegroupAccount.make({ ...target, change }))
			const key = ActionKey.literals.find((literal) => literal === id)
			return key === undefined
				? $.model
				: Match.value(key).pipe(
						Match.when("unmute_attention", () => mute(null, null)),
						Match.when("copy_link", () =>
							$.run(
								CopyText.make({
									text: customerHref(orgSlugOf($.props), $.props.accountId),
									label: "Link",
									isPath: true,
								}),
							),
						),
						Match.when("raw_data", () =>
							$.run(
								OpenModal.make({
									modal: {
										_tag: "CustomerRawData",
										json: JSON.stringify(
											{
												account:
													$.queries.detail._tag === "Success"
														? $.queries.detail.value.account
														: account,
												refs:
													$.queries.detail._tag === "Success"
														? $.queries.detail.value.refs
														: [],
											},
											null,
											2,
										),
									},
								}),
							),
						),
						Match.when("link_customer", () =>
							$.run(OpenModal.make({ modal: { _tag: "CustomerLink", ...target } })),
						),
						Match.when("name_environment", () =>
							$.run(
								OpenModal.make({
									modal: {
										_tag: "CustomerEnvironment",
										...target,
										name: account.name,
										environment: account.environment,
									},
								}),
							),
						),
						Match.when("make_primary", () => regroup("make_primary")),
						Match.when("unlink", () => regroup("unlink")),
						// HAZEL-GAP(pk5-menu-open): today's "Change owner…" opens the owner menu; a
						// `menu` has no open prop, so it does nothing here.
						Match.orElse(() => $.model),
					)
		},
		SelectedEnvironment: ($, { id }) => {
			const target = groupOfState({ model: $.model, accountId: $.props.accountId }).find(
				(account) => account.id === id,
			)
			return target === undefined || target.id === $.props.accountId
				? $.model
				: $.run(Navigate.make({ href: customerHref(orgSlugOf($.props), target.id), replace: false }))
		},
		PressedRemoveTag: ($, { tag }) => {
			const account = accountOf({ model: $.model, accountId: $.props.accountId })
			return account === undefined
				? $.model
				: $.combine(setTags(account.tags.filter((entry) => entry !== tag)))
		},
		PressedAddTag: ($) => $.evolve({ isTagPickerOpen: (isOpen) => !isOpen }),
		DismissedTagPicker: ($) => $.evolve({ isTagPickerOpen: false, tagInput: TextField.empty }),
		ChangedTagInput: ($, { payload }) =>
			$.evolve({ tagInput: (field) => TextField.changed(field, payload) }),
		SubmittedTag: ($, { payload }) =>
			$.combine(submitTag(TextField.changed($.model.tagInput, payload).text)),
		PressedSaveTag: ($) => $.combine(submitTag($.model.tagInput.text)),
		PressedRefreshCompany: ($) => {
			const writer = writerOf($.props)
			const checkedAtMs =
				accountOf({ model: $.model, accountId: $.props.accountId })?.companyCheckedAtMs ?? null
			if (writer === null || isCompanyRefreshPending($.model, $.props.nowMs, checkedAtMs))
				return $.model
			return $.evolve({
				companyRefreshAtMs: $.props.nowMs,
				companyCheckedAtPressMs: checkedAtMs,
			}).run(
				RefreshCompany.make({ organizationId: writer.organizationId, accountId: $.props.accountId }),
			)
		},
		PressedChangeDomain: ($, { domain }) =>
			$.evolve({
				domain: { field: TextField.set(TextField.empty, domain), editing: domain, isSaving: false },
			}),
		PressedCancelDomain: ($) =>
			$.model.domain.isSaving
				? $.model
				: $.evolve({ domain: { field: TextField.empty, editing: null, isSaving: false } }),
		ChangedDomain: ($, { payload }) =>
			$.evolve({
				domain: (domain) => ({ ...domain, field: TextField.changed(domain.field, payload) }),
			}),
		SubmittedDomain: ($, { payload }) =>
			$.combine(submitDomain(TextField.changed($.model.domain.field, payload))),
		PressedSaveDomain: ($) => $.combine(submitDomain($.model.domain.field)),
		SucceededAddDomain: ($) =>
			$.evolve({ domain: { field: TextField.empty, editing: null, isSaving: false } }),
		FailedAddDomain: ($, { message }) =>
			$.evolve({ domain: (domain) => ({ ...domain, isSaving: false }) }).run(
				toast(
					$.model.domain.editing === null
						? "Couldn't add the domain"
						: "Couldn't change the domain",
					message,
				),
			),
		FailedCompanyRefresh: ($, { message }) =>
			$.evolve({ companyRefreshAtMs: null }).run(toast("Couldn't look up the company", message)),
		PressedLinkChannelPicker: ($) => $.evolve({ isChannelPickerOpen: (isOpen) => !isOpen }),
		DismissedChannelPicker: ($) =>
			$.evolve({ isChannelPickerOpen: false, channelSearch: TextField.empty }),
		ChangedChannelSearch: ($, { payload }) =>
			$.evolve({ channelSearch: (field) => TextField.changed(field, payload) }),
		PressedLinkChannel: ($, { channelId }) => {
			const writer = writerOf($.props)
			const closed = $.evolve({ isChannelPickerOpen: false, channelSearch: TextField.empty })
			return writer === null
				? closed
				: closed.run(
						WriteChannelLink.make({
							organizationId: writer.organizationId,
							channelId,
							// Stored on the customer's primary, as the server does.
							link: {
								accountId: customerOfAccount($.model.accounts)($.props.accountId),
								userId: writer.userId,
							},
						}),
					)
		},
		PressedUnlinkChannel: ($, { channelId }) => {
			const writer = writerOf($.props)
			return writer === null
				? $.model
				: $.run(
						WriteChannelLink.make({
							organizationId: writer.organizationId,
							channelId,
							link: null,
						}),
					)
		},
		FailedChannelWrite: ($, { action, reason }) =>
			$.run(
				toast(
					action === "link" ? "Couldn't link the channel" : "Couldn't unlink the channel",
					reason === "NotFound" || reason === "Stale" ? CHANNEL_FAILURE[reason] : null,
				),
			),
		PressedAcceptSuggestion: ($, { suggestionId }) => $.combine(actOnSuggestion(suggestionId, "accept")),
		PressedDismissSuggestion: ($, { suggestionId }) =>
			$.combine(actOnSuggestion(suggestionId, "dismiss")),
		FailedSuggestionAction: ($, { suggestionId, action }) =>
			$.evolve({ hiddenSuggestions: (hidden) => hidden.filter((id) => id !== suggestionId) }).run(
				toast(action === "accept" ? "Couldn't link the channel" : "Couldn't dismiss the suggestion"),
			),
		SelectedChatPersonEntry: ($, { userId, id }) => {
			const writer = writerOf($.props)
			const pick = ChatPersonKey.literals.find((literal) => literal === id)
			return writer === null || pick === undefined
				? $.model
				: $.run(
						SetChatPersonSide.make({
							organizationId: writer.organizationId,
							userId: UserId.make(userId),
							side: CHAT_PERSON_SIDE[pick],
							by: writer.userId,
						}),
					)
		},
		FailedChatPersonSide: ($) => $.run(toast("Couldn't change their side")),
		PressedAddFlagsPicker: ($) =>
			$.evolve({ isFlagPickerOpen: (isOpen) => !isOpen, flagSelection: () => [] }),
		// Closed without adding: the ticks are dropped, so the next open starts clean.
		DismissedFlagPicker: ($) => $.evolve({ isFlagPickerOpen: false, flagSelection: () => [] }),
		ToggledFlag: ($, { key, checked }) =>
			$.evolve({
				flagSelection: (selection) =>
					checked ? [...selection, key] : selection.filter((entry) => entry !== key),
			}),
		PressedAddFlags: ($) => {
			const writer = writerOf($.props)
			// A flag deleted since it was ticked is gone from the list: setting it would bring it back.
			const live = featureFlagKeysOf($.model.createdFeatureFlags, $.model.accounts ?? [])
			const keys = $.model.flagSelection.filter((key) => live.includes(key))
			const closed = $.evolve({ isFlagPickerOpen: false, flagSelection: () => [] })
			return writer === null || keys.length === 0
				? closed
				: closed.run(
						SetFeatureFlags.make({
							organizationId: writer.organizationId,
							accountId: $.props.accountId,
							keys,
							enabled: true,
						}),
					)
		},
		PressedRemoveFlag: ($, { key }) => {
			const writer = writerOf($.props)
			return writer === null
				? $.model
				: $.run(
						SetFeatureFlags.make({
							organizationId: writer.organizationId,
							accountId: $.props.accountId,
							keys: [key],
							enabled: false,
						}),
					)
		},
		PressedCopy: ($, { text, label }) => $.run(CopyText.make({ text, label })),
		SucceededCopy: ($, { label }) => $.run(success(`${label} copied`)),
		FailedCopy: ($) => $.run(toast("Couldn't copy", "Your browser blocked the clipboard.")),
		FailedAccountWrite: ($, { write, message }) => $.run(toast(WRITE_FAILURE[write], message)),
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? ""
		const org = (make: (id: OrganizationId) => Stream.Stream<CustomerDetailMessage, never, ClientData>) =>
			organizationId === "" ? Stream.empty : make(OrganizationId.make(organizationId))
		return [
			Subscription.make("accounts", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeCustomerQueries(data).accountsStream(id, (accounts) =>
							CustomerDetailMessage.UpdatedAccounts({ accounts }),
						),
					),
				),
			),
			Subscription.make("notes", [organizationId, props.accountId], ([, accountId]) =>
				org((id) => noteCountStream(id, CustomerAccountId.make(accountId))),
			),
			Subscription.make("members", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeCustomerQueries(data).orgMembersStream(id, (members) =>
							CustomerDetailMessage.UpdatedMembers({ members }),
						),
					),
				),
			),
			Subscription.make("providers", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeCustomerQueries(data).connectedProvidersStream(id, (providers) =>
							CustomerDetailMessage.UpdatedConnectedProviders({ providers }),
						),
					),
				),
			),
			Subscription.make("flags", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeCustomerQueries(data).createdFeatureFlagsStream(id, (keys) =>
							CustomerDetailMessage.UpdatedCreatedFeatureFlags({ keys }),
						),
					),
				),
			),
			Subscription.make("channelLinks", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeChannelData(data).channelLinksStream(id, (links) =>
							CustomerDetailMessage.UpdatedChannelLinks({ links }),
						),
					),
				),
			),
			Subscription.make("channelOptions", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeChannelData(data).channelOptionsStream(id, (channels) =>
							CustomerDetailMessage.UpdatedChannelOptions({ channels }),
						),
					),
				),
			),
			Subscription.make("chatParticipants", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeChatAuthorData(data).chatParticipantsStream(id, (participants) =>
							CustomerDetailMessage.UpdatedChatParticipants({ participants }),
						),
					),
				),
			),
			Subscription.make("chatAuthors", [organizationId], () =>
				org((id) =>
					withData((data) =>
						makeChatAuthorData(data).chatAuthorsStream(id, (authors) =>
							CustomerDetailMessage.UpdatedChatAuthors({ authors }),
						),
					),
				),
			),
		]
	},
	view: (h, model) => {
		const props = h.props
		const orgSlug = orgSlugOf(props)
		const state = { model, accountId: props.accountId }
		const account = accountOf(state) ?? null
		const detailResult = h.queries.detail
		const detail: Customers.AccountDetail | null =
			detailResult._tag === "Success" ? detailResult.value : null
		const failure =
			detailResult._tag === "Failure"
				? Option.getOrUndefined(Cause.findErrorOption(detailResult.cause))
				: undefined
		const detailState = detail !== null ? "Loaded" : failure === undefined ? "Loading" : failure
		const owner =
			account?.ownerUserId == null
				? null
				: (model.members.find((member) => member.id === account.ownerUserId) ?? null)
		const hasSidebar = model.isSidebarOpen && props.tab !== "users" && !props.isMobile
		const inputs: HeaderInputs = {
			model,
			accountId: props.accountId,
			orgSlug,
			tab: props.tab,
			account,
			owner,
			isAdmin: isAdminOf(props),
			isMobile: props.isMobile,
			hasSidebar,
		}
		const bar = topBar(h, inputs)
		const screen = h.screen
			.key("customer")
			.surface("detail")
			.crumbs(bar.crumbs)
			.toolbar(...bar.toolbar)
		if (isNotFound(state, detailState))
			return screen.children(
				h.emptyState
					.title("Customer not found")
					.description("It was merged, archived or never existed in this workspace.")
					.action(h.link.label("Back to customers").href(customersListHref(orgSlug))),
			)
		if (account === null)
			return screen.children(
				failure === "Other"
					? h.emptyState
							.title("Couldn't load this customer")
							.description("Check your connection and try again.")
							.action(
								h.button
									.label("Try again")
									.icon("refresh")
									.variant("outline")
									.size("small")
									.on("press", CustomerDetailMessage.PressedRetryDetail()),
							)
					: h.progress.style("spinner").label("Loading customer..."),
			)
		const panel = sidebar(h, {
			model,
			account,
			detail,
			suggestions: h.queries.suggestions._tag === "Success" ? h.queries.suggestions.value : null,
			owner,
			orgSlug,
			nowMs: props.nowMs,
			isAdmin: isAdminOf(props),
		})
		// A phone's page scrolls as a whole (the frame's column), so nothing in it is squeezed.
		const main = (props.isMobile ? h.stack.key("main") : h.scroll.key("main")).children(
			h.stack
				.inset("page")
				.density("relaxed")
				.children(
					header(h, inputs, account),
					tabs(h, inputs, account),
					failure === "Other" && detail === null
						? h.banner
								.tone("warning")
								.description("Couldn't load this customer's details.")
								.actions(
									h.button
										.label("Try again")
										.variant("outline")
										.size("xsmall")
										.on("press", CustomerDetailMessage.PressedRetryDetail()),
								)
						: null,
					h.slots.tab,
					props.isMobile && props.tab === "overview"
						? h.frame.key("stacked").children(panel)
						: null,
				),
		)
		// HAZEL-GAP(pk5-detail-stack-tablet): below lg today the panel stacks under the tab and both
		// scroll as one; `splitView`'s detail turns into a sheet below md instead.
		return screen.children(
			hasSidebar
				? h.splitView
						.key("split")
						.detailWidth(320)
						.children(main)
						.detail(h.scroll.key("panel").children(panel))
				: main,
		)
	},
})

/** The account's tags written at once, then by the RPC. */
const withTags = (
	$: { readonly model: CustomerDetailModel; readonly props: CustomerDetailProps },
	tags: ReadonlyArray<string>,
) => ({
	accounts: (accounts: CustomerDetailModel["accounts"]) =>
		accounts?.map((account) => (account.id === $.props.accountId ? { ...account, tags } : account)) ??
		null,
})

const tagsCommand = (props: CustomerDetailProps, tags: ReadonlyArray<string>) => {
	const writer = writerOf(props)
	return writer === null
		? null
		: UpdateCustomerAccount.make({
				organizationId: writer.organizationId,
				accountId: props.accountId,
				tags,
			})
}

const setTags = (tags: ReadonlyArray<string>) =>
	CustomerDetailDef.update(($) => {
		const command = tagsCommand($.props, tags)
		return command === null ? $.model : $.evolve(withTags($, tags)).run(command)
	})

/** Adds the typed tag, once: an empty or present one just closes the picker. */
const submitTag = (raw: string) =>
	CustomerDetailDef.update(($) => {
		const tag = raw.trim()
		const account = accountOf({ model: $.model, accountId: $.props.accountId })
		const closed = { isTagPickerOpen: false, tagInput: TextField.empty }
		if (account === undefined || tag === "" || account.tags.includes(tag)) return $.evolve(closed)
		const tags = [...account.tags, tag]
		const command = tagsCommand($.props, tags)
		return command === null
			? $.evolve(closed)
			: $.evolve({ ...closed, ...withTags($, tags) }).run(command)
	})

/** Saves the domain; an unchanged one just closes the edit. */
const submitDomain = (field: TextField.State) =>
	CustomerDetailDef.update(($) => {
		const writer = writerOf($.props)
		const domain = field.text.trim()
		const { editing, isSaving } = $.model.domain
		if (writer === null || domain === "" || isSaving)
			return $.evolve({ domain: (form) => ({ ...form, field }) })
		if (editing !== null && domain.toLowerCase() === editing)
			return $.evolve({ domain: { field: TextField.empty, editing: null, isSaving: false } })
		const target = {
			organizationId: writer.organizationId,
			accountId: $.props.accountId,
			addDomain: domain,
		}
		return $.evolve({ domain: { field, editing, isSaving: true } }).run(
			editing === null
				? AddCustomerDomain.make(target)
				: AddCustomerDomain.make({ ...target, removeDomain: editing }),
		)
	})

/** The row leaves at once; a failure brings it back. */
const actOnSuggestion = (suggestionId: Customers.ChannelSuggestion["id"], action: "accept" | "dismiss") =>
	CustomerDetailDef.update(($) => {
		const writer = writerOf($.props)
		if (writer === null || $.model.hiddenSuggestions.includes(suggestionId)) return $.model
		return $.evolve({ hiddenSuggestions: (hidden) => [...hidden, suggestionId] }).run(
			ActOnSuggestion.make({ organizationId: writer.organizationId, suggestionId, action }),
		)
	})

/** The page with its reads and writes, on the host's data, RPC client and clipboard. */
export const CustomerDetailPage = CustomerDetailPageNoDeps.pipe(Component.provide(customerDetailLayer))
