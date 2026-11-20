import * as Customers from "@hazel/domain/customers"
import { type ChannelId, CustomerIssueId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Effect, Schema, type Stream } from "effect"
import { Command, type Update } from "foldkit"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { customerIssueCollection } from "~/db/collections"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { cn } from "~/lib/utils"
import { ISSUE_STATUSES, IssueRow, STATUS_LABEL, updateIssueAction } from "../../customers/issues"
import { MemberRow, withCustomersSource } from "../../customers/queries"
import { catchCommon, errorToastOf } from "../../data/actions"
import { liveQueryStream } from "../../data/live-query"
import { IconChevronDown, IconCirclePlus, IconSupport, IconUser } from "../../icons"
import { ToastRequest } from "../../overlay/toasts"
import type { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { link } from "../../ui/link"
import * as Menu from "../../ui/menu"
import { menuLabel, view as menuView } from "../../ui/menu-view"

/**
 * The support issue of an open thread (`docs/customers/issues.md`): in a channel linked to a
 * customer, a customer's top-level message and its thread are an issue. The thread panel's header
 * shows its status and assignee as two quiet chips with menus, and "Open in inbox"; a thread with
 * no issue yet offers "Create issue" (`CreateIssueFromMessage`, run by the page).
 *
 * The channel header (`header.ts`) can host the same chips later, from this Submodel.
 */

// MODEL

export const Model = Schema.Struct({
	/** The issue rooted at the thread's starter message; null when there is none. */
	issue: Schema.NullOr(IssueRow),
	/** The issue query has answered: until then neither the chips nor "Create issue" show. */
	hasLoaded: Schema.Boolean,
	/** "Create issue" is running; cleared when it settles or the issue arrives. */
	isCreating: Schema.Boolean,
	/** The org's people, for the assignee menu. */
	members: Schema.Array(MemberRow),
	statusMenu: Menu.Model,
	assignMenu: Menu.Model,
})
export type Model = typeof Model.Type

export const init = (rootMessageId: MessageId): Model => ({
	issue: null,
	hasLoaded: false,
	isCreating: false,
	members: [],
	statusMenu: Menu.init({ id: `issue-status-${rootMessageId}`, placement: "bottom start" }),
	assignMenu: Menu.init({ id: `issue-assignee-${rootMessageId}`, placement: "bottom start" }),
})

/** What can go wrong changing an issue, beyond the shared reasons. */
export const UpdateIssueFailure = Schema.Union([
	Schema.Literals(["NotFound", "InvalidRequest"]),
	CommonReason,
])
export type UpdateIssueFailure = typeof UpdateIssueFailure.Type

// MESSAGE

export const Message = defineMessageUnion({
	/** The issue at `rootMessageId`; the page drops one for a thread it no longer shows. */
	UpdatedIssue: { rootMessageId: MessageId, issue: Schema.NullOr(IssueRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	GotStatusMenuMessage: { message: Menu.Message },
	GotAssignMenuMessage: { message: Menu.Message },
	ClickedCreateIssue: {},
	SucceededUpdateIssue: {},
	FailedUpdateIssue: { reason: UpdateIssueFailure },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	/** "Create issue": the page runs `CreateIssueFromMessage` on the thread's starter message. */
	RequestedCreateIssue: {},
	RequestedToast: { toast: ToastRequest },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

const IssueChangeArgs = Schema.Struct({
	status: Schema.optionalKey(Customers.IssueStatus),
	assigneeUserId: Schema.optionalKey(Schema.NullOr(UserId)),
})

/** A status or assignee change: `updateIssueAction` patches the synced row at once, then the RPC. */
export const UpdateThreadIssue = Command.define("UpdateThreadIssue", {
	args: {
		organizationId: OrganizationId,
		issueId: CustomerIssueId,
		actor: UserId,
		change: IssueChangeArgs,
	},
	messages: [Message.SucceededUpdateIssue, Message.FailedUpdateIssue],
	execute: ({ change, ...args }) =>
		updateIssueAction({ ...args, change: { ...change } }).pipe(
			Effect.as(Message.SucceededUpdateIssue()),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedUpdateIssue({ reason: "NotFound" })),
				// The assignee left the organization since the menu showed them.
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedUpdateIssue({ reason: "InvalidRequest" })),
			}),
			catchCommon((reason) => Message.FailedUpdateIssue({ reason })),
		),
})

// UPDATE

export interface Context {
	readonly organizationId: OrganizationId | null
	readonly currentUserId: UserId | null
}

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, HazelRpc>

export const ASSIGN_ME = "me"
export const ASSIGN_NONE = "none"
const ASSIGN_USER = "user:"
const assignKeyOf = (userId: UserId) => `${ASSIGN_USER}${userId}`
const userIdOfAssignKey = (key: string): string | null =>
	key.startsWith(ASSIGN_USER) ? key.slice(ASSIGN_USER.length) : null

const isStatus = (key: string): key is Customers.IssueStatus =>
	(ISSUE_STATUSES as ReadonlyArray<string>).includes(key)

/** The assignee a menu key names: a user, nobody (null), or no change (undefined). */
export const assigneeOfKey = (
	key: string,
	members: ReadonlyArray<MemberRow>,
	currentUserId: UserId | null,
): UserId | null | undefined => {
	if (key === ASSIGN_ME) return currentUserId ?? undefined
	if (key === ASSIGN_NONE) return null
	const userId = userIdOfAssignKey(key)
	return userId === null ? undefined : members.find((member) => member.id === userId)?.id
}

const change = (
	model: Model,
	context: Context,
	issueChange: typeof IssueChangeArgs.Type,
): ReadonlyArray<Command.Command<Message, never, HazelRpc>> =>
	model.issue === null || context.organizationId === null || context.currentUserId === null
		? []
		: [
				UpdateThreadIssue({
					organizationId: context.organizationId,
					issueId: model.issue.id,
					actor: context.currentUserId,
					change: issueChange,
				}),
			]

/** Folds a menu Message; a picked item runs `onSelect` on the updated Model. */
const updateMenu = (
	model: Model,
	field: "statusMenu" | "assignMenu",
	message: Menu.Message,
	onSelect: (next: Model, key: string) => ReadonlyArray<Command.Command<Message, never, HazelRpc>>,
): Return => {
	const result = Menu.update(model[field], message)
	const next =
		field === "statusMenu"
			? modifyFields(model, { statusMenu: () => result.model })
			: modifyFields(model, { assignMenu: () => result.model })
	const wrap: (inner: Menu.Message) => Message =
		field === "statusMenu"
			? (inner: Menu.Message) => Message.GotStatusMenuMessage({ message: inner })
			: (inner: Menu.Message) => Message.GotAssignMenuMessage({ message: inner })
	const picked = result.outMessage?._tag === "SelectedItem" ? onSelect(next, result.outMessage.key) : []
	return { model: next, commands: [...Command.mapMessages(result.commands ?? [], wrap), ...picked] }
}

const failedToast = (reason: UpdateIssueFailure): ToastRequest =>
	errorToastOf(
		failureMessage(reason, {
			NotFound: { title: "Issue not found", description: "It may have been deleted." },
			InvalidRequest: {
				title: "Couldn't update the issue",
				description: "That member may have left the organization.",
			},
		}),
	)

export const update = (model: Model, message: Message, context: Context): Return =>
	Message.match<Return>(message, {
		UpdatedIssue: ({ issue }) => ({
			model: modifyFields(model, {
				issue: () => issue,
				hasLoaded: () => true,
				isCreating: (isCreating) => isCreating && issue === null,
			}),
		}),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		GotStatusMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "statusMenu", menuMessage, (next, key) =>
				isStatus(key) && next.issue !== null && next.issue.status !== key
					? change(next, context, { status: key })
					: [],
			),
		GotAssignMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "assignMenu", menuMessage, (next, key) => {
				const assigneeUserId = assigneeOfKey(key, next.members, context.currentUserId)
				return assigneeUserId === undefined || next.issue?.assigneeUserId === assigneeUserId
					? []
					: change(next, context, { assigneeUserId })
			}),
		ClickedCreateIssue: () =>
			model.isCreating || model.issue !== null
				? { model }
				: {
						model: modifyFields(model, { isCreating: () => true }),
						outMessage: OutMessage.RequestedCreateIssue(),
					},
		SucceededUpdateIssue: () => ({ model }),
		FailedUpdateIssue: ({ reason }) => ({
			model,
			outMessage: OutMessage.RequestedToast({ toast: failedToast(reason) }),
		}),
	})

/** `CreateIssueFromMessage` settled (either way): the button is free again. */
export const settledCreate = (model: Model): Model =>
	model.isCreating ? modifyFields(model, { isCreating: () => false }) : model

// QUERIES

/**
 * The top-level messages of a linked channel that already have an issue: one live query per
 * channel, so the "Create issue" message action hides on them without a query per row. Only
 * subscribed for a linked channel, as it opens the org's customers source.
 */
export const issueRootIdsStream = <M>(
	organizationId: OrganizationId,
	channelId: ChannelId,
	toMessage: (rootMessageIds: ReadonlyArray<MessageId>) => M,
): Stream.Stream<M> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Issue, M>(
			(q) =>
				q
					.from({ issue: customerIssueCollection })
					.where(({ issue }) => and(eq(issue.sourceChannelId, channelId), isNull(issue.deletedAt))),
			// Each issue's root and the follow-ups that joined it.
			(rows) => toMessage(rows.flatMap((issue) => [issue.rootMessageId, ...issue.joinedMessageIds])),
		),
	)

// VIEW

export interface ViewInputs<M> {
	readonly model: Model
	readonly inboxHref: string
	readonly currentUserId: UserId | null
	readonly toMessage: (message: Message) => M
}

const iconAttributes = { "data-slot": "icon" }

/** Each status's dot: a reply owed is the brand colour, waiting on us a warning, closed a success. */
const STATUS_DOT = {
	new: "bg-primary",
	waiting_on_us: "bg-warning",
	waiting_on_customer: "bg-muted-fg",
	on_hold: "bg-muted-fg",
	closed: "bg-success",
} as const satisfies Record<Customers.IssueStatus, string>

const statusDot = <M>(h: HtmlBuilder<M>, status: Customers.IssueStatus): Html =>
	h.span([h.Class(cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])), h.AriaHidden(true)])

/** A chip: a small plain button that opens its menu. */
const chip = <M>(
	h: HtmlBuilder<M>,
	label: string,
	leading: Html,
	attributes: ReadonlyArray<Attribute<M> | ChildAttribute>,
	overlay: Html,
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "xs",
			className: "min-w-0 gap-1.5 text-muted-fg hover:text-fg",
			attributes,
		},
		[
			leading,
			h.span([h.Class("truncate")], [label]),
			IconChevronDown(h, { className: "size-3 shrink-0", attributes: iconAttributes }),
			overlay,
		],
	)

const statusMenuView = <M>(h: HtmlBuilder<M>, issue: IssueRow, inputs: ViewInputs<M>): Html => {
	const menu = inputs.model.statusMenu
	return h.submodel({
		slotId: menu.id,
		model: menu,
		view: menuView,
		viewInputs: {
			entries: ISSUE_STATUSES.map((status) => Menu.item(status, { textValue: STATUS_LABEL[status] })),
			toTrigger: (attributes, overlay) =>
				chip(
					h,
					STATUS_LABEL[issue.status],
					statusDot(h, issue.status),
					[...attributes, h.AriaLabel(`Status: ${STATUS_LABEL[issue.status]}`)],
					overlay,
				),
			content: (key) =>
				isStatus(key)
					? [
							h.span([h.Class("col-start-1 flex items-center")], [statusDot(h, key)]),
							menuLabel(h, menu.id, key, STATUS_LABEL[key]),
						]
					: [key],
		},
		toParentMessage: (message) => inputs.toMessage(Message.GotStatusMenuMessage({ message })),
	})
}

const assigneeName = (
	issue: IssueRow,
	members: ReadonlyArray<MemberRow>,
	currentUserId: UserId | null,
): string => {
	if (issue.assigneeUserId === null) return "Unassigned"
	if (issue.assigneeUserId === currentUserId) return "You"
	return members.find((member) => member.id === issue.assigneeUserId)?.name ?? "Assigned"
}

const assignEntries = (
	members: ReadonlyArray<MemberRow>,
	currentUserId: UserId | null,
): ReadonlyArray<Menu.Entry> => [
	...(currentUserId === null ? [] : [Menu.item(ASSIGN_ME, { textValue: "Assign to me" })]),
	Menu.item(ASSIGN_NONE, { textValue: "Unassign" }),
	Menu.section(
		"Team",
		members
			.filter((member) => member.id !== currentUserId)
			.map((member) => Menu.item(assignKeyOf(member.id), { textValue: member.name })),
	),
]

const assignMenuView = <M>(h: HtmlBuilder<M>, issue: IssueRow, inputs: ViewInputs<M>): Html => {
	const menu = inputs.model.assignMenu
	const name = assigneeName(issue, inputs.model.members, inputs.currentUserId)
	return h.submodel({
		slotId: menu.id,
		model: menu,
		view: menuView,
		viewInputs: {
			entries: assignEntries(inputs.model.members, inputs.currentUserId),
			toTrigger: (attributes, overlay) =>
				chip(
					h,
					name,
					IconUser(h, { className: "size-3.5 shrink-0", attributes: iconAttributes }),
					[...attributes, h.AriaLabel(`Assignee: ${name}`)],
					overlay,
				),
			content: (key) => [
				menuLabel(
					h,
					menu.id,
					key,
					key === ASSIGN_ME
						? "Assign to me"
						: key === ASSIGN_NONE
							? "Unassign"
							: (inputs.model.members.find((member) => member.id === userIdOfAssignKey(key))
									?.name ?? key),
				),
			],
		},
		toParentMessage: (message) => inputs.toMessage(Message.GotAssignMenuMessage({ message })),
	})
}

/** "Open in inbox": the support inbox, where every issue is triaged. */
const inboxLink = <M>(h: HtmlBuilder<M>, href: string): Html =>
	link(
		h,
		{ href, className: "ml-auto flex shrink-0 items-center gap-1 text-muted-fg text-xs hover:text-fg" },
		[IconSupport(h, { className: "size-3.5", attributes: iconAttributes }), "Open in inbox"],
	)

/**
 * The strip under the thread header. Nothing until the issue query answers; then the issue's chips,
 * or a subtle "Create issue".
 */
export const view = <M>(h: HtmlBuilder<M>, inputs: ViewInputs<M>): Html => {
	const { model } = inputs
	if (!model.hasLoaded) return h.empty
	const issue = model.issue
	return h.div(
		[
			h.Class("flex h-9 shrink-0 items-center gap-1 border-border border-b bg-bg px-3"),
			h.Attribute("data-issue-control", ""),
		],
		issue === null
			? [
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							className: "gap-1.5 text-muted-fg hover:text-fg",
							isPending: model.isCreating,
							onPress: inputs.toMessage(Message.ClickedCreateIssue()),
						},
						[
							IconCirclePlus(h, { className: "size-3.5", attributes: iconAttributes }),
							model.isCreating ? "Creating issue..." : "Create issue",
						],
					),
				]
			: [
					statusMenuView(h, issue, inputs),
					assignMenuView(h, issue, inputs),
					inboxLink(h, inputs.inboxHref),
				],
	)
}
