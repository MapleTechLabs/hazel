/**
 * The channel name's rules (today's `page/channel-settings/name-rules.ts`, arktype `1<string<101`):
 * 2 to 100 characters, with copy naming the field. The webhook form (PS9) uses the same bounds.
 */

/** The first rule `value` breaks, or null when it passes. */
export const nameError =
	(label: string) =>
	(value: string): string | null =>
		value.length === 0
			? `${label} is required`
			: value.length < 2
				? `${label} must be at least 2 characters`
				: value.length > 100
					? `${label} must be at most 100 characters`
					: null

/** The channel settings form's name. */
export const channelNameError = nameError("Channel name")

/** The create-webhook form's name. */
export const webhookNameError = nameError("Webhook name")
