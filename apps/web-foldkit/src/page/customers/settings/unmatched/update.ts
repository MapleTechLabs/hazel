import type { CustomerAccountId, CustomerUnmatchedRecordId, OrganizationId } from "@hazel/schema"
import { Option } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, errorToastOf, reasonToast, successToast } from "../../../../data/actions"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import {
	CreateAccountFromUnmatched,
	DeleteUnmatchedIgnoreRule,
	FetchUnmatchedIgnoreRules,
	FetchUnmatchedRecords,
	IgnoreUnmatchedRecord,
	IgnoreUnmatchedRecords,
	LinkUnmatchedRecord,
	LinkUnmatchedRecords,
} from "./commands"
import { Message, type RecordAction } from "./message"
import {
	CREATE_KEY,
	highConfidenceRecords,
	IGNORE_KEY,
	ignorePatternsOf,
	linkCandidates,
	linkPopoverId,
	matchesPattern,
	type Model,
	openRecords,
	recordById,
	type RecordRow,
	type Records,
	type RecordStatus,
	rowMenuId,
	Sort,
	SORT_MENU_ID,
	visibleRecords,
} from "./model"

type Return = PageReturn<Model, Message>
type Commands = NonNullable<Return["commands"]>

/** Only admins and owners may list or resolve records (`customers.unmatched.*` refuse members). */
const adminOrganizationOf = (shared: Shared): OrganizationId | undefined =>
	isCustomersAdmin(shared) ? shared.organization?.id : undefined

// LOADING

const fetchAll = (model: Model, shared: Shared): Return => {
	const organizationId = adminOrganizationOf(shared)
	if (organizationId === undefined) return { model }
	return {
		model: modifyFields(model, {
			open: () => AsyncData.Loading(),
			ignored: () => AsyncData.Loading(),
			rules: () => AsyncData.Loading(),
			loadingMore: () => null,
			resolvedSincePage: () => 0,
		}),
		commands: [
			FetchUnmatchedRecords({ organizationId, status: "open", cursor: null }),
			FetchUnmatchedRecords({ organizationId, status: "ignored", cursor: null }),
			FetchUnmatchedIgnoreRules({ organizationId }),
		],
	}
}

export const initialModel: Model = {
	tab: "all",
	search: "",
	sort: "confidence",
	open: AsyncData.Idle(),
	ignored: AsyncData.Idle(),
	rules: AsyncData.Idle(),
	openCount: 0,
	loadingMore: null,
	accounts: null,
	selected: [],
	inFlight: [],
	resolvedSincePage: 0,
	deletedRules: [],
	sortMenu: Menu.init({
		id: SORT_MENU_ID,
		placement: "bottom end",
		selectionMode: "Single",
		selectedKeys: ["confidence"],
	}),
	rowMenu: null,
	linkSearch: null,
}

export const init = (_route: unknown, shared: Shared): Return => fetchAll(initialModel, shared)

/** The organization or the membership arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.open) ? fetchAll(model, shared) : { model }

const listOf = (model: Model, status: RecordStatus): Records =>
	status === "open" ? model.open : model.ignored

const withList = (model: Model, status: RecordStatus, list: Records): Model =>
	status === "open"
		? modifyFields(model, { open: () => list })
		: modifyFields(model, { ignored: () => list })

const mapItems = (
	records: Records,
	f: (items: ReadonlyArray<RecordRow>) => ReadonlyArray<RecordRow>,
): Records => AsyncData.map(records, (list) => ({ ...list, items: f(list.items) }))

/** A page from the server, less what is resolved here meanwhile; "Load more" appends new rows only. */
const receivedPage = (
	model: Model,
	status: RecordStatus,
	page: Readonly<{ isMore: boolean; items: ReadonlyArray<RecordRow>; nextCursor: string | null }>,
): Records => {
	const loaded = page.isMore ? Option.getOrUndefined(AsyncData.getData(listOf(model, status))) : undefined
	const skipped = new Set([
		...(status === "open" ? model.inFlight.map((record) => record.id) : []),
		...(loaded?.items ?? []).map((record) => record.id),
	])
	return AsyncData.Success({
		data: {
			items: [...(loaded?.items ?? []), ...page.items.filter((record) => !skipped.has(record.id))],
			nextCursor: page.nextCursor,
		},
	})
}

const loadMore = (model: Model, shared: Shared, status: RecordStatus): Return => {
	const organizationId = adminOrganizationOf(shared)
	const cursor = Option.getOrUndefined(AsyncData.getData(listOf(model, status)))?.nextCursor ?? null
	if (organizationId === undefined || cursor === null || model.loadingMore !== null) return { model }
	// An ignored record joins the ignored list at the top: its next page repeats rows, which
	// `receivedPage` skips. A resolved open record leaves: the open page starts that many earlier,
	// counting the ones in flight (the server may have resolved them already). Starting too early
	// only repeats rows; too late would skip some.
	const shift = status === "open" ? model.resolvedSincePage + model.inFlight.length : 0
	return {
		model: modifyFields(model, {
			loadingMore: () => status,
			resolvedSincePage: (count) => (status === "open" ? 0 : count),
		}),
		commands: [
			FetchUnmatchedRecords({
				organizationId,
				status,
				cursor: String(Math.max(0, Number(cursor) - shift)),
			}),
		],
	}
}

// OPTIMISTIC ACTIONS

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

/** Takes a record off the open list at once (an ignored one moves to the ignored list). */
const takeOff = (model: Model, record: RecordRow, action: RecordAction): Model =>
	modifyFields(model, {
		open: (open) => mapItems(open, (items) => items.filter((row) => row.id !== record.id)),
		ignored: (ignored) =>
			action === "ignore" ? mapItems(ignored, (items) => [record, ...items]) : ignored,
		openCount: (count) => Math.max(0, count - 1),
		selected: (ids) => ids.filter((id) => id !== record.id),
		inFlight: (rows) => [...rows, record],
	})

/** The action failed: the record is open again. */
const putBack = (model: Model, recordId: CustomerUnmatchedRecordId, action: RecordAction): Model => {
	const record = model.inFlight.find((row) => row.id === recordId)
	if (record === undefined) return model
	return modifyFields(model, {
		open: (open) => mapItems(open, (items) => [...items, record]),
		ignored: (ignored) =>
			action === "ignore"
				? mapItems(ignored, (items) => items.filter((row) => row.id !== recordId))
				: ignored,
		openCount: (count) => count + 1,
		inFlight: (rows) => rows.filter((row) => row.id !== recordId),
	})
}

/** The server resolved them: no longer in flight, and no longer open there either. */
const settled = (model: Model, recordIds: ReadonlyArray<CustomerUnmatchedRecordId>): Model =>
	modifyFields(model, {
		inFlight: (rows) => rows.filter((row) => !recordIds.includes(row.id)),
		resolvedSincePage: (count) => count + recordIds.length,
	})

/** Runs an action on one open record: off the list now, the Command confirms or puts it back. */
const act = (
	model: Model,
	shared: Shared,
	recordId: CustomerUnmatchedRecordId,
	action: RecordAction,
	toCommand: (organizationId: OrganizationId, record: RecordRow) => Commands[number] | undefined,
): Return => {
	const organizationId = adminOrganizationOf(shared)
	const record = recordById(model, recordId)
	const command =
		organizationId === undefined || record === undefined ? undefined : toCommand(organizationId, record)
	if (record === undefined || command === undefined) return { model }
	return {
		model: modifyFields(takeOff(model, record, action), {
			linkSearch: (search) => (search?.recordId === recordId ? null : search),
		}),
		commands: [command],
	}
}

const link = (
	model: Model,
	shared: Shared,
	recordId: CustomerUnmatchedRecordId,
	accountId: CustomerAccountId | null,
): Return =>
	act(model, shared, recordId, "link", (organizationId) =>
		accountId === null ? undefined : LinkUnmatchedRecord({ organizationId, recordId, accountId }),
	)

const createAccount = (model: Model, shared: Shared, recordId: CustomerUnmatchedRecordId): Return =>
	act(model, shared, recordId, "create", (organizationId, record) =>
		record.entityType === "account"
			? CreateAccountFromUnmatched({ organizationId, recordId })
			: undefined,
	)

/**
 * `key`: Ignore this record, or all matching one of its patterns (`ignorePatternsOf`): the rule is
 * saved with this record and the server ignores the open records it covers, so those leave the
 * list when it answers (`SucceededIgnoreWithRule`), not one call each.
 */
const ignore = (model: Model, shared: Shared, recordId: CustomerUnmatchedRecordId, key: string): Return => {
	const record = recordById(model, recordId)
	const pattern =
		record === undefined ? undefined : ignorePatternsOf(record).find((option) => option.key === key)
	return act(model, shared, recordId, "ignore", (organizationId) =>
		key === IGNORE_KEY
			? IgnoreUnmatchedRecord({ organizationId, recordId, rule: null, coveredIds: [] })
			: pattern === undefined || record === undefined
				? undefined
				: IgnoreUnmatchedRecord({
						organizationId,
						recordId,
						rule: { field: pattern.field, pattern: pattern.pattern },
						coveredIds: openRecords(model)
							.filter(
								(other) => other.id !== recordId && matchesPattern(record, pattern, other),
							)
							.map((other) => other.id),
					}),
	)
}

/** Links each record to its suggestion in one Command (no bulk RPC: one call per record). */
const linkAll = (model: Model, shared: Shared, records: ReadonlyArray<RecordRow>): Return => {
	const organizationId = adminOrganizationOf(shared)
	const suggested = records.filter((record) => record.suggestedAccountId !== null)
	if (organizationId === undefined || suggested.length === 0) return { model }
	return {
		model: suggested.reduce((next, record) => takeOff(next, record, "link"), model),
		commands: [
			LinkUnmatchedRecords({
				organizationId,
				links: suggested.flatMap((record) =>
					record.suggestedAccountId === null
						? []
						: [{ recordId: record.id, accountId: record.suggestedAccountId }],
				),
			}),
		],
	}
}

const ignoreAll = (model: Model, shared: Shared, records: ReadonlyArray<RecordRow>): Return => {
	const organizationId = adminOrganizationOf(shared)
	if (organizationId === undefined || records.length === 0) return { model }
	return {
		model: records.reduce((next, record) => takeOff(next, record, "ignore"), model),
		commands: [IgnoreUnmatchedRecords({ organizationId, recordIds: records.map((record) => record.id) })],
	}
}

const selectedRecords = (model: Model): ReadonlyArray<RecordRow> =>
	openRecords(model).filter((record) => model.selected.includes(record.id))

const VERB = { link: "link", create: "create an account from", ignore: "ignore" } as const satisfies Record<
	RecordAction,
	string
>
const DONE = { link: "Linked", create: "Created accounts from", ignore: "Ignored" } as const satisfies Record<
	RecordAction,
	string
>

const records = (count: number) => `${count} record${count === 1 ? "" : "s"}`

/** A new search keeps only the selected records it still shows (bulk actions act on what shows). */
const searched = (model: Model, search: string): Model => {
	const next = modifyFields(model, { search: () => search })
	const visible = new Set(visibleRecords(next).map((record) => record.id))
	return modifyFields(next, { selected: (ids) => ids.filter((id) => visible.has(id)) })
}

// MENUS AND THE LINK SEARCH

type MenuCommands = NonNullable<ReturnType<typeof Menu.update>["commands"]>

/** Folds a menu Message; a picked item runs `onSelect` on the updated Model. */
const foldMenu = (
	result: ReturnType<typeof Menu.update>,
	next: Model,
	commands: Commands,
	onSelect: (model: Model, key: string) => Return,
): Return => {
	const picked =
		result.outMessage?._tag === "SelectedItem" ? onSelect(next, result.outMessage.key) : { model: next }
	return { ...picked, commands: [...commands, ...(picked.commands ?? [])] }
}

const mapSortMenu = (commands: MenuCommands) =>
	Command.mapMessages(commands, (message) => Message.GotSortMenuMessage({ message }))

const updateRowMenu = (
	model: Model,
	shared: Shared,
	recordId: CustomerUnmatchedRecordId,
	message: Menu.Message,
): Return => {
	const current =
		model.rowMenu?.recordId === recordId
			? model.rowMenu.menu
			: Menu.init({ id: rowMenuId(recordId), placement: "bottom end" })
	const result = Menu.update(current, message)
	return foldMenu(
		result,
		modifyFields(model, { rowMenu: () => ({ recordId, menu: result.model }) }),
		Command.mapMessages(result.commands ?? [], (child) =>
			Message.GotRowMenuMessage({ recordId, message: child }),
		),
		(next, key) =>
			key === CREATE_KEY ? createAccount(next, shared, recordId) : ignore(next, shared, recordId, key),
	)
}

const updateLinkPopover = (
	model: Model,
	recordId: CustomerUnmatchedRecordId,
	message: Popover.Message,
): Return => {
	const current = model.linkSearch?.recordId === recordId ? model.linkSearch : null
	const result = Popover.update(current?.popover ?? Popover.init(linkPopoverId(recordId)), message)
	return {
		model: modifyFields(model, {
			linkSearch: () => ({ recordId, popover: result.model, query: current?.query ?? "" }),
		}),
		commands: Command.mapMessages(result.commands, (child) =>
			Message.GotLinkPopoverMessage({ recordId, message: child }),
		),
	}
}

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),

		SucceededFetchRecords: ({ status, isMore, items, nextCursor, openCount }) => ({
			model: modifyFields(
				withList(model, status, receivedPage(model, status, { isMore, items, nextCursor })),
				{
					openCount: () => Math.max(0, openCount - model.inFlight.length),
					loadingMore: (loading) => (isMore && loading === status ? null : loading),
				},
			),
		}),
		FailedFetchRecords: ({ status, isMore, reason }) =>
			isMore
				? {
						model: modifyFields(model, { loadingMore: () => null }),
						outMessage: toast(reasonToast(reason)),
					}
				: { model: withList(model, status, AsyncData.Failure({ error: reason })) },
		SucceededFetchIgnoreRules: ({ rules }) => ({
			model: modifyFields(model, { rules: () => AsyncData.Success({ data: rules }) }),
		}),
		FailedFetchIgnoreRules: ({ reason }) => ({
			model: modifyFields(model, { rules: () => AsyncData.Failure({ error: reason }) }),
		}),
		PressedRetry: () => fetchAll(model, shared),
		PressedLoadMore: ({ status }) => loadMore(model, shared, status),

		ClickedTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab, selected: () => [] }) }),
		ChangedSearch: ({ value }) => ({ model: searched(model, value) }),
		ClearedSearch: () => ({ model: searched(model, "") }),
		GotSortMenuMessage: ({ message: menuMessage }) => {
			const result = Menu.update(model.sortMenu, menuMessage)
			return foldMenu(
				result,
				modifyFields(model, { sortMenu: () => result.model }),
				mapSortMenu(result.commands ?? []),
				(next, key) => {
					const sort = Sort.literals.find((literal) => literal === key)
					return sort === undefined
						? { model: next }
						: {
								model: modifyFields(next, {
									sort: () => sort,
									sortMenu: (menu) => modifyFields(menu, { selectedKeys: () => [sort] }),
								}),
							}
				},
			)
		},

		ToggledRecord: ({ recordId, isSelected }) => ({
			model: modifyFields(model, {
				selected: (ids) =>
					isSelected
						? [...ids.filter((id) => id !== recordId), recordId]
						: ids.filter((id) => id !== recordId),
			}),
		}),
		ToggledAllRecords: ({ isSelected }) => ({
			model: modifyFields(model, {
				selected: () => (isSelected ? visibleRecords(model).map((record) => record.id) : []),
			}),
		}),
		ClearedSelection: () => ({ model: modifyFields(model, { selected: () => [] }) }),
		PressedLinkHighConfidence: () => linkAll(model, shared, highConfidenceRecords(model)),
		PressedLinkSelected: () => linkAll(model, shared, selectedRecords(model)),
		PressedIgnoreSelected: () => ignoreAll(model, shared, selectedRecords(model)),

		PressedLinkSuggested: ({ recordId }) =>
			link(model, shared, recordId, recordById(model, recordId)?.suggestedAccountId ?? null),
		PressedCreateAccount: ({ recordId }) => createAccount(model, shared, recordId),
		GotRowMenuMessage: ({ recordId, message: menuMessage }) =>
			updateRowMenu(model, shared, recordId, menuMessage),
		GotLinkPopoverMessage: ({ recordId, message: popoverMessage }) =>
			updateLinkPopover(model, recordId, popoverMessage),
		ChangedLinkQuery: ({ value }) => ({
			model: modifyFields(model, {
				linkSearch: (search) => (search === null ? null : { ...search, query: value }),
			}),
		}),
		SubmittedLinkQuery: ({ recordId }) => {
			const record = recordById(model, recordId)
			const first =
				record === undefined
					? undefined
					: linkCandidates(
							model.accounts ?? [],
							model.linkSearch?.query ?? "",
							record.suggestedAccountId,
						).matches[0]
			return first === undefined ? { model } : link(model, shared, recordId, first.id)
		},
		PickedLinkAccount: ({ recordId, accountId }) => link(model, shared, recordId, accountId),
		PressedDeleteRule: ({ ruleId }) => {
			const organizationId = adminOrganizationOf(shared)
			const rule = Option.getOrUndefined(AsyncData.getData(model.rules))?.find(
				(row) => row.id === ruleId,
			)
			if (organizationId === undefined || rule === undefined) return { model }
			return {
				model: modifyFields(model, {
					rules: (rules) => AsyncData.map(rules, (rows) => rows.filter((row) => row.id !== ruleId)),
					deletedRules: (rows) => [...rows, rule],
				}),
				commands: [DeleteUnmatchedIgnoreRule({ organizationId, ruleId })],
			}
		},

		SucceededRecordAction: ({ recordId }) => ({ model: settled(model, [recordId]) }),
		SucceededIgnoreWithRule: ({ recordId, coveredIds }) => {
			const organizationId = adminOrganizationOf(shared)
			const covered = openRecords(model).filter((record) => coveredIds.includes(record.id))
			const swept = covered.reduce((next, record) => takeOff(next, record, "ignore"), model)
			// The new rule shows in the rules list.
			return {
				model: settled(swept, [recordId, ...covered.map((record) => record.id)]),
				commands: organizationId === undefined ? [] : [FetchUnmatchedIgnoreRules({ organizationId })],
			}
		},
		FailedRecordAction: ({ recordId, action, reason }) => {
			const label = model.inFlight.find((row) => row.id === recordId)?.label ?? "the record"
			const title = `Couldn't ${VERB[action]} ${label}`
			return {
				model: putBack(model, recordId, action),
				outMessage: toast(
					errorToastOf(
						failureMessage(reason, {
							NotFound: { title, description: "The record or the account no longer exists." },
							Invalid: {
								title,
								description:
									"The account was deleted, or the record was resolved in the meantime.",
							},
						}),
					),
				),
			}
		},
		CompletedBulkAction: ({ action, succeeded, failed }) => {
			const next = failed.reduce(
				(current, failure) => putBack(current, failure.recordId, action),
				settled(model, succeeded),
			)
			const total = succeeded.length + failed.length
			return {
				model: next,
				outMessage: toast(
					failed.length === 0
						? successToast(`${DONE[action]} ${records(total)}`)
						: errorToast(
								`Couldn't ${VERB[action]} ${failed.length} of ${records(total)}`,
								"They're back in the list. Try them one at a time.",
							),
				),
			}
		},
		SucceededDeleteRule: ({ ruleId }) => ({
			model: modifyFields(model, { deletedRules: (rows) => rows.filter((row) => row.id !== ruleId) }),
		}),
		FailedDeleteRule: ({ ruleId, reason }) => {
			const rule = model.deletedRules.find((row) => row.id === ruleId)
			return {
				model: modifyFields(model, {
					rules: (rules) =>
						rule === undefined ? rules : AsyncData.map(rules, (rows) => [...rows, rule]),
					deletedRules: (rows) => rows.filter((row) => row.id !== ruleId),
				}),
				outMessage: toast(reasonToast(reason)),
			}
		},
	})
