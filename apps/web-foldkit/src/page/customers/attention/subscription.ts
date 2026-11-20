import { OrganizationId } from "@hazel/schema"
import { Effect, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	settingsSummaryStream,
	orgMembersStream,
	signalsStream,
} from "../../../customers/queries"
import { queueKeyFilter } from "../../../customers/ui/queue-keys"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model, QueueKey } from "./model"

/** The queue's live rows, and its keyboard while nothing else holds it. */

type Input = PageSubscriptionInput<Model>

const KEYS = new Map<string, QueueKey>([
	// k walks down the queue, j up.
	["k", "next"],
	["ArrowDown", "next"],
	["j", "previous"],
	["ArrowUp", "previous"],
	// Linear's keys: A assign, I assign to me, H snooze.
	["a", "assign"],
	["i", "assignToMe"],
	["h", "snooze"],
	["d", "done"],
	["r", "reopen"],
	["w", "reopen"],
	["Enter", "open"],
	[" ", "preview"],
	["Escape", "close"],
	["/", "search"],
])

/** Holding j/k walks the queue; a held action key acts once. */
const REPEATABLE: ReadonlySet<QueueKey> = new Set(["next", "previous"])
const PRESSABLE: ReadonlySet<QueueKey> = new Set(["open", "preview"])

/** The queue key a keydown means, or none (typing, a modifier, a pressable target for Enter/Space). */
export const queueKeyOf = queueKeyFilter(KEYS, REPEATABLE, PRESSABLE)

const isMenuOpen = (model: Model) =>
	[model.assignMenu, model.snoozeMenu, model.filterMenu, model.sortMenu].some(
		(menu) => menu.popup._tag === "Open",
	)

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: signalsStream(organizationId, (signals) => Message.UpdatedSignals({ signals })),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
	lastComputedAt: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: settingsSummaryStream(organizationId, (settings) =>
						Message.UpdatedLastComputedAt({
							lastComputedAtMs: settings?.lastComputedAtMs ?? null,
						}),
					),
	}),
	// Off while a root overlay, the done or snooze-date dialog, or a menu holds the keyboard.
	keys: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model, shared }) => ({
				isActive:
					!shared.isOverlayOpen &&
					!model.doneModal.isOpen &&
					!model.snoozeDateModal.isOpen &&
					!isMenuOpen(model),
			}),
			dependenciesToStream: ({ isActive }) =>
				isActive
					? Stream.callback<Message>((queue) =>
							Effect.acquireRelease(
								Effect.sync(() => {
									const onKeyDown = (event: KeyboardEvent) => {
										const key = queueKeyOf(event)
										if (key === null) return
										event.preventDefault()
										Queue.offerUnsafe(queue, Message.PressedQueueKey({ key }))
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
