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
	/** A bundled brand glyph (no background), drawn padded on the logo tile. Falls back to Brandfetch. */
	logoSrc?: string
	brandColor: string
	category: string
	features: string[]
	configOptions: ConfigOption[]
	comingSoon?: boolean
	/**
	 * Connection type: "oauth" (default), "api-key", "webhook", or "environment" (T3 Code: each member
	 * links their own environment by its address, then signs in to it)
	 */
	connectionType?: "oauth" | "api-key" | "webhook" | "environment"
}

// Helper to generate Brandfetch CDN URLs
export const getBrandfetchIcon = (
	domain: string,
	options: { theme?: "light" | "dark"; size?: number; type?: "symbol" | "icon" } = {},
): string => {
	const { theme = "dark", size = 512, type = "symbol" } = options
	return `https://cdn.brandfetch.io/${domain}/w/${size}/h/${size}/theme/${theme}/${type}?token=1id0IQ-4i8Z46-n-DfQ`
}

/** The bundled glyph, or Brandfetch's light icon (which carries its own padding). */
export const integrationLogoSrc = (integration: Integration): string =>
	integration.logoSrc ??
	getBrandfetchIcon(integration.logoDomain, { theme: "light", type: integration.logoType ?? "icon" })

export const integrations: Integration[] = [
	{
		id: "linear",
		logoSrc: "/images/integrations/linear.svg",
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
		logoSrc: "/images/integrations/github.svg",
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
		logoSrc: "/images/integrations/figma.svg",
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
		logoSrc: "/images/integrations/notion.svg",
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
		logoSrc: "/images/integrations/discord.svg",
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
		id: "slack",
		logoSrc: "/images/integrations/slack.svg",
		name: "Slack",
		description: "Connect a Slack workspace for channel syncing.",
		fullDescription:
			"Install Hazel in your Slack workspace to sync messages between Hazel and Slack channels. Link specific channels, choose sync direction, and keep threads and reactions aligned in real time. Synced messages post as each Hazel author.",
		logoDomain: "slack.com",
		brandColor: "#4A154B",
		category: "communication",
		features: [
			"OAuth install in your Slack workspace",
			"Channel picker",
			"Bidirectional channel sync",
			"Threads and reactions sync",
		],
		configOptions: [],
	},
	{
		id: "craft",
		logoSrc: "/images/integrations/craft.png",
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
		id: "t3code",
		logoSrc: "/images/integrations/t3code.svg",
		name: "T3 Code",
		description: "Drive T3 Code threads on your own machine from Hazel.",
		fullDescription:
			"Link your T3 Code environment to start and steer its threads with /t3 from any conversation. Each member links their own machine and chooses who else in the organization may drive it; every action is posted in the Hazel thread.",
		logoDomain: "t3.codes",
		brandColor: "#1C1C1E",
		category: "developer-tools",
		connectionType: "environment",
		features: [
			"Start threads with /t3",
			"Reply in Hazel to steer the agent",
			"Each member links their own machine",
			"Share with the whole team or chosen members",
		],
		configOptions: [],
	},
	{
		id: "openstatus",
		logoSrc: "/images/integrations/openstatus.svg",
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
		logoSrc: "/images/integrations/rss.svg",
		name: "RSS Feeds",
		description: "Subscribe to RSS feeds and post new items to channels.",
		fullDescription:
			"Subscribe channels to RSS and Atom feeds to automatically post new articles, blog posts, and updates. Each feed is polled on a configurable interval with built-in deduplication and error handling.",
		logoDomain: "rss.com",
		logoType: "icon",
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
		logoSrc: "/images/integrations/railway.svg",
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
		logoSrc: "/images/integrations/maple.svg",
		name: "Maple",
		description: "Ask Maple about your services, and get its alerts in your channels.",
		fullDescription:
			"Mention @Maple in a channel to investigate errors, latency, traces and logs, and approve the changes it proposes right in the thread. Maple can also post alerts when error rates spike, latency degrades, or custom rules trip, with severity, observed values and deep links back to the incident.",
		logoDomain: "maple.dev",
		logoType: "icon",
		brandColor: "#E86F00",
		category: "developer-tools",
		connectionType: "webhook",
		features: [
			"Ask @Maple in any channel",
			"Answers in a thread, with charts and links",
			"Approve proposed changes with a button",
			"Alerts that trigger, resolve and renotify",
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
