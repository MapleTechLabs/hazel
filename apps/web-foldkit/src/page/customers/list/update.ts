import type * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { commonMessage, failureMessage } from "~/lib/error-messages"
import type { AccountRow } from "../../../customers/queries"
import { errorToastOf, successToast } from "../../../data/actions"
import { AppRoute, customerRoute, customersListRoute, type RouteOf } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { Popover as PopoverControl } from "@foldkit/ui"
import * as Popover from "../../../ui/popover"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import {
	BulkAddTag,
	BulkAssignOwner,
	CreateSavedView,
	DeleteSavedView,
	ExportCustomersCsv,
	FetchListSparklines,
	FocusListSearch,
	UpdateSavedView,
	WaitBeforeHoverCard,
} from "./commands"
import { Message, type ViewAction } from "./message"
import {
	activeFields,
	canUpdateView,
	clearField,
	COLUMNS_POPOVER_ID,
	currentTab,
	type Draft,
	FILTER_POPOVER_ID,
	type ListKey,
	keepVisibleSelection,
	missingSparklines,
	type Model,
	moveColumn,
	nextSort,
	OWNER_ME,
	OWNER_MENU_ID,
	OWNER_NONE,
	parseSortKey,
	ROW_PAGE,
	SAVE_MODAL_ID,
	sameDraft,
	SORT_MENU_ID,
	shownColumns,
	TAG_POPOVER_ID,
	toggleColumn,
	userIdOfOwnerKey,
	VIEW_MENU_ID,
	ViewMenuKey,
	type Viewer,
	visibleAccounts,
} from "./model"
import { toCsv } from "./table"

type Return = PageReturn<Model, Message>
type Commands = NonNullable<Return["commands"]>
type Route = RouteOf<"CustomersList">

export const viewerOf = (shared: Shared): Viewer => ({
	userId: shared.currentUser?.id ?? null,
	nowMs: shared.nowMs,
	isAdmin: shared.member?.role === "admin" || shared.member?.role === "owner",
})

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

// INIT

export const init = (route: Route): Return => {
	const view = Option.getOrNull(route.view)
	return {
		model: {
			view,
			draft: currentTab({ view, views: null }).draft,
			search: "",
			accounts: null,
			signals: null,
			views: null,
			members: [],
			connectedProviders: null,
			lastComputedAtMs: null,
			reportingCurrency: "USD",
			sparklines: {},
			requestedSparklines: [],
			selected: [],
			rowLimit: ROW_PAGE,
			focusedId: null,
			hoverPendingId: null,
			hoveredId: null,
			builder: null,
			filterPopover: Popover.init(FILTER_POPOVER_ID),
			columnsPopover: Popover.init(COLUMNS_POPOVER_ID),
			tagPopover: Popover.init(TAG_POPOVER_ID),
			tagInput: "",
			sortMenu: Menu.init({ id: SORT_MENU_ID, placement: "bottom end", selectionMode: "Single" }),
			viewMenu: Menu.init({ id: VIEW_MENU_ID, placement: "bottom end" }),
			ownerMenu: Menu.init({ id: OWNER_MENU_ID, placement: "top start" }),
			saveModal: Modal.init(SAVE_MODAL_ID),
			saveForm: null,
		},
	}
}

/** Another view: its filters, sort and columns replace the draft; the selection goes. */
export const routeChanged = (model: Model, route: Route): Return => {
	const view = Option.getOrNull(route.view)
	if (view === model.view) return { model }
	return {
		model: modifyFields(model, {
			view: () => view,
			draft: () => currentTab({ view, views: model.views }).draft,
			selected: () => [],
			rowLimit: () => ROW_PAGE,
			focusedId: () => null,
			builder: () => null,
		}),
	}
}

// SPARKLINES

/** Asks for the next batch of sparklines the table shows but does not have. */
const withSparklines = (result: Return, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	const accountIds = missingSparklines(result.model, viewerOf(shared))
	if (organizationId === undefined || accountIds.length === 0) return result
	return {
		...result,
		model: modifyFields(result.model, {
			requestedSparklines: (requested) => [...requested, ...accountIds],
		}),
		commands: [...(result.commands ?? []), FetchListSparklines({ organizationId, accountIds })],
	}
}

/** Other rows show: back to the first page of them, and the selection keeps only what still shows. */
const withRows = (model: Model, shared: Shared): Return =>
	withSparklines(
		{ model: keepVisibleSelection(modifyFields(model, { rowLimit: () => ROW_PAGE }), viewerOf(shared)) },
		shared,
	)

const withDraft = (model: Model, shared: Shared, change: (draft: Draft) => Draft): Return =>
	withRows(modifyFields(model, { draft: change }), shared)

// VIEWS

const navigateToView = (model: Model, shared: Shared, key: string | null): Return => ({
	model,
	outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) => customersListRoute(orgSlug, key)),
})

const viewDraftOf = (name: string, draft: Draft): Customers.ViewDraft => ({
	name,
	filters: draft.filters,
	sort: draft.sort,
	columns: shownColumns(draft.columns),
})

const openSaveModal = (model: Model, mode: "create" | "rename"): Return => ({
	model: modifyFields(model, {
		saveForm: () => ({ mode, name: mode === "rename" ? currentTab(model).name : "", isShared: false }),
		saveModal: (modal) => Modal.open(modal).model,
	}),
})

const closeSaveModal = (model: Model): Model =>
	modifyFields(model, { saveForm: () => null, saveModal: (modal) => Modal.close(modal).model })

const submitSave = (model: Model, shared: Shared): Return => {
	const form = model.saveForm
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	const name = form?.name.trim() ?? ""
	if (form === null || name === "" || organizationId === undefined || userId === undefined) return { model }
	const tab = currentTab(model)
	if (form.mode === "rename" && tab.row !== null)
		return {
			model: closeSaveModal(model),
			commands: [
				UpdateSavedView({ organizationId, viewId: tab.row.id, view: viewDraftOf(name, tab.draft) }),
			],
		}
	const position = Math.max(0, ...(model.views ?? []).map((view) => view.position)) + 1
	return {
		model: closeSaveModal(model),
		commands: [
			CreateSavedView({
				organizationId,
				userId,
				view: viewDraftOf(name, model.draft),
				isShared: form.isShared && viewerOf(shared).isAdmin,
				position,
			}),
		],
	}
}

const onViewMenu = (model: Model, shared: Shared, key: string): Return => {
	const tab = currentTab(model)
	const organizationId = shared.organization?.id
	const menuKey = ViewMenuKey.literals.find((literal) => literal === key)
	switch (menuKey) {
		case "save":
			return tab.row === null || organizationId === undefined || !canUpdateView(tab, viewerOf(shared))
				? { model }
				: {
						model,
						commands: [
							UpdateSavedView({
								organizationId,
								viewId: tab.row.id,
								view: viewDraftOf(tab.name, model.draft),
							}),
						],
					}
		case "save_as":
			return openSaveModal(model, "create")
		case "rename":
			return openSaveModal(model, "rename")
		case "reset":
			return withDraft(model, shared, () => tab.draft)
		case "delete":
			return tab.row === null || organizationId === undefined
				? { model }
				: {
						...navigateToView(model, shared, null),
						commands: [DeleteSavedView({ organizationId, viewId: tab.row.id })],
					}
		case undefined:
			return { model }
	}
}

const VIEW_VERB = { create: "save", update: "update", delete: "delete" } as const satisfies Record<
	ViewAction,
	string
>

// BULK

const patchAccounts = (
	model: Model,
	accountIds: ReadonlyArray<CustomerAccountId>,
	patch: (account: AccountRow) => AccountRow,
): Model => {
	const ids = new Set<string>(accountIds)
	return modifyFields(model, {
		accounts: (accounts) =>
			accounts?.map((account) => (ids.has(account.id) ? patch(account) : account)) ?? null,
	})
}

const assignOwner = (model: Model, shared: Shared, key: string): Return => {
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	if (organizationId === undefined || userId === undefined || model.selected.length === 0) return { model }
	const member = model.members.find((entry) => entry.id === userIdOfOwnerKey(key))
	const owner: { readonly id: UserId | null; readonly label: string } | undefined =
		key === OWNER_ME
			? { id: userId, label: "you" }
			: key === OWNER_NONE
				? { id: null, label: "nobody" }
				: member === undefined
					? undefined
					: { id: member.id, label: member.name }
	if (owner === undefined) return { model }
	return {
		model: patchAccounts(model, model.selected, (account) => ({ ...account, ownerUserId: owner.id })),
		commands: [
			BulkAssignOwner({
				organizationId,
				accountIds: model.selected,
				ownerUserId: owner.id,
				label: owner.label,
			}),
		],
	}
}

const addTag = (model: Model, shared: Shared, raw: string): Return => {
	const organizationId = shared.organization?.id
	const tag = raw.trim()
	const closed = modifyFields(model, {
		tagInput: () => "",
		tagPopover: (popover) => PopoverControl.close(popover).model,
	})
	if (organizationId === undefined || tag === "" || model.selected.length === 0) return { model: closed }
	return {
		model: patchAccounts(closed, model.selected, (account) => ({
			...account,
			tags: account.tags.includes(tag) ? account.tags : [...account.tags, tag],
		})),
		commands: [BulkAddTag({ organizationId, accountIds: model.selected, tag })],
	}
}

const exportCsv = (model: Model, shared: Shared, scope: "all" | "selected"): Return => {
	const viewer = viewerOf(shared)
	const selected = new Set<string>(model.selected)
	const rows = visibleAccounts(model, viewer).filter(
		(account) => scope === "all" || selected.has(account.id),
	)
	const csv = toCsv(rows, shownColumns(model.draft.columns), {
		membersById: new Map(model.members.map((member) => [member.id, member])),
		nowMs: shared.nowMs,
	})
	const day = new Date(shared.nowMs).toISOString().slice(0, 10)
	return { model, commands: [ExportCustomersCsv({ filename: `customers-${day}.csv`, csv })] }
}

// MENUS AND POPOVERS

type MenuField = "sortMenu" | "viewMenu" | "ownerMenu"
type MenuCommands = NonNullable<ReturnType<typeof Menu.update>["commands"]>

const mapMenuCommands = (field: MenuField, commands: MenuCommands): Commands => {
	switch (field) {
		case "sortMenu":
			return Command.mapMessages(commands, (message) => Message.GotSortMenuMessage({ message }))
		case "viewMenu":
			return Command.mapMessages(commands, (message) => Message.GotViewMenuMessage({ message }))
		case "ownerMenu":
			return Command.mapMessages(commands, (message) => Message.GotOwnerMenuMessage({ message }))
	}
}

const updateMenu = (
	model: Model,
	field: MenuField,
	message: Menu.Message,
	onSelect: (model: Model, key: string) => Return,
): Return => {
	const result = Menu.update(model[field], message)
	const next = { ...model, [field]: result.model }
	const picked =
		result.outMessage?._tag === "SelectedItem" ? onSelect(next, result.outMessage.key) : { model: next }
	return {
		...picked,
		commands: [...mapMenuCommands(field, result.commands ?? []), ...(picked.commands ?? [])],
	}
}

type PopoverField = "filterPopover" | "columnsPopover" | "tagPopover"
type PopoverResult = ReturnType<typeof Popover.update>

const mapPopoverCommands = (
	field: PopoverField,
	commands: NonNullable<PopoverResult["commands"]>,
): Commands => {
	switch (field) {
		case "filterPopover":
			return Command.mapMessages(commands, (message) => Message.GotFilterPopoverMessage({ message }))
		case "columnsPopover":
			return Command.mapMessages(commands, (message) => Message.GotColumnsPopoverMessage({ message }))
		case "tagPopover":
			return Command.mapMessages(commands, (message) => Message.GotTagPopoverMessage({ message }))
	}
}

/** Folds a popover step; the filter builder starts on open and ends on close. */
const withPopover = (model: Model, field: PopoverField, result: PopoverResult): Return => {
	const out = result.outMessage?._tag
	const next = { ...model, [field]: result.model }
	return {
		model:
			field !== "filterPopover"
				? next
				: out === "Closed"
					? modifyFields(next, { builder: () => null })
					: out === "Opened" && next.builder === null
						? modifyFields(next, {
								builder: () => ({
									field: activeFields(next.draft.filters)[0] ?? "stage",
									pending: next.draft.filters,
								}),
							})
						: next,
		commands: mapPopoverCommands(field, result.commands ?? []),
	}
}

// KEYBOARD AND HOVER

const openCustomer = (model: Model, shared: Shared, accountId: CustomerAccountId): Return => ({
	model,
	outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) => customerRoute(orgSlug, accountId)),
})

const move = (model: Model, shared: Shared, step: 1 | -1): Return => {
	const ids = visibleAccounts(model, viewerOf(shared)).map((account) => account.id)
	if (ids.length === 0) return { model }
	const index = model.focusedId === null ? -1 : ids.indexOf(model.focusedId)
	const next = index < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, index + step))
	return {
		model: modifyFields(model, {
			focusedId: () => ids[next] ?? null,
			// The cursor walking past the rendered rows renders the next page.
			rowLimit: (limit) => (next < limit ? limit : limit + ROW_PAGE),
		}),
	}
}

const toggleSelected = (model: Model, accountId: CustomerAccountId, isSelected: boolean): Model =>
	modifyFields(model, {
		selected: (selected) =>
			isSelected
				? selected.includes(accountId)
					? selected
					: [...selected, accountId]
				: selected.filter((id) => id !== accountId),
	})

const onKey = (model: Model, shared: Shared, key: ListKey): Return => {
	switch (key) {
		case "next":
			return withSparklines(move(model, shared, 1), shared)
		case "previous":
			return move(model, shared, -1)
		case "open":
			return model.focusedId === null ? { model } : openCustomer(model, shared, model.focusedId)
		case "select":
			return model.focusedId === null
				? { model }
				: { model: toggleSelected(model, model.focusedId, !model.selected.includes(model.focusedId)) }
		case "search":
			return { model, commands: [FocusListSearch()] }
		case "escape":
			return model.selected.length > 0
				? { model: modifyFields(model, { selected: () => [] }) }
				: { model: modifyFields(model, { focusedId: () => null }) }
	}
}

// UPDATE

const PARTLY_SAVED = "Part of the selection was saved before it stopped; the list shows which."

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedAccounts: ({ accounts }) =>
			withSparklines(
				{
					model: keepVisibleSelection(
						modifyFields(model, { accounts: () => accounts }),
						viewerOf(shared),
					),
				},
				shared,
			),
		UpdatedSignals: ({ signals }) => ({ model: modifyFields(model, { signals: () => signals }) }),
		UpdatedViews: ({ views }) => {
			// Unedited, the draft follows its view (it synced, or someone changed it).
			const wasEdited = !sameDraft(model.draft, currentTab(model).draft)
			const next = modifyFields(model, { views: () => views })
			return withSparklines(
				{ model: wasEdited ? next : modifyFields(next, { draft: () => currentTab(next).draft }) },
				shared,
			)
		},
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		UpdatedConnectedProviders: ({ providers }) => ({
			model: modifyFields(model, { connectedProviders: () => providers }),
		}),
		UpdatedSettings: ({ lastComputedAtMs, reportingCurrency }) => ({
			model: modifyFields(model, {
				lastComputedAtMs: () => lastComputedAtMs,
				reportingCurrency: () => reportingCurrency,
			}),
		}),

		ClickedViewTab: ({ key }) => navigateToView(model, shared, key),
		ChangedSearch: ({ value }) => withRows(modifyFields(model, { search: () => value }), shared),
		ClearedSearch: () => withRows(modifyFields(model, { search: () => "" }), shared),
		ClickedSortHeader: ({ column }) =>
			withDraft(model, shared, (draft) => ({ ...draft, sort: nextSort(draft.sort, column) })),
		ClearedFilter: ({ field }) =>
			withDraft(model, shared, (draft) => ({ ...draft, filters: clearField(draft.filters, field) })),
		ClearedFilters: () =>
			withDraft(modifyFields(model, { search: () => "" }), shared, (draft) => ({
				...draft,
				filters: {},
			})),

		PressedEditFilter: ({ field }) => {
			const opened = PopoverControl.open(model.filterPopover)
			return {
				model: modifyFields(model, {
					filterPopover: () => opened.model,
					builder: () => ({ field, pending: model.draft.filters }),
				}),
				commands: mapPopoverCommands("filterPopover", opened.commands ?? []),
			}
		},
		ClickedBuilderField: ({ field }) => ({
			model: modifyFields(model, {
				builder: (builder) => (builder === null ? null : { ...builder, field }),
			}),
		}),
		ChangedPendingFilters: ({ filters }) => ({
			model: modifyFields(model, {
				builder: (builder) => (builder === null ? null : { ...builder, pending: filters }),
			}),
		}),
		AppliedFilter: () => {
			const pending = model.builder?.pending
			if (pending === undefined) return { model }
			const closed = withPopover(model, "filterPopover", PopoverControl.close(model.filterPopover))
			const applied = withDraft(closed.model, shared, (draft) => ({ ...draft, filters: pending }))
			return { ...applied, commands: [...(closed.commands ?? []), ...(applied.commands ?? [])] }
		},
		GotFilterPopoverMessage: ({ message: popoverMessage }) =>
			withPopover(model, "filterPopover", Popover.update(model.filterPopover, popoverMessage)),

		GotColumnsPopoverMessage: ({ message: popoverMessage }) =>
			withPopover(model, "columnsPopover", Popover.update(model.columnsPopover, popoverMessage)),
		ToggledColumn: ({ column, isShown }) =>
			withDraft(model, shared, (draft) => ({
				...draft,
				columns: toggleColumn(draft.columns, column, isShown),
			})),
		MovedColumn: ({ column, step }) =>
			withDraft(model, shared, (draft) => ({
				...draft,
				columns: moveColumn(draft.columns, column, step),
			})),
		ResetColumns: () =>
			withDraft(model, shared, (draft) => ({ ...draft, columns: currentTab(model).draft.columns })),

		GotSortMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "sortMenu", menuMessage, (next, key) => {
				const sort = parseSortKey(key)
				return sort === null
					? { model: next }
					: withDraft(next, shared, (draft) => ({ ...draft, sort }))
			}),
		GotViewMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "viewMenu", menuMessage, (next, key) => onViewMenu(next, shared, key)),
		PressedSaveView: () => openSaveModal(model, "create"),
		GotSaveModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.saveModal, modalMessage)
			return {
				model: modifyFields(model, {
					saveModal: () => result.model,
					saveForm: (form) => (result.outMessage?._tag === "Closed" ? null : form),
				}),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotSaveModalMessage({ message: child }),
				),
			}
		},
		ChangedSaveName: ({ value }) => ({
			model: modifyFields(model, {
				saveForm: (form) => (form === null ? null : { ...form, name: value }),
			}),
		}),
		ToggledSaveShared: ({ isShared }) => ({
			model: modifyFields(model, {
				saveForm: (form) => (form === null ? null : { ...form, isShared }),
			}),
		}),
		SubmittedSave: () => submitSave(model, shared),
		SucceededViewAction: ({ action, viewId }) =>
			action === "create"
				? navigateToView(model, shared, viewId)
				: action === "update"
					? { model, outMessage: toast(successToast("View updated")) }
					: { model },
		FailedViewAction: ({ action, reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: `Couldn't ${VIEW_VERB[action]} the view`,
							description: "It was deleted.",
						},
						Refused: {
							title: `Couldn't ${VIEW_VERB[action]} the view`,
							description: "Built-in views cannot be deleted.",
						},
					}),
				),
			),
		}),

		ToggledRow: ({ accountId, isSelected }) => ({ model: toggleSelected(model, accountId, isSelected) }),
		ToggledAllRows: ({ isSelected }) => ({
			model: modifyFields(model, {
				selected: () =>
					isSelected
						? visibleAccounts(model, viewerOf(shared))
								.slice(0, model.rowLimit)
								.map((account) => account.id)
						: [],
			}),
		}),
		PressedSelectAll: () => ({
			model: modifyFields(model, {
				selected: () => visibleAccounts(model, viewerOf(shared)).map((account) => account.id),
			}),
		}),
		ClearedSelection: () => ({ model: modifyFields(model, { selected: () => [] }) }),
		GotOwnerMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "ownerMenu", menuMessage, (next, key) => assignOwner(next, shared, key)),
		GotTagPopoverMessage: ({ message: popoverMessage }) =>
			withPopover(model, "tagPopover", Popover.update(model.tagPopover, popoverMessage)),
		ChangedTagInput: ({ value }) => ({ model: modifyFields(model, { tagInput: () => value }) }),
		SubmittedTag: ({ tag }) => addTag(model, shared, tag),
		SucceededBulkUpdate: ({ action, count, label }) => ({
			model,
			outMessage: toast(
				successToast(
					action === "owner"
						? `Assigned ${count} customer${count === 1 ? "" : "s"} to ${label}`
						: `Tagged ${count} customer${count === 1 ? "" : "s"} “${label}”`,
				),
			),
		}),
		FailedBulkUpdate: ({ action, reason, isBatched }) => ({
			model,
			outMessage: toast(
				errorToastOf({
					title: action === "owner" ? "Couldn't assign the owner" : "Couldn't add the tag",
					description: isBatched
						? `${commonMessage(reason).title}. ${PARTLY_SAVED}`
						: commonMessage(reason).title,
				}),
			),
		}),
		PressedExport: ({ scope }) => exportCsv(model, shared, scope),
		CompletedExport: () => ({ model }),

		PressedShowMoreRows: () =>
			withSparklines({ model: modifyFields(model, { rowLimit: (limit) => limit + ROW_PAGE }) }, shared),
		ClickedRow: ({ accountId }) => openCustomer(model, shared, accountId),
		PressedListKey: ({ key }) => onKey(model, shared, key),
		HoveredRow: ({ accountId }) =>
			model.hoveredId !== null
				? {
						model: modifyFields(model, {
							hoveredId: () => accountId,
							hoverPendingId: () => accountId,
						}),
					}
				: {
						model: modifyFields(model, { hoverPendingId: () => accountId }),
						commands: [WaitBeforeHoverCard({ accountId })],
					},
		UnhoveredRow: () => ({
			model: modifyFields(model, { hoverPendingId: () => null, hoveredId: () => null }),
		}),
		ElapsedHoverDelay: ({ accountId }) =>
			model.hoverPendingId === accountId
				? { model: modifyFields(model, { hoveredId: () => accountId }) }
				: { model },

		PressedConnect: ({ provider }) => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.CustomersSourceDetail({ orgSlug, provider }),
			),
		}),

		SucceededFetchSparklines: ({ sparklines }) => {
			const next = { ...model.sparklines }
			for (const entry of sparklines) next[entry.accountId] = entry.values
			return withSparklines({ model: modifyFields(model, { sparklines: () => next }) }, shared)
		},
		// Asked for again with the next batch (more rows, other filters), not in a loop.
		FailedFetchSparklines: ({ accountIds }) => {
			const failed = new Set<string>(accountIds)
			return {
				model: modifyFields(model, {
					requestedSparklines: (requested) => requested.filter((id) => !failed.has(id)),
				}),
			}
		},

		CompletedFocusSearch: () => ({ model }),
		CompletedScrollRow: () => ({ model }),
		CompletedPositionHoverCard: () => ({ model }),
		CompletedLetModifierClicksThrough: () => ({ model }),
	})
