import { Atom } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Schema } from "effect"
import { useCallback } from "react"
import { platformStorageRuntime } from "~/lib/platform-storage"

const HINT_IDS = ["command-palette", "create-channel"] as const

export type HintId = (typeof HINT_IDS)[number]

const DismissedHintsSchema = Schema.Record(Schema.String, Schema.Boolean)

export const dismissedHintsAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "hazel-dismissed-hints",
	schema: Schema.toCodecIso(DismissedHintsSchema),
	defaultValue: () => ({}) as Record<string, boolean>,
}).pipe(Atom.keepAlive)

export function useFeatureHint(hintId: HintId) {
	const dismissed = useAtomValue(dismissedHintsAtom)
	const setDismissed = useAtomSet(dismissedHintsAtom)

	const isDismissed = dismissed[hintId] === true

	const dismiss = useCallback(() => {
		setDismissed((prev) => ({ ...prev, [hintId]: true }))
	}, [hintId, setDismissed])

	return { isDismissed, dismiss, shouldShow: !isDismissed }
}
