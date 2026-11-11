import { Prompt } from "effect/cli"
import { Effect, Redacted } from "effect"
import type { EnvReadResult } from "./services/env-writer.ts"
import { getEnvValues, maskSecret, type EnvValue } from "./templates.ts"

const NEW_VALUE_OPTION = "__NEW_VALUE__"

/**
 * Smart prompt that prefills from existing env values.
 * - No values: standard text prompt
 * - Single value: text prompt with default
 * - Multiple values: select prompt with options
 */
export const promptWithExisting = (options: {
	key: string
	message: string
	envResult: EnvReadResult
	validate?: (value: string) => Effect.Effect<string, string>
	isSecret?: boolean
}) =>
	Effect.gen(function* () {
		const { key, message, envResult, validate, isSecret = false } = options
		const existingValues = getEnvValues(envResult, key)

		// No existing values - standard prompt
		if (existingValues.length === 0) {
			if (isSecret) {
				const result = yield* Prompt.Password({ message })
				// Redacted is an opaque type, need to handle it
				return Redacted.value(result)
			}
			return yield* Prompt.String({
				message,
				validate: validate ?? ((s) => Effect.succeed(s)),
			})
		}

		// Single value - use as default
		if (existingValues.length === 1) {
			const existing = existingValues[0]
			const displayValue = isSecret ? maskSecret(existing.value) : existing.value
			const defaultMessage = `${message} [${displayValue}]`

			if (isSecret) {
				const result = yield* Prompt.String({
					message: defaultMessage,
					validate: (s) => {
						// Empty input means keep existing
						if (s === "") return Effect.succeed(existing.value)
						if (validate) return validate(s)
						return Effect.succeed(s)
					},
				})
				return result
			}

			return yield* Prompt.String({
				message: defaultMessage,
				default: existing.value,
				validate: validate ?? ((s) => Effect.succeed(s)),
			})
		}

		// Multiple values - select prompt
		const choices = existingValues.map((ev) => ({
			title: isSecret
				? `${maskSecret(ev.value)} (from ${ev.source})`
				: `${ev.value} (from ${ev.source})`,
			value: ev.value,
		}))
		choices.push({ title: "Enter a new value", value: NEW_VALUE_OPTION })

		const selected = yield* Prompt.Select({
			message: `Select ${key}`,
			choices,
		})

		if (selected === NEW_VALUE_OPTION) {
			if (isSecret) {
				const result = yield* Prompt.Password({ message })
				return (result as any).value ?? result
			}
			return yield* Prompt.String({
				message,
				validate: validate ?? ((s) => Effect.succeed(s)),
			})
		}

		return selected
	})

/**
 * Get existing value or undefined (for auto-reuse scenarios like secrets)
 */
export const getExistingValue = (envResult: EnvReadResult, key: string): EnvValue | undefined => {
	const values = getEnvValues(envResult, key)
	return values.length > 0 ? values[0] : undefined
}
