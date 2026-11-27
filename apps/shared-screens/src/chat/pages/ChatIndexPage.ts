// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/chat` on a wide screen (`web-foldkit/src/page/chat-index`, now deleted): every channel
 * the user is in, by tab (public, private, direct messages), each a card that opens it. A phone
 * shows the shell's channel list here instead.
 */
import { UiSchema } from "@effect/ui"
import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"
import { OpenModal } from "../../app/requests"
import { Session } from "../../app/session"
import {
	ChannelGroups,
	ChannelMarks,
	type ChannelSummary,
	cardList,
	channelCard,
	chatIndexSubscriptions,
	dmCard,
	EMPTY_GROUPS,
	NO_MARKS,
	Presence,
	scopeOf,
} from "../components/ChannelCards"

export const ChatIndexTab = Schema.Literals(["public", "private", "dms"])
export type ChatIndexTab = typeof ChatIndexTab.Type

export const ChatIndexMessage = UiSchema.TaggedEnum({
	UpdatedChannels: { groups: ChannelGroups },
	UpdatedPresence: { presence: Schema.Record(Schema.String, Presence) },
	UpdatedMarks: { marks: ChannelMarks },
	PickedTab: { id: Schema.String },
	PressedCreateChannel: {},
	PressedStartConversation: {},
})
export type ChatIndexMessage = typeof ChatIndexMessage.Type

export const ChatIndexProps = Schema.Struct({ session: Session })
export type ChatIndexProps = typeof ChatIndexProps.Type

export const ChatIndexModel = Schema.Struct({
	loaded: Schema.Boolean,
	groups: ChannelGroups,
	presence: Schema.Record(Schema.String, Presence),
	marks: ChannelMarks,
	tab: ChatIndexTab,
})
export type ChatIndexModel = typeof ChatIndexModel.Type

const TAB_LABELS: Record<ChatIndexTab, string> = {
	public: "Public",
	private: "Private",
	dms: "Direct messages",
}

const channelsOf = (groups: ChannelGroups, tab: ChatIndexTab): ReadonlyArray<ChannelSummary> =>
	Match.value(tab).pipe(
		Match.when("public", () => groups.publicChannels),
		Match.when("private", () => groups.privateChannels),
		Match.when("dms", () => groups.dmChannels),
		Match.exhaustive,
	)

const isTab = Schema.is(ChatIndexTab)

const ChatIndexDef = Hazel.component({
	name: "ChatIndexPage",
	props: ChatIndexProps,
	model: ChatIndexModel,
	message: ChatIndexMessage,
})

type H = Parameters<Parameters<typeof ChatIndexDef.make>[0]["view"]>[0]

const createButton = (h: H, label: string, message: ChatIndexMessage) =>
	h.button.label(label).icon("plus").variant("secondary").size("small").on("press", message)

/** A tab with no channels says what it would hold, and offers to make one when the user may. */
const emptyPanel = (h: H, tab: ChatIndexTab, canCreate: boolean) =>
	Match.value(tab).pipe(
		Match.when("public", () =>
			h.emptyState
				.icon("hashtag")
				.title("No public channels")
				.description("Public channels are open for everyone in the organization to join.")
				.action(
					canCreate
						? createButton(h, "Create a channel", ChatIndexMessage.PressedCreateChannel())
						: undefined,
				),
		),
		Match.when("private", () =>
			h.emptyState
				.icon("lock")
				.title("No private channels")
				.description("Private channels are invite-only spaces for focused discussions.")
				.action(
					canCreate
						? createButton(h, "Create a private channel", ChatIndexMessage.PressedCreateChannel())
						: undefined,
				),
		),
		Match.when("dms", () =>
			h.emptyState
				.icon("messages")
				.title("No direct messages")
				.description("Start a conversation with someone in your organization.")
				.action(createButton(h, "Start a conversation", ChatIndexMessage.PressedStartConversation())),
		),
		Match.exhaustive,
	)

export const ChatIndexPage = ChatIndexDef.make({
	init: () => ({
		loaded: false,
		groups: EMPTY_GROUPS,
		presence: {},
		marks: NO_MARKS,
		tab: "public" as const,
	}),
	update: {
		UpdatedChannels: ($, { groups }) => $.evolve({ groups: () => groups, loaded: () => true }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence: () => presence }),
		UpdatedMarks: ($, { marks }) => $.evolve({ marks: () => marks }),
		PickedTab: ($, { id }) => (isTab(id) ? $.evolve({ tab: () => id }) : $.model),
		PressedCreateChannel: ($) => $.run(OpenModal.make({ modal: { _tag: "NewChannel" } })),
		PressedStartConversation: ($) => $.run(OpenModal.make({ modal: { _tag: "CreateDm" } })),
	},
	subscriptions: ({ props, model }) =>
		chatIndexSubscriptions<ChatIndexMessage>(scopeOf(props.session), model.groups, {
			channels: (groups) => ChatIndexMessage.UpdatedChannels({ groups }),
			presence: (presence) => ChatIndexMessage.UpdatedPresence({ presence }),
			marks: (marks) => ChatIndexMessage.UpdatedMarks({ marks }),
		}),
	view: (h, model) => {
		const scope = scopeOf(h.props.session)
		if (scope === null || !model.loaded)
			return h.screen
				.key("chat-index")
				.surface("page")
				.children(h.progress.style("spinner").label("Loading..."))
		const { member } = h.props.session
		const canCreate = member !== null && canPerform(RPC_SCOPE_MAP, member.role, "channel.create")
		const channels = channelsOf(model.groups, model.tab)
		const card = (channel: ChannelSummary) =>
			model.tab === "dms"
				? dmCard(h, scope.orgSlug, channel, scope.userId, model.presence)
				: channelCard(h, scope.orgSlug, channel, model.marks)
		// HAZEL-GAP(p4-screen-page-column): today is a padded column under a display title; `page` is the phone bar.
		return h.screen
			.key("chat-index")
			.surface("page")
			.title("All channels")
			.subtitle("Discover communities and join the discussions that matter to you.")
			.children(
				h.tabBar
					.style("page")
					.tabs(
						ChatIndexTab.literals.map((tab) => ({
							id: tab,
							label: TAB_LABELS[tab],
							badge: channelsOf(model.groups, tab).length,
						})),
					)
					.selected(model.tab)
					.on("change", ({ id }) => ChatIndexMessage.PickedTab({ id })),
				channels.length === 0
					? emptyPanel(h, model.tab, canCreate)
					: cardList(h, model.tab, channels.map(card)),
			)
	},
})
