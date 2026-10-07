import { Effect, Option, Schema, Stream } from "effect"
import { Command } from "foldkit"
import { Message } from "./model"

/**
 * `useFeatureHint` (`atoms/feature-discovery-atoms.ts`): dismissed hints live in the same
 * `hazel-dismissed-hints` localStorage entry, JSON-encoded like `Atom.kvs` writes it.
 */

const STORAGE_KEY = "hazel-dismissed-hints"
const DismissedHints = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Boolean))
const decodeHints = Schema.decodeUnknownOption(DismissedHints)
const encodeHints = Schema.encodeSync(DismissedHints)

const readHints = Effect.sync(
	(): Readonly<Record<string, boolean>> =>
		Option.getOrElse(decodeHints(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}"), () => ({})),
)

/** Emits whether the create-channel hint was dismissed, once, at startup. */
export const dismissedHintStream = Stream.fromEffect(readHints).pipe(
	Stream.map((hints) =>
		Message.LoadedDismissedHints({ isCreateChannelHintDismissed: hints["create-channel"] === true }),
	),
)

export const PersistDismissedHint = Command.define("PersistDismissedHint", {
	args: { hintId: Schema.String },
	messages: [Message.CompletedPersistDismissedHint],
	execute: ({ hintId }) =>
		Effect.flatMap(readHints, (hints) =>
			Effect.sync(() => {
				globalThis.localStorage?.setItem(STORAGE_KEY, encodeHints({ ...hints, [hintId]: true }))
				return Message.CompletedPersistDismissedHint()
			}),
		),
})
