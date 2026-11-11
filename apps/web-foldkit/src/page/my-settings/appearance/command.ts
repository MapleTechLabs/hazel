import { Effect } from "effect"
import { Command } from "foldkit"
import { generateRemixOptions } from "~/lib/theme/remix"
import { Message } from "./message"

/**
 * `ThemeRemixSection.handleGenerate`: the legacy generator (Math.random), shown after its 150ms delay.
 * Generating before the delay keeps the draws independent of the fiber scheduling around it.
 */
export const GenerateRemixOptions = Command.define("GenerateRemixOptions", {
	messages: [Message.GeneratedRemixOptions],
	execute: Effect.sync(() =>
		Message.GeneratedRemixOptions({
			options: generateRemixOptions(4).map(({ primary, grayPalette, radius }) => ({
				primary,
				grayPalette,
				radius,
			})),
		}),
	).pipe(Effect.tap(() => Effect.sleep("150 millis"))),
})
