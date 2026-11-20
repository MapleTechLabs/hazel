import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { ChannelId, CustomerAccountId, CustomerChannelLinkId, UserId } from "@hazel/schema"
import { Context as EffectContext, Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import type { CustomerAuthorInfo, ChatParticipantRow } from "../../../customers/chat-authors"
import { toAccountRow } from "../../../customers/queries"
import { ACCOUNTS_BY_KEY } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared } from "../../../test/pages-fixtures"
import type { Message } from "./message"
import type { Model } from "./model"
import type { Context } from "./parts"
import { peopleInChat } from "./people-in-chat"
import { init } from "./update"
import { sidebarSection } from "./view"

/**
 * The customer page's "People in chat" section: empty, with customers and a person marked as our
 * team, in light and dark and at phone width. Not a test: `bun run gallery` writes
 * `people-in-chat-*.png` beside this file.
 */

const render = (view: (h: HtmlBuilder<Message>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		EffectContext.make(Dispatch, dispatch).pipe(
			EffectContext.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<Message>())
		const container = document.createElement("div")
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const NOW = Date.UTC(2026, 10, 20, 12)
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const account = toAccountRow(ACCOUNTS_BY_KEY.kestrel)
const ACCOUNT = Schema.decodeSync(CustomerAccountId)(account.id)
const userId = (n: number) => Schema.decodeSync(UserId)(uuid(n))
const CHANNEL = Schema.decodeSync(ChannelId)(uuid(900))

const participant = (n: number, name: string, minutesAgo: number): ChatParticipantRow => ({
	accountId: ACCOUNT,
	userId: userId(n),
	side: "customer",
	reason: "external_other_workspace",
	contactId: null,
	name,
	avatarUrl: null,
	lastMessageAtMs: NOW - minutesAgo * 60_000,
	lastChannelId: CHANNEL,
})

const PARTICIPANTS = [
	participant(1, "Priya Raman", 12),
	participant(2, "Jonas Weber", 60 * 26),
	participant(3, "Theo Martin", 60 * 24 * 9),
]
const AUTHORS: ReadonlyArray<CustomerAuthorInfo> = [
	{ userId: userId(1), side: "customer", reason: "external_other_workspace", override: null },
	{ userId: userId(2), side: "customer", reason: "connect_guest", override: null },
	{ userId: userId(3), side: "team", reason: "override", override: "team" },
]

const shared = makeShared({ nowMs: NOW })
const opened = init(
	AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: ACCOUNT, tab: Option.none() }),
	shared,
).model

const modelWith = (participants: ReadonlyArray<ChatParticipantRow>): Model => ({
	...opened,
	accounts: [account],
	channelLinks: [
		{
			id: Schema.decodeSync(CustomerChannelLinkId)(uuid(901)),
			accountId: ACCOUNT,
			channelId: CHANNEL,
			linkedBy: null,
		},
	],
	chatParticipants: participants,
	chatAuthors: AUTHORS,
})

const context: Context = {
	orgSlug: "hazel",
	nowMs: NOW,
	userId: null,
	account,
	detail: null,
	membersById: new Map(),
	isAdmin: false,
}

/** The section in the desktop sidebar's frame, or stacked under the overview on a phone. */
const screen =
	(participants: ReadonlyArray<ChatParticipantRow>, isPhone: boolean) => (h: HtmlBuilder<Message>) =>
		h.div(
			[
				h.Id("gallery"),
				h.Class(
					isPhone
						? "w-[375px] bg-bg p-4 font-sans text-fg antialiased"
						: "w-80 bg-bg font-sans text-fg antialiased",
				),
			],
			[
				h.aside(
					[
						h.Class(
							isPhone
								? "flex flex-col rounded-xl border border-border"
								: "flex flex-col border-border border-l",
						),
					],
					[
						sidebarSection(
							h,
							"People in chat",
							null,
							peopleInChat(h, modelWith(participants), context),
						),
					],
				),
			],
		)

const shoot = async (
	name: string,
	view: (h: HtmlBuilder<Message>) => Html,
	isDark: boolean,
	width: number,
) => {
	if (isDark) document.documentElement.classList.add("dark")
	await page.viewport(width, 480)
	render(view)
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	await page.screenshot({ path: `people-in-chat-${name}.png`, element: gallery })
}

test("empty light", () => shoot("empty-light", screen([], false), false, 400))
test("empty dark", () => shoot("empty-dark", screen([], false), true, 400))
test("populated light", () => shoot("populated-light", screen(PARTICIPANTS, false), false, 400))
test("populated dark", () => shoot("populated-dark", screen(PARTICIPANTS, false), true, 400))
test("mobile", () => shoot("mobile-light", screen(PARTICIPANTS, true), false, 375))
