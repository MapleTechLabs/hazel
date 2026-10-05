import { Atom } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { normalizeHotkey, validateHotkey, type Hotkey } from "@tanstack/react-hotkeys"
import { Schema } from "effect"
import { useCallback } from "react"
import type { AppHotkeyDefinition } from "~/lib/hotkeys/hotkey-registry"
import {
	HOTKEY_DEFINITIONS,
	HOTKEY_DEFINITIONS_BY_ID,
	isAppHotkeyActionId,
	type AppHotkeyActionId,
} from "~/lib/hotkeys/hotkey-registry"
import { platformStorageRuntime } from "~/lib/platform-storage"

const HotkeyOverridesSchema = Schema.Record(Schema.String, Schema.String)

type HotkeyOverrides = typeof HotkeyOverridesSchema.Type

const DEFAULT_HOTKEYS = HOTKEY_DEFINITIONS.reduce(
	(accumulator, definition) => {
		accumulator[definition.id as AppHotkeyActionId] = definition.defaultHotkey
		return accumulator
	},
	{} as Record<AppHotkeyActionId, Hotkey>,
)

export interface ResolvedHotkeyDefinition extends AppHotkeyDefinition {
	id: AppHotkeyActionId
	resolvedHotkey: Hotkey
	isOverridden: boolean
}

export const hotkeyOverridesAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "hazel-hotkey-overrides",
	schema: Schema.toCodecIso(HotkeyOverridesSchema),
	defaultValue: () => ({}) as HotkeyOverrides,
}).pipe(Atom.keepAlive)

const toValidHotkey = (hotkey: string): Hotkey | null => {
	const validationResult = validateHotkey(hotkey)
	if (!validationResult.valid) return null
	return normalizeHotkey(hotkey) as Hotkey
}

export function sanitizeHotkeyOverrides(
	rawOverrides: Record<string, string> | null | undefined,
): Partial<Record<AppHotkeyActionId, Hotkey>> {
	if (!rawOverrides) return {}

	const sanitized: Partial<Record<AppHotkeyActionId, Hotkey>> = {}
	for (const [actionId, rawHotkey] of Object.entries(rawOverrides)) {
		if (!isAppHotkeyActionId(actionId)) continue
		const validHotkey = toValidHotkey(rawHotkey)
		if (!validHotkey) continue
		sanitized[actionId] = validHotkey
	}

	return sanitized
}

export function resolveHotkeys(
	rawOverrides: Record<string, string> | null | undefined,
): Record<AppHotkeyActionId, Hotkey> {
	const sanitizedOverrides = sanitizeHotkeyOverrides(rawOverrides)
	const resolved = { ...DEFAULT_HOTKEYS }

	for (const [actionId, hotkey] of Object.entries(sanitizedOverrides)) {
		resolved[actionId as AppHotkeyActionId] = hotkey
	}

	return resolved
}

export const resolvedHotkeysAtom = Atom.make((get) => {
	return resolveHotkeys(get(hotkeyOverridesAtom))
}).pipe(Atom.keepAlive)

export const resolvedHotkeysCatalogAtom = Atom.make((get) => {
	const resolvedHotkeys = get(resolvedHotkeysAtom)
	const sanitizedOverrides = sanitizeHotkeyOverrides(get(hotkeyOverridesAtom))

	return HOTKEY_DEFINITIONS.map((definition) => {
		const actionId = definition.id as AppHotkeyActionId
		const resolvedHotkey = resolvedHotkeys[actionId]
		const isOverridden = sanitizedOverrides[actionId] !== undefined

		return {
			...definition,
			id: actionId,
			resolvedHotkey,
			isOverridden,
		}
	}) as ReadonlyArray<ResolvedHotkeyDefinition>
}).pipe(Atom.keepAlive)

export const useResolvedHotkey = (actionId: AppHotkeyActionId): Hotkey => {
	const resolvedHotkeys = useAtomValue(resolvedHotkeysAtom)
	return resolvedHotkeys[actionId] ?? HOTKEY_DEFINITIONS_BY_ID[actionId].defaultHotkey
}

export const useResolvedHotkeysCatalog = (): ReadonlyArray<ResolvedHotkeyDefinition> => {
	return useAtomValue(resolvedHotkeysCatalogAtom)
}

export const useSetHotkeyOverride = () => {
	const setHotkeyOverrides = useAtomSet(hotkeyOverridesAtom)

	return useCallback(
		(actionId: AppHotkeyActionId, hotkey: string): boolean => {
			const validHotkey = toValidHotkey(hotkey)
			if (!validHotkey) return false

			setHotkeyOverrides((overrides) => ({
				...overrides,
				[actionId]: validHotkey,
			}))
			return true
		},
		[setHotkeyOverrides],
	)
}

export const useResetHotkeyOverride = () => {
	const setHotkeyOverrides = useAtomSet(hotkeyOverridesAtom)

	return useCallback(
		(actionId: AppHotkeyActionId) => {
			setHotkeyOverrides((overrides) => {
				if (!(actionId in overrides)) return overrides
				const nextOverrides = { ...overrides }
				delete nextOverrides[actionId]
				return nextOverrides
			})
		},
		[setHotkeyOverrides],
	)
}

export const useResetAllHotkeyOverrides = () => {
	const setHotkeyOverrides = useAtomSet(hotkeyOverridesAtom)
	return useCallback(() => setHotkeyOverrides(() => ({})), [setHotkeyOverrides])
}
