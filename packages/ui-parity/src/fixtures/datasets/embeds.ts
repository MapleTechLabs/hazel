import type { ActorScript, Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { richDataset } from "./rich.ts"
import { asset, at, orgId, userId as richUserId, type PersonKey } from "./rich/base.ts"

/**
 * The `rich` workspace plus message content that reaches past the Hazel backend: link previews and
 * tweets (the link-preview worker), YouTube, GIFs, and AI replies streamed by the Rivet message
 * actor. `backend/network.ts` and `backend/rivet.ts` answer from `network` and `actors` below.
 */

export const embedChannelKeys = ["unfurls", "tweets", "videos", "gifs", "ai-replies", "ai-live"] as const
export type EmbedChannelKey = (typeof embedChannelKeys)[number]

const channelId = (key: EmbedChannelKey) => stableId(`embeds:channel:${key}`)
const messageId = (key: string) => stableId(`embeds:message:${key}`)
const assistantId = stableId("embeds:user:assistant")

const message = (input: {
	readonly key: string
	readonly channel: EmbedChannelKey
	readonly author: PersonKey | "assistant"
	readonly time: string
	readonly content: string
	readonly embeds?: ReadonlyArray<Record<string, unknown>>
}): Row => ({
	id: messageId(input.key),
	channelId: channelId(input.channel),
	conversationId: null,
	authorId: input.author === "assistant" ? assistantId : richUserId(input.author),
	content: input.content,
	embeds: input.embeds ?? null,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt: at(0, input.time),
	updatedAt: null,
	deletedAt: null,
})

// MARK: Link previews

const syncArticle = "https://blog.example.com/posts/sync-engine"
const plainArticle = "https://notes.example.org/launch-retro"

const linkPreviews: Record<string, unknown> = {
	[syncArticle]: {
		url: syncArticle,
		title: "How we built a sync engine on Postgres logical replication",
		description:
			"Shapes, offsets and the long-poll loop behind realtime collections, and what we learned running it for a year.",
		image: { url: asset("previews/sync-engine-1200x630.png") },
		publisher: "Example Engineering",
	},
	[plainArticle]: {
		url: plainArticle,
		title: "Launch retro: what went well",
		publisher: "Notes",
	},
}

// MARK: Tweets

const tweetId = "1890000000000000001"
const missingTweetId = "1890000000000000002"

/** A syndication-API tweet with entity indices computed from the text, as Twitter sends them. */
const buildTweet = () => {
	const text =
		"Realtime sync just landed in Hazel. Read the write-up: https://t.co/hz4sync #buildinpublic cc @electric_sql"
	const span = (part: string) => {
		const start = text.indexOf(part)
		return [start, start + part.length]
	}
	return {
		__typename: "Tweet",
		id_str: tweetId,
		lang: "en",
		created_at: "2026-03-11T18:30:00.000Z",
		text,
		display_text_range: [0, text.length],
		entities: {
			hashtags: [{ indices: span("#buildinpublic"), text: "buildinpublic" }],
			user_mentions: [
				{ indices: span("@electric_sql"), screen_name: "electric_sql", name: "ElectricSQL", id_str: "2" },
			],
			urls: [
				{
					indices: span("https://t.co/hz4sync"),
					url: "https://t.co/hz4sync",
					display_url: "hazel.sh/blog/sync",
					expanded_url: "https://hazel.sh/blog/sync",
				},
			],
			symbols: [],
		},
		user: {
			id_str: "1",
			name: "Hazel",
			screen_name: "hazelchat",
			profile_image_url_https: asset("avatars/hazelchat-96x96.png"),
			verified: false,
			is_blue_verified: true,
			profile_image_shape: "Circle",
		},
		photos: [
			{ url: asset("tweets/sync-diagram-1200x675.png"), width: 1200, height: 675, expandedUrl: "" },
			{ url: asset("tweets/sync-latency-1200x675.png"), width: 1200, height: 675, expandedUrl: "" },
		],
		favorite_count: 1280,
		conversation_count: 42,
		reply_count: 42,
		retweet_count: 0,
	}
}

// MARK: AI replies (Rivet message actor)

const idleState = {
	status: "idle",
	data: {},
	text: "",
	isStreaming: false,
	progress: null,
	error: null,
	startedAt: null,
	completedAt: null,
	steps: [],
	currentStepIndex: null,
}

const answer =
	"Here is what shipped today:\n\n- **api** v2.4 with the new `presence` endpoint\n- **web** rolled back to `7f3c2a1` after the login regression\n\nNothing is blocking the launch."

/** Token-sized chunks of `text`, each event carrying the text so far (`textChunk`'s `fullText`). */
const chunks = (text: string, size: number) => {
	const events = []
	for (let end = size; end < text.length + size; end += size) {
		const fullText = text.slice(0, Math.min(end, text.length))
		events.push({ name: "textChunk", payload: { chunk: fullText.slice(end - size), fullText } })
	}
	return events
}

const streamedEvents = chunks(answer, 24)

const actors: Record<string, ActorScript> = {
	[messageId("ai:completed")]: {
		state: idleState,
		events: [
			{ name: "started", payload: { data: {} } },
			...streamedEvents,
			{ name: "streamEnd", payload: { text: answer } },
			{ name: "completed", payload: { data: {} } },
		],
	},
	[messageId("ai:streaming")]: {
		state: idleState,
		events: [
			{ name: "started", payload: { data: {} } },
			{ name: "progress", payload: { progress: 40 } },
			...streamedEvents.slice(0, Math.ceil(streamedEvents.length / 2)),
		],
	},
	[messageId("ai:thinking")]: {
		state: idleState,
		events: [{ name: "started", payload: { data: {} } }],
	},
}

const live = (extra: Record<string, unknown> = {}) => [{ liveState: { enabled: true, ...extra } }]

// MARK: Messages

const messages: Row[] = [
	message({
		key: "unfurl:article",
		channel: "unfurls",
		author: "grace",
		time: "10:00",
		content: `Great write-up on the sync engine ${syncArticle}`,
	}),
	message({
		key: "unfurl:plain",
		channel: "unfurls",
		author: "alan",
		time: "10:20",
		content: plainArticle,
	}),
	message({
		key: "unfurl:missing",
		channel: "unfurls",
		author: "margaret",
		time: "10:40",
		content: "This one has no preview: https://unfurl.example.net/nothing-here",
	}),
	message({
		key: "tweet:launch",
		channel: "tweets",
		author: "linus",
		time: "11:00",
		content: `https://x.com/hazelchat/status/${tweetId}`,
	}),
	message({
		key: "tweet:missing",
		channel: "tweets",
		author: "katherine",
		time: "11:30",
		content: `Deleted already? https://twitter.com/someone/status/${missingTweetId}`,
	}),
	message({
		key: "video:talk",
		channel: "videos",
		author: "margaret",
		time: "12:00",
		content: "The sync talk from last week https://www.youtube.com/watch?v=sYnCtAlk01&t=1m30s",
	}),
	message({
		key: "video:short",
		channel: "videos",
		author: "alan",
		time: "12:10",
		content: "https://youtu.be/sHoRtClip9",
	}),
	message({
		key: "gif:giphy",
		channel: "gifs",
		author: "linus",
		time: "13:00",
		content: "https://media.giphy.com/media/shipit42/giphy.gif",
	}),
	message({
		key: "gif:klipy",
		channel: "gifs",
		author: "katherine",
		time: "13:05",
		content: "https://static.klipy.com/ii/parity/celebrate-320x240.gif",
	}),
	message({
		key: "ai:question",
		channel: "ai-replies",
		author: "ada",
		time: "14:00",
		content: "What shipped today?",
	}),
	message({ key: "ai:completed", channel: "ai-replies", author: "assistant", time: "14:01", content: "", embeds: live() }),
	message({
		key: "ai:cached",
		channel: "ai-replies",
		author: "assistant",
		time: "14:20",
		content: "",
		embeds: live({ cached: { status: "completed", data: {}, text: "Cached answer: the deploy finished at **14:12**." } }),
	}),
	message({
		key: "ai:failed",
		channel: "ai-replies",
		author: "assistant",
		time: "14:40",
		content: "",
		embeds: live({ cached: { status: "failed", data: {}, error: "The model provider timed out." } }),
	}),
	message({
		key: "ai:streaming",
		channel: "ai-live",
		author: "assistant",
		time: "14:50",
		content: "",
		embeds: live(),
	}),
	message({
		key: "ai:thinking",
		channel: "ai-live",
		author: "assistant",
		time: "14:55",
		content: "",
		embeds: live({ loading: { text: "Analyzing deploys", icon: "brain" } }),
	}),
]

// MARK: Workspace rows

const channelNames: Record<EmbedChannelKey, string> = {
	unfurls: "unfurls",
	tweets: "tweets",
	videos: "videos",
	gifs: "gifs",
	"ai-replies": "ai-replies",
	"ai-live": "ai-live",
}

const channels: Row[] = embedChannelKeys.map((key) => ({
	id: channelId(key),
	name: channelNames[key],
	icon: null,
	type: "public",
	organizationId: orgId,
	parentChannelId: null,
	sectionId: null,
	createdAt: at(-30, "12:00"),
	updatedAt: null,
	deletedAt: null,
}))

const members: ReadonlyArray<PersonKey> = ["ada", "grace", "alan", "margaret", "linus", "katherine"]
const channelMembers: Row[] = embedChannelKeys.flatMap((channel) =>
	members.map((person) => ({
		id: stableId(`embeds:channel-member:${channel}:${person}`),
		channelId: channelId(channel),
		userId: richUserId(person),
		isHidden: false,
		isMuted: false,
		isFavorite: false,
		lastSeenMessageId: null,
		notificationCount: 0,
		joinedAt: at(-30, "12:00"),
		createdAt: at(-30, "12:00"),
		deletedAt: null,
	})),
)

const assistant: Row = {
	id: assistantId,
	externalId: "bot_assistant",
	email: "assistant@bots.hazel.test",
	firstName: "Hazel AI",
	lastName: "",
	avatarUrl: asset("avatars/assistant-128x128.png"),
	userType: "machine",
	settings: null,
	isOnboarded: true,
	timezone: null,
	createdAt: at(-60, "12:00"),
	updatedAt: null,
	deletedAt: null,
}

const assistantBot: Row = {
	id: stableId("embeds:bot:assistant"),
	userId: assistantId,
	createdBy: richUserId("ada"),
	name: "Hazel AI",
	description: "Answers questions about your workspace",
	webhookUrl: null,
	apiTokenHash: "fixture-token-hash-assistant",
	scopes: null,
	metadata: null,
	isPublic: false,
	installCount: 1,
	allowedIntegrations: null,
	mentionable: false,
	createdAt: at(-60, "12:00"),
	updatedAt: null,
	deletedAt: null,
}

const base = richDataset.tables

export const embedsDataset: Dataset = {
	...richDataset,
	name: "embeds",
	tables: {
		...base,
		users: [...base.users!, assistant],
		bots: [...base.bots!, assistantBot],
		channels: [...base.channels!, ...channels],
		channel_members: [...base.channel_members!, ...channelMembers],
		messages: [...base.messages!, ...messages],
	},
	network: { linkPreviews, tweets: { [tweetId]: buildTweet() } },
	actors,
}

/** Scenario paths into the embeds channels. */
export const embedsChat = (key: EmbedChannelKey) => `/hazel/chat/${channelId(key)}`
