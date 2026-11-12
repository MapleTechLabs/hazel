import { Option, Schema } from "effect"
import type { Dom } from "foldkit"
import { combo, identityOf, KeyCombo, type Platform } from "./key-combo"

/**
 * A keymap: every action a key can trigger, declared once, with its default key, where it shows in
 * the shortcut list and the Keybinds settings, and whether the user may rebind it.
 *
 * ```ts
 * const keymap = defineKeymap({
 *   "inbox.open": { label: "Open Inbox", description: "…", category: "Navigation", defaultKey: "Mod+I" },
 *   "composer.send": { label: "Send", description: "…", category: "Composer", defaultKey: "Enter", rebindable: false },
 * })
 * keymap.ActionId            // Schema.Literals of the ids
 * keymap.resolve(overrides)  // the key each action has now (`null`: unbound)
 * keymap.bindings(keys, ids, …) // Foldkit `KeyBinding`s for the ids one subscription owns
 * ```
 *
 * The user's choices are `Overrides`: an action's own key, or `null` to unbind it. They are stored as
 * loose JSON and cleaned on load, so an action that was renamed or removed, or a key that no longer
 * parses, falls back to the default instead of losing every other override.
 */

export interface ActionSpec<Category extends string = string> {
	readonly label: string
	readonly description: string
	readonly category: Category
	/** The default key, in any spelling `combo` accepts; `null` for an action with no default. */
	readonly defaultKey: string | null
	/** Rebindable in settings (default `true`). Fixed keys are listed, and reserved against conflicts. */
	readonly rebindable?: boolean
	/** More keys that do the same; listed, never rebindable (`PageUp` / `PageDown`). */
	readonly alsoKeys?: ReadonlyArray<string>
}

export interface Action<Id extends string, Category extends string> {
	readonly id: Id
	readonly label: string
	readonly description: string
	readonly category: Category
	readonly defaultKey: KeyCombo | null
	readonly rebindable: boolean
	readonly alsoKeys: ReadonlyArray<KeyCombo>
}

/** The user's changes: an action's key, or `null` for "unbound". Missing actions keep their default. */
export const Overrides = Schema.Record(Schema.String, Schema.NullOr(KeyCombo))
export type Overrides = typeof Overrides.Type

/** What storage holds: the same shape, unchecked, so one bad entry cannot void the rest. */
export const StoredOverrides = Schema.Record(Schema.String, Schema.NullOr(Schema.String))

/** The key each action has now. */
export type Keys<Id extends string> = Readonly<Record<Id, KeyCombo | null>>

/** An assignment that took a key away from other actions. */
export interface Assignment<Id extends string> {
	readonly overrides: Overrides
	/** Rebindable actions that had this key and are now unbound. */
	readonly displaced: ReadonlyArray<Id>
	/** Fixed keys that share it: the new binding may not fire where they apply (the composer's Mod+B). */
	readonly shadows: ReadonlyArray<Id>
}

/** How a subscription binds one of its actions; the keys come from the keymap. */
export interface BindingOptions<Output> {
	readonly mapEvent: (event: KeyboardEvent) => Output
	readonly isEnabled?: boolean
	readonly whileTyping?: Dom.WhileTyping
	readonly preventDefault?: boolean
}

const decodeCombo = Schema.decodeUnknownOption(KeyCombo)

export const defineKeymap = <const Specs extends Readonly<Record<string, ActionSpec>>>(specs: Specs) => {
	type Id = Extract<keyof Specs, string>
	type Category = Specs[Id]["category"]

	const ids = Object.keys(specs) as Array<Id>
	const actions: ReadonlyArray<Action<Id, Category>> = ids.map((id) => {
		const spec = specs[id]!
		return {
			id,
			label: spec.label,
			description: spec.description,
			category: spec.category as Category,
			defaultKey: spec.defaultKey === null ? null : combo(spec.defaultKey),
			rebindable: spec.rebindable ?? true,
			alsoKeys: (spec.alsoKeys ?? []).map(combo),
		}
	})
	const byId = Object.fromEntries(actions.map((action) => [action.id, action])) as Readonly<
		Record<Id, Action<Id, Category>>
	>
	const isActionId = (value: string): value is Id => Object.hasOwn(byId, value)
	const ActionId = Schema.Literals(ids as unknown as readonly [Id, ...Array<Id>])

	const defaults = Object.fromEntries(actions.map((action) => [action.id, action.defaultKey])) as Keys<Id>

	/** Drops overrides for unknown actions, fixed actions, and keys that no longer parse. */
	const clean = (stored: Readonly<Record<string, string | null>>): Overrides => {
		const cleaned: Record<string, KeyCombo | null> = {}
		for (const [id, value] of Object.entries(stored)) {
			if (!isActionId(id) || !byId[id].rebindable) continue
			if (value === null) cleaned[id] = null
			else Option.map(decodeCombo(value), (key) => (cleaned[id] = key))
		}
		return cleaned
	}

	const isOverridden = (overrides: Overrides, id: Id): boolean => Object.hasOwn(overrides, id)

	/**
	 * The key of every action: its override, else its default. A default that an overridden action
	 * took is dropped, so no two rebindable actions ever share a key (Foldkit rejects a table with
	 * duplicates, and both actions would fire).
	 */
	const resolve = (overrides: Overrides, platform: Platform): Keys<Id> => {
		const keys: Record<string, KeyCombo | null> = { ...defaults }
		const claimed = new Set<string>()
		for (const action of actions) {
			if (!action.rebindable || !isOverridden(overrides, action.id)) continue
			const key = overrides[action.id] ?? null
			const identity = key === null ? null : identityOf(key, platform)
			keys[action.id] = identity !== null && claimed.has(identity) ? null : key
			if (identity !== null) claimed.add(identity)
		}
		for (const action of actions) {
			if (!action.rebindable || isOverridden(overrides, action.id) || action.defaultKey === null)
				continue
			if (claimed.has(identityOf(action.defaultKey, platform))) keys[action.id] = null
		}
		return keys as Keys<Id>
	}

	/** Sets `id`'s key, unbinding the rebindable actions that had it. */
	const assign = (overrides: Overrides, id: Id, key: KeyCombo, platform: Platform): Assignment<Id> => {
		const keys = resolve(overrides, platform)
		const identity = identityOf(key, platform)
		const sameKey = (other: KeyCombo | null) => other !== null && identityOf(other, platform) === identity
		const displaced = actions
			.filter((action) => action.rebindable && action.id !== id && sameKey(keys[action.id]))
			.map((action) => action.id)
		const shadows = actions
			.filter(
				(action) =>
					!action.rebindable &&
					[action.defaultKey, ...action.alsoKeys].some((other) => sameKey(other)),
			)
			.map((action) => action.id)
		const next: Record<string, KeyCombo | null> = { ...overrides }
		for (const other of displaced) next[other] = null
		// Back on its default, an action needs no override.
		if (byId[id].defaultKey !== null && sameKey(byId[id].defaultKey)) delete next[id]
		else next[id] = key
		return { overrides: next, displaced, shadows }
	}

	/** Leaves `id` with no key. */
	const unbind = (overrides: Overrides, id: Id): Overrides =>
		byId[id].defaultKey === null ? reset(overrides, id) : { ...overrides, [id]: null }

	/** Back to `id`'s default key. Another action using that key now keeps it; `id` stays unbound then. */
	const reset = (overrides: Overrides, id: Id): Overrides => {
		const { [id]: _removed, ...rest } = overrides
		return rest
	}

	/** Foldkit bindings for the actions a subscription owns; unbound actions are left out. */
	const bindings = <Owned extends Id, Output>(
		keys: Keys<Owned>,
		owned: ReadonlyArray<Owned>,
		options: (id: Owned) => BindingOptions<Output>,
	): ReadonlyArray<Dom.KeyBinding<Output>> =>
		owned.flatMap((id) => {
			const key = keys[id]
			if (key === null) return []
			const { mapEvent, isEnabled, whileTyping, preventDefault } = options(id)
			return [{ keys: key, mapEvent, isEnabled, whileTyping, preventDefault }]
		})

	/** The keys an action answers to now: its key, then its fixed extras. */
	const keysOf = (keys: Keys<Id>, id: Id): ReadonlyArray<KeyCombo> => {
		const key = keys[id]
		return key === null ? byId[id].alsoKeys : [key, ...byId[id].alsoKeys]
	}

	return {
		ActionId,
		actions,
		byId,
		defaults,
		isActionId,
		clean,
		isOverridden,
		resolve,
		assign,
		unbind,
		reset,
		bindings,
		keysOf,
	} as const
}
