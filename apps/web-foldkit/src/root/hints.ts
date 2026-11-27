/**
 * `useFeatureHint` (`atoms/feature-discovery-atoms.ts`): dismissed hints live in the same
 * `hazel-dismissed-hints` storage entry, JSON-encoded like `Atom.kvs` writes it.
 */
import { Effect, Option, Schema } from "effect"
import { readStored, writeStored } from "../data/storage"

const STORAGE_KEY = "hazel-dismissed-hints"
const DismissedHints = Schema.toCodecJson(Schema.Record(Schema.String, Schema.Boolean))

/** Every dismissed hint; missing or undecodable storage reads as none dismissed. */
const readHints = readStored(STORAGE_KEY, DismissedHints).pipe(
	Effect.map(Option.getOrElse((): Readonly<Record<string, boolean>> => ({}))),
)

/** Whether the create-channel hint was dismissed; the root reads it once at boot, before the first render. */
export const loadIsCreateChannelHintDismissed: Effect.Effect<boolean> = readHints.pipe(
	Effect.map((hints) => hints["create-channel"] === true),
)

// Dismissed since boot: a sidebar mounted again (another org, back from settings) keeps it hidden.
const dismissedNow = new Set<string>()

export const isDismissedNow = (hintId: string): boolean => dismissedNow.has(hintId)

/** Hides `hintId` for the session and stores it; full or blocked storage only brings it back next boot. */
export const persistDismissedHint = (hintId: string): Effect.Effect<void> =>
	Effect.sync(() => dismissedNow.add(hintId)).pipe(
		Effect.andThen(readHints),
		Effect.flatMap((hints) => writeStored(STORAGE_KEY, DismissedHints, { ...hints, [hintId]: true })),
		Effect.catchTag("StorageWriteError", () => Effect.void),
	)
