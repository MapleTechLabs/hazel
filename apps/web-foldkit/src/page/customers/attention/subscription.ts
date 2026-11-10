import { OrganizationId } from "@hazel/schema"
import { Effect, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	settingsSummaryStream,
	orgMembersStream,
	signalsStream,
} from "../../../customers/queries"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model, QueueKey } from "./model"

/** The queue's live rows, and its keyboard while nothing else holds it. */

type Input = PageSubscriptionInput<Model>

const KEYS = new Map<string, QueueKey>([
	["j", "next"],
	["ArrowDown", "next"],
	["k", "previous"],
	["ArrowUp", "previous"],
	["a", "assign"],
	["s", "snooze"],
	["d", "done"],
	["e", "dismiss"],
	["r", "reopen"],
	["w", "reopen"],
	["Enter", "open"],
	[" ", "preview"],
	["Escape", "close"],
	["/", "search"],
])

/** The event's element; none for a key on the document itself (or outside a DOM). */
const elementOf = (target: EventTarget | null): HTMLElement | null =>
	typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null

const isEditable = (target: EventTarget | null): boolean => {
	const element = elementOf(target)
	return (
		element !== null &&
		(element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
	)
}

/** A dialog or an open menu has the keyboard (its own focus and keys). */
const isInOverlay = (target: EventTarget | null): boolean =>
	elementOf(target)?.closest("dialog, [role=dialog], [role=menu]") != null

/** Enter and Space keep activating a focused button or link. */
const isPressable = (target: EventTarget | null): boolean =>
	elementOf(target)?.closest("button, a, [role=menuitem]") != null

/** The arrows walk the queue from a row or with nothing focused; anywhere else they scroll. */
const isArrowForQueue = (target: EventTarget | null): boolean => {
	const element = elementOf(target)
	return element === null || element.tagName === "BODY" || element.closest("[role=table]") !== null
}

/** The queue key a keydown means, or none (typing, a modifier, a pressable target for Enter/Space). */
export const queueKeyOf = (event: {
	readonly key: string
	readonly target: EventTarget | null
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
	readonly shiftKey: boolean
	readonly repeat: boolean
}): QueueKey | null => {
	if (
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		// Some layouts need Shift for "/".
		(event.shiftKey && event.key !== "/") ||
		isEditable(event.target) ||
		isInOverlay(event.target)
	)
		return null
	const key = KEYS.get(event.key.length === 1 ? event.key.toLowerCase() : event.key)
	if (key === undefined) return null
	if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !isArrowForQueue(event.target)) return null
	// Holding j/k walks the queue; a held action key acts once.
	if (event.repeat && key !== "next" && key !== "previous") return null
	if ((key === "open" || key === "preview") && isPressable(event.target)) return null
	return key
}

const isMenuOpen = (model: Model) =>
	[model.assignMenu, model.snoozeMenu, model.moreMenu, model.filterMenu, model.sortMenu].some(
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
