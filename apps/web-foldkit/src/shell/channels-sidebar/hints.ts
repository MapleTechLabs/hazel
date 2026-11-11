import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { readStored, writeStored } from "../../data/storage"
import { Message } from "./model"

/**
 * `useFeatureHint` (`atoms/feature-discovery-atoms.ts`): dismissed hints live in the same
 * `hazel-dismissed-hints` storage entry, JSON-encoded like `Atom.kvs` writes it.
 */

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

export const PersistDismissedHint = Command.define("PersistDismissedHint", {
	args: { hintId: Schema.String },
	messages: [Message.CompletedPersistDismissedHint, Message.FailedPersistDismissedHint],
	execute: ({ hintId }) =>
		readHints.pipe(
			Effect.flatMap((hints) => writeStored(STORAGE_KEY, DismissedHints, { ...hints, [hintId]: true })),
			Effect.as(Message.CompletedPersistDismissedHint()),
			Effect.catchTag("StorageWriteError", () => Effect.succeed(Message.FailedPersistDismissedHint())),
		),
})
