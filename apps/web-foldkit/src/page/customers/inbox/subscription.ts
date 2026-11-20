import { OrganizationId } from "@hazel/schema"
import { Effect, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { channelOptionsStream } from "../../../customers/channels"
import { issuesStream } from "../../../customers/issues"
import { accountsStream, orgMembersStream } from "../../../customers/queries"
import { queueKeyFilter } from "../../../customers/ui/queue-keys"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { InboxKey, Model } from "./model"

/** The inbox's live rows, and its keyboard while nothing else holds it. */

type Input = PageSubscriptionInput<Model>

const KEYS = new Map<string, InboxKey>([
	// As Needs attention: k walks down, j up.
	["k", "next"],
	["ArrowDown", "next"],
	["j", "previous"],
	["ArrowUp", "previous"],
	["a", "assign"],
	["i", "assignToMe"],
	["s", "status"],
	["p", "priority"],
	["c", "close"],
	["Enter", "open"],
	["o", "openCustomer"],
	["Escape", "deselect"],
	["/", "search"],
])

const REPEATABLE: ReadonlySet<InboxKey> = new Set(["next", "previous"])
const PRESSABLE: ReadonlySet<InboxKey> = new Set(["open"])

/** The inbox key a keydown means, or none (typing, a modifier, a menu or dialog holding the keyboard). */
export const inboxKeyOf = queueKeyFilter(KEYS, REPEATABLE, PRESSABLE)

const isMenuOpen = (model: Model) =>
	[model.assignMenu, model.statusMenu, model.priorityMenu, model.filterMenu].some(
		(menu) => menu.popup._tag === "Open",
	)

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	issues: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: issuesStream(organizationId, (issues) => Message.UpdatedIssues({ issues })),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
	channels: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: channelOptionsStream(organizationId, (channels) => Message.UpdatedChannels({ channels })),
	}),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
	keys: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model, shared }) => ({
				isActive: !shared.isOverlayOpen && !isMenuOpen(model),
			}),
			dependenciesToStream: ({ isActive }) =>
				isActive
					? Stream.callback<Message>((queue) =>
							Effect.acquireRelease(
								Effect.sync(() => {
									const onKeyDown = (event: KeyboardEvent) => {
										const key = inboxKeyOf(event)
										if (key === null) return
										event.preventDefault()
										Queue.offerUnsafe(queue, Message.PressedInboxKey({ key }))
									}
									document.addEventListener("keydown", onKeyDown)
									return onKeyDown
								}),
								(onKeyDown) =>
									Effect.sync(() => document.removeEventListener("keydown", onKeyDown)),
							).pipe(Effect.flatMap(() => Effect.never)),
						)
					: Stream.empty,
		},
	),
}))
