"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { cn } from "~/lib/utils"
import { Embed, useEmbedTheme } from "../embeds"
import { extractGitHubInfo } from "../link-preview"

interface GitHubPREmbedProps {
	url: string
	orgId: OrganizationId
}

// PR state colors - matches GitHub's design system
const PR_STATE_CONFIG = {
	open: { label: "Open", color: "#238636" },
	closed: { label: "Closed", color: "#da3633" },
	merged: { label: "Merged", color: "#8957e5" },
	draft: { label: "Draft", color: "#6e7681" },
} as const

type PRState = keyof typeof PR_STATE_CONFIG

// PR Open icon
function PROpenIcon({ className }: { className?: string }) {
	return (
		<svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
			<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
		</svg>
	)
}

// PR Merged icon
function PRMergedIcon({ className }: { className?: string }) {
	return (
		<svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
		</svg>
	)
}

// PR Closed icon
function PRClosedIcon({ className }: { className?: string }) {
	return (
		<svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
			<path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.28a.75.75 0 0 1 1.06 0l.97.97.97-.97a.749.749 0 1 1 1.06 1.06l-.97.97.97.97a.749.749 0 1 1-1.06 1.06l-.97-.97-.97.97a.749.749 0 1 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
		</svg>
	)
}

// Status badge component
function PRStatusBadge({ state }: { state: PRState }) {
	const config = PR_STATE_CONFIG[state]
	const Icon = state === "merged" ? PRMergedIcon : state === "closed" ? PRClosedIcon : PROpenIcon

	return (
		<span
			className="flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]"
			style={{
				backgroundColor: `${config.color}18`,
				color: config.color,
			}}
		>
			<Icon className="size-3" />
			{config.label}
		</span>
	)
}

// Author avatar component
function AuthorAvatar({ login, avatarUrl }: { login: string; avatarUrl?: string | null }) {
	return (
		<div className="flex items-center gap-1.5">
			{avatarUrl ? (
				<img src={avatarUrl} alt="" className="size-5 rounded-full ring-1 ring-border/50" />
			) : (
				<div className="flex size-5 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-fg">
					{login.charAt(0).toUpperCase()}
				</div>
			)}
			<span className="text-muted-fg text-xs">{login}</span>
		</div>
	)
}

// Diff stats component
function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
	return (
		<div className="flex items-center gap-1.5 font-medium text-[10px]">
			<span className="text-success-subtle-fg">+{additions}</span>
			<span className="text-danger-subtle-fg">-{deletions}</span>
		</div>
	)
}

// Label badge component
function LabelBadge({ name, color }: { name: string; color: string }) {
	const fullColor = color.startsWith("#") ? color : `#${color}`
	return (
		<span
			className="rounded-full px-1.5 py-0.5 font-medium text-[10px]"
			style={{
				backgroundColor: `${fullColor}30`,
				color: fullColor,
			}}
		>
			{name}
		</span>
	)
}

// GitHub PR data type (for when the API is implemented)
export interface GitHubPRData {
	owner: string
	repo: string
	number: number
	title: string
	body?: string | null
	state: "open" | "closed"
	draft?: boolean
	merged?: boolean
	author?: {
		login: string
		avatarUrl?: string | null
	}
	additions?: number
	deletions?: number
	headRefName?: string
	updatedAt?: string
	labels?: Array<{ name: string; color: string }>
}

interface GitHubPREmbedWithDataProps {
	url: string
	data: GitHubPRData
}

/**
 * GitHub PR embed with pre-fetched data.
 * Use this when you already have the PR data.
 */
export function GitHubPREmbedWithData({ url, data }: GitHubPREmbedWithDataProps) {
	const theme = useEmbedTheme("github")

	// Determine PR state
	const prState: PRState = data.merged
		? "merged"
		: data.draft
			? "draft"
			: data.state === "closed"
				? "closed"
				: "open"

	// Build fields array
	const fields = []

	if (data.author) {
		fields.push({
			name: "Author",
			value: <AuthorAvatar login={data.author.login} avatarUrl={data.author.avatarUrl} />,
			inline: true,
		})
	}

	if (data.additions !== undefined && data.deletions !== undefined) {
		fields.push({
			name: "Changes",
			value: <DiffStats additions={data.additions} deletions={data.deletions} />,
			inline: true,
		})
	}

	if (data.labels) {
		for (const label of data.labels.slice(0, 2)) {
			fields.push({
				name: "Label",
				value: <LabelBadge name={label.name} color={label.color} />,
				inline: true,
			})
		}

		if (data.labels.length > 2) {
			fields.push({
				name: "More",
				value: <span className="text-[10px] text-muted-fg">+{data.labels.length - 2}</span>,
				inline: true,
			})
		}
	}

	return (
		<Embed accentColor={theme.color} url={url} className="group">
			<Embed.Author
				iconUrl={theme.iconUrl}
				name={`${data.owner}/${data.repo}`}
				url={`https://github.com/${data.owner}/${data.repo}`}
				trailing={<PRStatusBadge state={prState} />}
			/>
			<Embed.Body title={`#${data.number} ${data.title}`} description={data.body} />
			{fields.length > 0 && <Embed.Fields fields={fields} />}
			{data.headRefName && (
				<Embed.Footer
					text={data.headRefName}
					timestamp={data.updatedAt ? new Date(data.updatedAt) : undefined}
				/>
			)}
		</Embed>
	)
}

/**
 * GitHub PR embed that fetches data from URL.
 * Fetches PR data from the backend API using the organization's GitHub connection.
 */
export function GitHubPREmbed({ url, orgId }: GitHubPREmbedProps) {
	const theme = useEmbedTheme("github")
	const info = extractGitHubInfo(url)
	const prLabel = info ? `#${info.number}` : undefined

	const resourceResult = useAtomValue(
		HazelApiClient.query("integration-resources", "fetchGitHubPR", {
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
				resourceLabel={prLabel}
				description="Connect GitHub to see PR details inline"
			/>
		))
		.onErrorTag("IntegrationResourceError", (error) => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message={error.message}
				url={url}
				resourceLabel={prLabel}
			/>
		))
		.onErrorTag("ResourceNotFoundError", (error) => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message={error.message ?? "PR not found"}
				url={url}
				resourceLabel={prLabel}
			/>
		))
		.onError(() => (
			<Embed.Error
				iconUrl={theme.iconUrl}
				accentColor={theme.color}
				message="Could not load content"
				url={url}
				resourceLabel={prLabel}
			/>
		))
		.onSuccess((pr) => {
			if (!pr) {
				return (
					<Embed.Error
						iconUrl={theme.iconUrl}
						accentColor={theme.color}
						message="PR not found"
						url={url}
						resourceLabel={prLabel}
					/>
				)
			}

			// Determine PR state
			const prState: PRState = pr.merged
				? "merged"
				: pr.draft
					? "draft"
					: pr.state === "closed"
						? "closed"
						: "open"

			// Build fields array
			const fields = []

			if (pr.author) {
				fields.push({
					name: "Author",
					value: <AuthorAvatar login={pr.author.login} avatarUrl={pr.author.avatarUrl} />,
					inline: true,
				})
			}

			if (pr.additions !== undefined && pr.deletions !== undefined) {
				fields.push({
					name: "Changes",
					value: <DiffStats additions={pr.additions} deletions={pr.deletions} />,
					inline: true,
				})
			}

			if (pr.labels && pr.labels.length > 0) {
				for (const label of pr.labels.slice(0, 2)) {
					fields.push({
						name: "Label",
						value: <LabelBadge name={label.name} color={label.color} />,
						inline: true,
					})
				}

				if (pr.labels.length > 2) {
					fields.push({
						name: "More",
						value: <span className="text-[10px] text-muted-fg">+{pr.labels.length - 2}</span>,
						inline: true,
					})
				}
			}

			return (
				<Embed accentColor={theme.color} url={url} className="group">
					<Embed.Author
						iconUrl={theme.iconUrl}
						name={`${pr.owner}/${pr.repo}`}
						url={`https://github.com/${pr.owner}/${pr.repo}`}
						trailing={<PRStatusBadge state={prState} />}
					/>
					<Embed.Body title={`#${pr.number} ${pr.title}`} description={pr.body} />
					{fields.length > 0 && <Embed.Fields fields={fields} />}
					{pr.headRefName && (
						<Embed.Footer
							text={pr.headRefName}
							timestamp={pr.updatedAt ? new Date(pr.updatedAt) : undefined}
						/>
					)}
				</Embed>
			)
		})
		.render()
}
