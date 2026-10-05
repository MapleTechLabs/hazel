"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { cn } from "~/lib/utils"
import { Embed, embedSectionStyles, useEmbedTheme } from "../embeds"
import { extractLinearIssueKey } from "../link-preview"

interface LinearIssueEmbedProps {
	url: string
	orgId: OrganizationId
}

// Linear's priority colors - matches their design system
const PRIORITY_CONFIG = {
	0: { label: "No priority", color: "text-fg/40", bg: "bg-fg/5" },
	1: { label: "Urgent", color: "text-danger-subtle-fg", bg: "bg-danger-subtle" },
	2: { label: "High", color: "text-warning-subtle-fg", bg: "bg-warning-subtle" },
	3: { label: "Medium", color: "text-warning-subtle-fg", bg: "bg-warning-subtle" },
	4: { label: "Low", color: "text-info-subtle-fg", bg: "bg-info-subtle" },
} as const

// Priority icon SVG
function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
	const config = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG[0]

	if (priority === 0) {
		return (
			<svg className={cn("size-3.5", config.color, className)} viewBox="0 0 16 16" fill="currentColor">
				<rect x="1" y="8" width="3" height="6" rx="1" opacity="0.4" />
				<rect x="6" y="5" width="3" height="9" rx="1" opacity="0.4" />
				<rect x="11" y="2" width="3" height="12" rx="1" opacity="0.4" />
			</svg>
		)
	}

	const bars = priority === 1 ? 3 : priority === 2 ? 2 : priority === 3 ? 1 : 0

	return (
		<svg className={cn("size-3.5", config.color, className)} viewBox="0 0 16 16" fill="currentColor">
			<rect x="1" y="8" width="3" height="6" rx="1" opacity={bars >= 1 ? 1 : 0.3} />
			<rect x="6" y="5" width="3" height="9" rx="1" opacity={bars >= 2 ? 1 : 0.3} />
			<rect x="11" y="2" width="3" height="12" rx="1" opacity={bars >= 3 ? 1 : 0.3} />
		</svg>
	)
}

// Status badge component
function StatusBadge({ name, color }: { name: string; color: string }) {
	return (
		<span
			className="rounded-full px-2 py-0.5 font-medium text-[11px]"
			style={{
				backgroundColor: `${color}18`,
				color: color,
			}}
		>
			{name}
		</span>
	)
}

// Assignee avatar component
function AssigneeAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
	return (
		<div className="flex items-center gap-1.5">
			{avatarUrl ? (
				<img src={avatarUrl} alt="" className="size-5 rounded-full ring-1 ring-border/50" />
			) : (
				<div className="flex size-5 items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-fg">
					{name.charAt(0).toUpperCase()}
				</div>
			)}
			<span className="text-muted-fg text-xs">{name}</span>
		</div>
	)
}

// Priority badge component
function PriorityBadge({ priority, label }: { priority: number; label: string }) {
	const config = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG[0]

	return (
		<div
			className={cn(
				"flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[10px]",
				config.bg,
				config.color,
			)}
		>
			<PriorityIcon priority={priority} />
			<span>{label}</span>
		</div>
	)
}

// Label badge component
function LabelBadge({ name, color }: { name: string; color: string }) {
	return (
		<span
			className="rounded px-1.5 py-0.5 font-medium text-[10px]"
			style={{
				backgroundColor: `${color}18`,
				color: color,
			}}
		>
			{name}
		</span>
	)
}

export function LinearIssueEmbed({ url, orgId }: LinearIssueEmbedProps) {
	const theme = useEmbedTheme("linear")
	const issueKey = extractLinearIssueKey(url) ?? undefined

	const resourceResult = useAtomValue(
		HazelApiClient.query("integration-resources", "fetchLinearIssue", {
			params: { orgId },
			query: { url },
			timeToLive: "3 minutes",
		}),
	)

	return AsyncResult.builder(resourceResult)
		.onInitial(() => <Embed.Skeleton accentColor={theme.color} />)
		.onErrorTag("IntegrationNotConnectedForPreviewError", () => (
			<Embed.ConnectPrompt
				providerName={theme.name}
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				resourceLabel={issueKey}
			/>
		))
		.onErrorTag("IntegrationResourceError", (error) => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message={error.message}
				url={url}
				resourceLabel={issueKey}
			/>
		))
		.onErrorTag("ResourceNotFoundError", (error) => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message={error.message ?? "Issue not found"}
				url={url}
				resourceLabel={issueKey}
			/>
		))
		.onError(() => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message="Could not load content"
				url={url}
				resourceLabel={issueKey}
			/>
		))
		.onSuccess((issue) => {
			if (!issue) {
				return (
					<Embed.Error
						iconUrl={theme.iconUrl}
						accentColor={theme.color}
						message="Issue not found"
						url={url}
						resourceLabel={issueKey}
					/>
				)
			}

			// Build fields array for priority and labels
			const fields = []

			if (issue.priority > 0) {
				fields.push({
					name: "Priority",
					value: <PriorityBadge priority={issue.priority} label={issue.priorityLabel} />,
					inline: true,
				})
			}

			// Add labels (max 2, with overflow indicator)
			for (const label of issue.labels.slice(0, 2)) {
				fields.push({
					name: "Label",
					value: <LabelBadge name={label.name} color={label.color} />,
					inline: true,
				})
			}

			if (issue.labels.length > 2) {
				fields.push({
					name: "More",
					value: <span className="text-[10px] text-muted-fg">+{issue.labels.length - 2}</span>,
					inline: true,
				})
			}

			return (
				<Embed accentColor={theme.color} url={url} className="group">
					<Embed.Author
						iconUrl={theme.iconUrl}
						name={
							<span className="flex items-center gap-1.5">
								<span className="text-muted-fg">{issue.teamName}</span>
								<span className="text-muted-fg/50">/</span>
								<span>{issue.identifier}</span>
							</span>
						}
						trailing={
							issue.state && <StatusBadge name={issue.state.name} color={issue.state.color} />
						}
					/>
					<Embed.Body title={issue.title} description={issue.description} />
					{fields.length > 0 && <Embed.Fields fields={fields} />}
					{issue.assignee && (
						<div className={cn(embedSectionStyles({ position: "bottom" }), "bg-muted/20")}>
							<AssigneeAvatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} />
						</div>
					)}
				</Embed>
			)
		})
		.render()
}
