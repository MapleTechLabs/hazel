const ACTOR_AUTH_ERROR_CODES = new Set(["unauthorized", "invalid_token", "auth_unavailable"])

const ACTOR_AUTH_ERROR_SNIPPETS = [
	"invalid bot token",
	"failed to validate bot token",
	"failed to get response",
	"not found",
	"404",
	"authentication service unavailable",
	"authentication required",
] as const

export const ACTOR_SERVICE_ERROR_UI_TITLE = "Service error"

export const ACTOR_SERVICE_ERROR_UI_MESSAGE =
	"The bot couldn't reach a required backend service, so it couldn't finish this response. Please try again in a moment."

export const ACTOR_SERVICE_ERROR_BOT_MESSAGE =
	"I couldn't complete this response because a required backend service is unavailable. Please try again in a moment."

const RECURSIVE_KEYS = ["cause", "message", "code", "name", "_tag"] as const

function collectRelevantValues(value: unknown, values: Set<string>, seen: WeakSet<object>): void {
	if (typeof value === "string") {
		values.add(value)
		return
	}

	if (typeof value === "number") {
		values.add(String(value))
		return
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectRelevantValues(item, values, seen)
		}
		return
	}

	if (typeof value !== "object" || value === null) {
		return
	}

	if (seen.has(value)) {
		return
	}
	seen.add(value)

	for (const key of RECURSIVE_KEYS) {
		if (key in value) {
			collectRelevantValues((value as Record<string, unknown>)[key], values, seen)
		}
	}
}

export function isTemporaryActorServiceError(error: unknown): boolean {
	const values = new Set<string>()
	collectRelevantValues(error, values, new WeakSet())

	for (const rawValue of values) {
		const value = rawValue.toLowerCase()
		if (ACTOR_AUTH_ERROR_CODES.has(value)) {
			return true
		}

		for (const snippet of ACTOR_AUTH_ERROR_SNIPPETS) {
			if (value.includes(snippet)) {
				return true
			}
		}
	}

	return false
}
