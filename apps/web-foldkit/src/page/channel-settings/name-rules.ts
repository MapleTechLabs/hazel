import { makeRules, Rule, type Rules } from "foldkit/fieldValidation"

/** arktype `name: "1<string<101"` (exclusive bounds): 2 to 100 characters, with copy naming the field. */
const nameRules = (label: string): Rules<string> =>
	makeRules({
		required: `${label} is required`,
		rules: [
			Rule.minLength(2, `${label} must be at least 2 characters`),
			Rule.maxLength(100, `${label} must be at most 100 characters`),
		],
	})

/** The channel settings form's name. */
export const channelNameRules = nameRules("Channel name")

/** The create-webhook form's name (the same bounds as a channel's). */
export const webhookNameRules = nameRules("Webhook name")
