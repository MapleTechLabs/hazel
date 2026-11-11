import { WEBHOOK_BOT_CONFIGS } from "../common/bot-configs.ts"
import type { BadgeIntent, MessageEmbed, MessageEmbedField } from "../common/embed-types.ts"
import { getEventCategory, getRailwayEventConfig } from "./colors.ts"
import type { RailwayPayload } from "./payloads.ts"

const railwayConfig = WEBHOOK_BOT_CONFIGS.railway

/**
 * Build embed for Railway webhook event.
 * Supports deployment events, alerts, and other Railway notifications.
 */
export function buildRailwayEmbed(payload: RailwayPayload): MessageEmbed {
	const { type, details, resource, severity, timestamp } = payload

	// Parse event type (e.g., "Deployment.failed" -> ["Deployment", "failed"])
	const [category, action] = type.split(".")
	const eventConfig = getRailwayEventConfig(action ?? type, severity)
	const eventCategory = getEventCategory(type)

	// Build service/project info
	const serviceName = resource.service?.name ?? "Unknown Service"
	const projectName = resource.project.name
	const envName = resource.environment?.name

	// Title: Service name in project
	const title = `${serviceName} in ${projectName}`

	// Description: environment with badge or category context
	const description = envName
		? `Environment: [[info:${envName}]]`
		: category !== "Deployment"
			? `${eventCategory}`
			: undefined

	// Badge: Status indicator (e.g., "Deployed", "Crashed")
	const badge = {
		text: eventConfig.label,
		color: eventConfig.color,
	}

	// Build fields based on available data
	const fields: MessageEmbedField[] = []

	// Branch with badge (if available)
	if (details.branch) {
		fields.push({
			name: "Branch",
			value: details.branch,
			type: "badge",
			inline: true,
		})
	}

	// Commit info (if available)
	if (details.commitHash) {
		const shortHash = details.commitHash.slice(0, 7)
		const prefix = `\`${shortHash}\``
		const commitValue = details.commitMessage
			? `${prefix} - ${details.commitMessage.split("\n")[0]}`
			: prefix
		fields.push({
			name: "Commit",
			value: commitValue.length > 1024 ? `${commitValue.slice(0, 1021)}...` : commitValue,
			inline: false,
		})
	}

	// Author (if available)
	if (details.commitAuthor) {
		fields.push({
			name: "Author",
			value: details.commitAuthor,
			inline: true,
		})
	}

	// Source (if available and not already shown)
	if (details.source && details.source !== "GitHub") {
		fields.push({
			name: "Source",
			value: details.source,
			inline: true,
		})
	}

	// Severity with badge (if available and noteworthy)
	if (severity && severity !== "INFO") {
		const severityIntent: BadgeIntent =
			severity === "ERROR" || severity === "CRITICAL"
				? "danger"
				: severity === "WARNING"
					? "warning"
					: "secondary"
		fields.push({
			name: "Severity",
			value: severity,
			type: "badge",
			options: { intent: severityIntent },
			inline: true,
		})
	}

	return {
		title,
		description,
		url: undefined,
		color: eventConfig.color,
		author: {
			name: "Railway",
			url: "https://railway.app",
			iconUrl: railwayConfig.avatarUrl,
		},
		footer: {
			text: resource.workspace.name,
			iconUrl: undefined,
		},
		image: undefined,
		thumbnail: undefined,
		fields: fields.length > 0 ? fields : undefined,
		timestamp,
		badge,
	}
}
