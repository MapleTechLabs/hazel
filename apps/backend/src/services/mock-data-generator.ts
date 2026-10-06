import {
	ChannelMemberRepo,
	ChannelRepo,
	ChannelSectionRepo,
	MessageRepo,
	OrganizationMemberRepo,
	UserRepo,
} from "@hazel/backend-core"
import type {
	ChannelIcon,
	ChannelId,
	ChannelSectionId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Context, Effect, Layer } from "effect"

// Professional team members for a tech startup
const TEAM_MEMBERS = [
	{
		firstName: "Sarah",
		lastName: "Chen",
		role: "Product Manager",
		avatarSeed: "sarah-chen",
	},
	{
		firstName: "Marcus",
		lastName: "Johnson",
		role: "Engineering Lead",
		avatarSeed: "marcus-johnson",
	},
	{
		firstName: "Emily",
		lastName: "Rodriguez",
		role: "Senior Designer",
		avatarSeed: "emily-rodriguez",
	},
	{
		firstName: "Alex",
		lastName: "Kim",
		role: "Backend Engineer",
		avatarSeed: "alex-kim",
	},
	{
		firstName: "Jordan",
		lastName: "Lee",
		role: "Frontend Engineer",
		avatarSeed: "jordan-lee",
	},
	{
		firstName: "Taylor",
		lastName: "Patel",
		role: "DevOps Engineer",
		avatarSeed: "taylor-patel",
	},
	{
		firstName: "Casey",
		lastName: "Williams",
		role: "QA Engineer",
		avatarSeed: "casey-williams",
	},
] as const

// Channel organization with sections (with emoji icons)
const CHANNEL_SECTIONS = [
	{
		name: "General",
		channels: [
			{ name: "general", type: "public" as const, icon: "💬" },
			{ name: "announcements", type: "public" as const, icon: "📢" },
			{ name: "random", type: "public" as const, icon: "🎲" },
		],
	},
	{
		name: "Engineering",
		channels: [
			{ name: "engineering", type: "public" as const, icon: "⚙️" },
			{ name: "backend", type: "private" as const, icon: "🔧" },
			{ name: "frontend", type: "private" as const, icon: "🎨" },
			{ name: "devops", type: "private" as const, icon: "🚀" },
		],
	},
	{
		name: "Design",
		channels: [
			{ name: "design", type: "public" as const, icon: "✨" },
			{ name: "feedback", type: "public" as const, icon: "💭" },
		],
	},
	{
		name: "Product",
		channels: [
			{ name: "product", type: "public" as const, icon: "📊" },
			{ name: "roadmap", type: "private" as const, icon: "🗺️" },
		],
	},
] as const

// Realistic messages per channel (tech startup context)
const CHANNEL_MESSAGES: Record<string, string[]> = {
	general: [
		"Hey team! Quick reminder - all-hands at 2pm today",
		"Just saw the Product Hunt launch. Congrats everyone!",
		"Who's up for lunch? Thinking about trying the new Thai place",
		"Great work on the release last night",
		"Has anyone seen the latest metrics dashboard?",
	],
	announcements: [
		"We just closed our Series A! More details coming soon",
		"New PTO policy is live. Check Notion for details",
		"Welcome to our new team members joining this week!",
		"Office will be closed for the holiday next Monday",
	],
	random: [
		"Anyone watching the game tonight?",
		"Just found an amazing coffee shop near the office",
		"Happy Friday everyone!",
		"Check out this cool open source project I found",
	],
	engineering: [
		"Just pushed the fix for the auth issue. PR #342 is up for review",
		"Heads up - deploying to staging in 10 mins",
		"Anyone else seeing latency spikes on the API?",
		"Migrated the user service to the new cluster. All green",
		"Code review session at 3pm - bring your PRs",
		"New coding standards doc is in the wiki",
	],
	backend: [
		"Database migration completed successfully",
		"Added caching layer to the user endpoints",
		"Need a second pair of eyes on this query optimization",
		"API rate limiting is now live on production",
	],
	frontend: [
		"New component library version is ready",
		"Fixed the responsive layout issues on mobile",
		"Bundle size reduced by 15% with the latest changes",
		"Dark mode is finally working correctly",
	],
	devops: [
		"Kubernetes cluster upgraded to 1.28",
		"CI pipeline is 40% faster now",
		"Set up new monitoring alerts for the payment service",
		"Terraform configs updated for the new region",
	],
	design: [
		"New dashboard mockups are ready in Figma - link in thread",
		"Can someone review the onboarding flow? Need feedback by EOD",
		"Updated the component library with the new button variants",
		"Design system documentation is now live",
		"User research findings from last week are in the doc",
	],
	feedback: [
		"Great feedback from the usability testing session",
		"Users are loving the new navigation",
		"Some concerns about the checkout flow - let's discuss",
		"NPS score improved by 12 points this quarter!",
	],
	product: [
		"Q1 roadmap is finalized. Sharing the doc now",
		"Customer feedback from the beta is really positive",
		"Prioritizing the billing feature for next sprint",
		"Competitor analysis doc is ready for review",
		"Sprint planning tomorrow at 10am",
	],
	roadmap: [
		"Mobile app launch moved to Q2",
		"Enterprise features are now top priority",
		"API v2 timeline confirmed for March",
		"Integration partnerships update in the doc",
	],
}

interface MockDataConfig {
	organizationId: OrganizationId
	currentUserId: UserId
}

export class MockDataGenerator extends Context.Service<MockDataGenerator>()("MockDataGenerator", {
	make: Effect.gen(function* () {
		const generateForMarketingScreenshots = (config: MockDataConfig) =>
			Effect.gen(function* () {
				const userRepo = yield* UserRepo
				const channelRepo = yield* ChannelRepo
				const channelSectionRepo = yield* ChannelSectionRepo
				const messageRepo = yield* MessageRepo
				const orgMemberRepo = yield* OrganizationMemberRepo
				const channelMemberRepo = yield* ChannelMemberRepo

				const organizationId = config.organizationId

				// 1. Create team members
				const userDataArray = TEAM_MEMBERS.map((member, i) => ({
					externalId: `mock_${organizationId}_${Date.now()}_${i}`,
					email: `${member.firstName.toLowerCase()}.${member.lastName.toLowerCase()}@example.com`,
					firstName: member.firstName,
					lastName: member.lastName,
					avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${member.avatarSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
					userType: "user" as const,
					status: (["online", "offline", "away"] as const)[i % 3],
					lastSeen: new Date(),
					settings: null,
					isOnboarded: true,
					timezone: "America/Los_Angeles",
					deletedAt: null,
				}))

				const users = yield* Effect.forEach(userDataArray, (userData) => userRepo.insert(userData), {
					concurrency: 5,
				})

				// 4. Add all team members to the organization
				const orgMembersData = users.map((userResult, i) => ({
					organizationId,
					userId: userResult[0]!.id as UserId,
					role: (i === 0 ? "admin" : "member") as "owner" | "admin" | "member",
					nickname: undefined,
					joinedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random join date in last 30 days
					invitedBy: config.currentUserId,
					deletedAt: null,
				}))

				yield* Effect.forEach(orgMembersData, (memberData) => orgMemberRepo.insert(memberData), {
					concurrency: 5,
				})

				// 5. Create channel sections and channels
				const allChannels: Array<{ id: ChannelId; name: string; type: string }> = []
				const createdSections: Array<{ id: ChannelSectionId; name: string }> = []

				for (let sectionIndex = 0; sectionIndex < CHANNEL_SECTIONS.length; sectionIndex++) {
					const sectionDef = CHANNEL_SECTIONS[sectionIndex]!

					// Create section
					const sectionResult = yield* channelSectionRepo.insert({
						organizationId,
						name: sectionDef.name,
						order: sectionIndex,
						deletedAt: null,
					})
					const section = sectionResult[0]!
					createdSections.push({ id: section.id as ChannelSectionId, name: section.name })

					// Create channels in this section
					for (const channelDef of sectionDef.channels) {
						const channelResult = yield* channelRepo.insert({
							organizationId,
							name: channelDef.name,
							icon: channelDef.icon as ChannelIcon,
							type: channelDef.type,
							parentChannelId: null,
							sectionId: section.id as ChannelSectionId,
							deletedAt: null,
						})
						const channel = channelResult[0]!
						allChannels.push({
							id: channel.id as ChannelId,
							name: channel.name,
							type: channelDef.type,
						})
					}
				}

				// 6. Add all users (including current user) to channels
				const allUserIds = [config.currentUserId, ...users.map((u) => u[0]!.id as UserId)]

				const channelMembersData = allChannels.flatMap((channel) => {
					// For private channels, only add ~60% of users (but always include current user)
					const usersToAdd =
						channel.type === "private"
							? allUserIds.filter((_, i) => i === 0 || Math.random() < 0.6)
							: allUserIds

					return usersToAdd.map((userId, i) => ({
						channelId: channel.id,
						userId,
						isHidden: false,
						isMuted: false,
						isFavorite: channel.name === "general" && i === 0, // Current user favorites general
						lastSeenMessageId: null,
						notificationCount: 0,
						joinedAt: new Date(),
						deletedAt: null,
					}))
				})

				const channelMembers = yield* Effect.forEach(
					channelMembersData,
					(memberData) => channelMemberRepo.insert(memberData),
					{ concurrency: 10 },
				)

				// 7. Generate messages for each channel
				const allMessages: Array<{ id: MessageId; channelId: ChannelId; content: string }> = []
				const messagesByChannel: Map<string, MessageId[]> = new Map()

				for (const channel of allChannels) {
					const channelMessages = CHANNEL_MESSAGES[channel.name] || []

					// Get users who are members of this channel
					const channelUserIds =
						channel.type === "private"
							? allUserIds.filter((_, i) => i === 0 || Math.random() < 0.6)
							: allUserIds

					// Create messages with realistic timestamps (spread over last 7 days)
					const messageDataArray = channelMessages.map((content, i) => {
						const authorId = channelUserIds[i % channelUserIds.length]!
						const daysAgo = Math.random() * 7
						const hoursAgo = Math.random() * 24
						const timestamp = new Date(
							Date.now() - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000,
						)

						return {
							channelId: channel.id,
							authorId,
							content,
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
							createdAt: timestamp,
						}
					})

					// Sort by timestamp
					messageDataArray.sort(
						(a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0),
					)

					const messages = yield* Effect.forEach(
						messageDataArray,
						(messageData) => messageRepo.insert(messageData),
						{ concurrency: 5 },
					)

					const channelMessageIds: MessageId[] = []
					for (const msgResult of messages) {
						const msg = msgResult[0]!
						allMessages.push({
							id: msg.id as MessageId,
							channelId: channel.id,
							content: msg.content,
						})
						channelMessageIds.push(msg.id as MessageId)
					}
					messagesByChannel.set(channel.name, channelMessageIds)
				}

				// 8. Add reply messages to some channels
				const replyMessages = [
					{
						channel: "engineering",
						replyTo: 0,
						content: "Awesome, I'll review the PR now!",
						authorIndex: 2,
					},
					{
						channel: "engineering",
						replyTo: 1,
						content: "Thanks for the heads up!",
						authorIndex: 3,
					},
					{ channel: "general", replyTo: 2, content: "Count me in for lunch!", authorIndex: 4 },
					{ channel: "general", replyTo: 0, content: "See you all there!", authorIndex: 5 },
					{
						channel: "design",
						replyTo: 0,
						content: "Love the new direction! Great work",
						authorIndex: 1,
					},
					{
						channel: "product",
						replyTo: 0,
						content: "This looks great, excited for Q1!",
						authorIndex: 0,
					},
				]

				for (const reply of replyMessages) {
					const channelMsgIds = messagesByChannel.get(reply.channel)
					const channel = allChannels.find((c) => c.name === reply.channel)
					if (!channelMsgIds || !channel || !channelMsgIds[reply.replyTo]) continue

					const replyResult = yield* messageRepo.insert({
						channelId: channel.id,
						authorId: allUserIds[reply.authorIndex % allUserIds.length]!,
						content: reply.content,
						embeds: null,
						replyToMessageId: channelMsgIds[reply.replyTo]!,
						threadChannelId: null,
						deletedAt: null,
					})
					allMessages.push({
						id: replyResult[0]!.id as MessageId,
						channelId: channel.id,
						content: reply.content,
					})
				}

				// 9. Create a thread on the design channel (Figma mockups discussion)
				let threadCount = 0
				const designChannel = allChannels.find((c) => c.name === "design")
				const designMsgIds = messagesByChannel.get("design")

				if (designChannel && designMsgIds && designMsgIds[0]) {
					// Create thread channel
					const threadResult = yield* channelRepo.insert({
						organizationId,
						name: "Thread",
						icon: null,
						type: "thread",
						parentChannelId: designChannel.id,
						sectionId: null,
						deletedAt: null,
					})
					const threadChannel = threadResult[0]!
					threadCount++

					// Update the parent message to link to the thread channel
					const parentMessageId = designMsgIds[0]!
					yield* messageRepo.update({
						id: parentMessageId,
						threadChannelId: threadChannel.id as ChannelId,
					})

					// Add thread messages
					const threadMessages = [
						{ content: "Here's the Figma link: figma.com/file/abc123", authorIndex: 2 },
						{ content: "The navigation looks much cleaner now", authorIndex: 1 },
						{ content: "Should we add a dark mode toggle to the header?", authorIndex: 4 },
						{ content: "Good idea! I'll add that to the next iteration", authorIndex: 2 },
						{ content: "Love it! Ship it 🚀", authorIndex: 0 },
					]

					// Add users to thread channel
					for (const userId of allUserIds.slice(0, 5)) {
						yield* channelMemberRepo.insert({
							channelId: threadChannel.id as ChannelId,
							userId,
							isHidden: false,
							isMuted: false,
							isFavorite: false,
							lastSeenMessageId: null,
							notificationCount: 0,
							joinedAt: new Date(),
							deletedAt: null,
						})
					}

					for (let i = 0; i < threadMessages.length; i++) {
						const msg = threadMessages[i]!
						const msgResult = yield* messageRepo.insert({
							channelId: threadChannel.id as ChannelId,
							authorId: allUserIds[msg.authorIndex % allUserIds.length]!,
							content: msg.content,
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
						})
						allMessages.push({
							id: msgResult[0]!.id as MessageId,
							channelId: threadChannel.id as ChannelId,
							content: msg.content,
						})
					}
				}

				return {
					summary: {
						users: users.length,
						channels: allChannels.length,
						channelSections: createdSections.length,
						messages: allMessages.length,
						organizationMembers: users.length,
						channelMembers: channelMembers.length,
						threads: threadCount,
					},
				}
			})

		return {
			generateForMarketingScreenshots,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
