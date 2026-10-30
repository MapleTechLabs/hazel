export type ConfigOption = {
	id: string
	label: string
	description: string
	type: "toggle" | "input" | "select"
	placeholder?: string
}

export type Integration = {
	id: string
	name: string
	description: string
	fullDescription: string
	logoDomain: string
	logoType?: "symbol" | "icon"
	logoSrc?: string
	brandColor: string
	category: string
	features: string[]
	configOptions: ConfigOption[]
	comingSoon?: boolean
	/** Connection type: "oauth" (default), "api-key", or "webhook" */
	connectionType?: "oauth" | "api-key" | "webhook"
}

// Helper to generate Brandfetch CDN URLs
export const getBrandfetchIcon = (
	domain: string,
	options: { theme?: "light" | "dark"; size?: number; type?: "symbol" | "icon" } = {},
): string => {
	const { theme = "dark", size = 512, type = "symbol" } = options
	return `https://cdn.brandfetch.io/${domain}/w/${size}/h/${size}/theme/${theme}/${type}?token=1id0IQ-4i8Z46-n-DfQ`
}

export const integrations: Integration[] = [
	{
		id: "linear",
		name: "Linear",
		description: "Streamline software projects, sprints, and bug tracking.",
		fullDescription:
			"Connect Linear to automatically sync issues, track progress, and keep your team aligned. Create issues directly from conversations and link existing tickets for seamless project management.",
		logoDomain: "linear.app",
		brandColor: "#5E6AD2",
		category: "developer-tools",
		features: [
			"Create issues from messages",
			"Auto-link Linear tickets",
			"Sync issue status updates",
			"Browse and search issues",
		],
		configOptions: [
			{
				id: "auto-link",
				label: "Auto-link issues",
				description: "Automatically detect and link Linear issue IDs in messages",
				type: "toggle",
			},
			{
				id: "notifications",
				label: "Status notifications",
				description: "Receive notifications when linked issue statuses change",
				type: "toggle",
			},
			{
				id: "default-team",
				label: "Default team",
				description: "Team to use when creating new issues",
				type: "input",
				placeholder: "Select a team...",
			},
		],
	},
	{
		id: "github",
		name: "GitHub",
		description: "Link pull requests and automate workflows.",
		fullDescription:
			"Integrate GitHub to link repositories, track pull requests, and receive notifications about code changes. Streamline your development workflow with automatic PR updates and issue tracking.",
		logoDomain: "github.com",
		brandColor: "#24292F",
		category: "developer-tools",
		features: [
			"Link pull requests",
			"Track code reviews",
			"Automated notifications",
			"Repository browsing",
		],
		configOptions: [
			{
				id: "auto-link-prs",
				label: "Auto-link PRs",
				description: "Automatically detect and link GitHub PR URLs in messages",
				type: "toggle",
			},
			{
				id: "pr-notifications",
				label: "PR notifications",
				description: "Receive notifications for PR status changes",
				type: "toggle",
			},
			{
				id: "default-repo",
				label: "Default repository",
				description: "Repository to use for quick actions",
				type: "input",
				placeholder: "owner/repository",
			},
		],
	},
	{
		id: "figma",
		name: "Figma",
		description: "Embed file previews in projects.",
		fullDescription:
			"Connect Figma to embed design previews directly in your conversations. Share frames, components, and prototypes with rich previews that keep everyone aligned on design decisions.",
		logoDomain: "figma.com",
		brandColor: "#F24E1E",
		logoType: "icon",
		category: "productivity",
		features: ["Embed design previews", "Share specific frames", "Comment sync", "Version tracking"],
		configOptions: [
			{
				id: "auto-preview",
				label: "Auto-preview links",
				description: "Automatically generate previews for Figma links",
				type: "toggle",
			},
			{
				id: "comment-sync",
				label: "Comment sync",
				description: "Sync Figma comments to conversations",
				type: "toggle",
			},
		],
		comingSoon: true,
	},
	{
		id: "notion",
		name: "Notion",
		description: "Embed notion pages and notes in projects.",
		fullDescription:
			"Link your Notion workspace to embed pages, databases, and documents directly in conversations. Keep documentation accessible and up-to-date without switching contexts.",
		logoDomain: "notion.so",
		logoType: "icon",
		brandColor: "#000000",
		category: "productivity",
		features: [
			"Embed pages and databases",
			"Search workspace content",
			"Real-time sync",
			"Rich previews",
		],
		configOptions: [
			{
				id: "auto-preview",
				label: "Auto-preview links",
				description: "Automatically generate previews for Notion links",
				type: "toggle",
			},
			{
				id: "search-enabled",
				label: "Workspace search",
				description: "Enable searching Notion from within conversations",
				type: "toggle",
			},
			{
				id: "default-workspace",
				label: "Default workspace",
				description: "Workspace to search by default",
				type: "input",
				placeholder: "Select workspace...",
			},
		],
		comingSoon: true,
	},
	{
		id: "discord",
		name: "Discord",
		description: "Connect Discord servers for channel syncing.",
		fullDescription:
			"Connect Discord to sync messages between Hazel and Discord channels. Link specific channels, choose sync direction, and keep conversations aligned in real time.",
		logoDomain: "discord.com",
		brandColor: "#5865F2",
		category: "communication",
		features: [
			"OAuth-based Discord connection",
			"Server and channel picker",
			"Bidirectional channel sync",
			"Message create, edit, and delete sync",
		],
		configOptions: [],
	},
	{
		id: "craft",
		name: "Craft",
		description: "Connect your Craft workspace for documents, tasks, and notes.",
		fullDescription:
			"Connect your Craft space to search documents, manage tasks, and add content directly from conversations. Access your notes, folders, and collections without leaving the chat.",
		logoDomain: "craft.do",
		logoType: "icon",
		brandColor: "#1C1C1E",
		category: "productivity",
		connectionType: "api-key",
		features: [
			"Search documents and blocks",
			"Create and edit documents",
			"Manage tasks (inbox, active, upcoming)",
			"Browse folders and collections",
		],
		configOptions: [],
	},
	{
		id: "openstatus",
		name: "OpenStatus",
		description: "Monitor alerts and uptime notifications for your services.",
		fullDescription:
			"Connect OpenStatus to receive monitor alerts directly in your channels. Get instant notifications when your services go down or recover, keeping your team informed about system health.",
		logoDomain: "openstatus.dev",
		logoType: "icon",
		brandColor: "#10B981",
		category: "developer-tools",
		features: [
			"Monitor status alerts",
			"Recovery notifications",
			"Latency tracking",
			"Rich status embeds",
		],
		configOptions: [],
	},
	{
		id: "rss",
		name: "RSS Feeds",
		description: "Subscribe to RSS feeds and post new items to channels.",
		fullDescription:
			"Subscribe channels to RSS and Atom feeds to automatically post new articles, blog posts, and updates. Each feed is polled on a configurable interval with built-in deduplication and error handling.",
		logoDomain: "rss.com",
		logoType: "icon",
		logoSrc:
			"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23F26522'%3E%3Ccircle cx='6.18' cy='17.82' r='2.18'/%3E%3Cpath d='M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z'/%3E%3C/svg%3E",
		brandColor: "#F26522",
		category: "productivity",
		features: [
			"Subscribe to RSS & Atom feeds",
			"Configurable polling intervals",
			"Automatic deduplication",
			"Rich embed previews",
		],
		configOptions: [],
	},
	{
		id: "railway",
		name: "Railway",
		description: "Deployment notifications and alerts for your Railway projects.",
		fullDescription:
			"Connect Railway to receive deployment notifications directly in your channels. Get instant alerts when deployments succeed, fail, or crash, keeping your team informed about your infrastructure status.",
		logoDomain: "railway.com",
		logoType: "icon",
		brandColor: "#0B0D0E",
		category: "developer-tools",
		features: [
			"Deployment status alerts",
			"Build notifications",
			"Crash alerts",
			"Rich deployment embeds",
		],
		configOptions: [],
	},
	{
		id: "maple",
		name: "Maple",
		description: "Observability alerts for traces, latency, and error rates.",
		fullDescription:
			"Connect Maple to receive alerts directly in your channels when error rates spike, latency degrades, or custom rules trip. Each alert includes severity, observed values, and deep links back to the incident and Maple AI chat.",
		logoDomain: "maple.dev",
		logoType: "icon",
		brandColor: "#10B981",
		category: "developer-tools",
		connectionType: "webhook",
		features: [
			"Trigger, resolve, and renotify events",
			"Severity-aware embed coloring",
			"Deep links to incident & AI chat",
			"Test deliveries from Maple",
		],
		configOptions: [],
	},
]

export const categories = [
	{ id: "all", label: "View all" },
	{ id: "developer-tools", label: "Developer tools" },
	{ id: "communication", label: "Communication" },
	{ id: "productivity", label: "Productivity" },
]

export const getIntegrationById = (id: string): Integration | undefined => {
	return integrations.find((i) => i.id === id)
}
