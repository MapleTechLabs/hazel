import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../styles.css"
import type { ChannelId, ChannelMemberId, OrganizationId } from "@hazel/schema"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { joinBannerView } from "../page/chat/banners"
import { chatHeaderView } from "../page/chat/header"
import { channelCard } from "../page/chat-index/cards"
import { channelItem } from "../shell/channels-sidebar/items"
import type { ChannelEntry } from "../shell/channels-sidebar/rows"
import type { ChannelLinks } from "./channel-icon"

/**
 * One channel, every surface (`channel-icon.ts`): the sidebar's Channels and Favorites rows, the
 * chat header, the chat index card and the join banner, for a plain, emoji, private, customer,
 * Connect and Slack channel, light and dark (`bun run gallery`). Writes `channel-icon-<theme>.png`.
 */

type M = Readonly<{ _tag: "Ignored" }>
const ignored: M = { _tag: "Ignored" }

const render = (view: (h: HtmlBuilder<M>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		Context.make(Dispatch, dispatch).pipe(
			Context.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<M>())
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

const ORG = "0b8f7c1e-3a52-4f8e-9a51-6f1c2d3e4a5b" as OrganizationId

interface Sample {
	readonly label: string
	readonly name: string
	readonly type: "public" | "private"
	readonly icon: string | null
	readonly links: ChannelLinks
}

const none: ChannelLinks = { customer: null, partners: [], syncProvider: null }
const acme = { name: "Acme Corp", logoUrl: null }
const northwind = {
	id: "7c1e0b8f-3a52-4f8e-9a51-6f1c2d3e4a5b" as OrganizationId,
	name: "Northwind",
	logoUrl: null,
}

const SAMPLES: ReadonlyArray<Sample> = [
	{ label: "Plain", name: "general", type: "public", icon: null, links: none },
	{ label: "Emoji", name: "launches", type: "public", icon: "🚀", links: none },
	{ label: "Private", name: "leadership", type: "private", icon: null, links: none },
	{
		label: "Customer",
		name: "acme-support",
		type: "public",
		icon: null,
		links: { ...none, customer: acme },
	},
	{
		label: "Customer, private, Slack",
		name: "acme-escalations",
		type: "private",
		icon: null,
		links: { customer: acme, partners: [], syncProvider: "slack" },
	},
	{
		label: "Connect",
		name: "northwind-shared",
		type: "public",
		icon: null,
		links: { ...none, partners: [northwind] },
	},
	{
		label: "Discord",
		name: "community",
		type: "public",
		icon: null,
		links: { ...none, syncProvider: "discord" },
	},
]

const idOf = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`

const entryOf = (sample: Sample, n: number): ChannelEntry => ({
	channel: {
		id: idOf(n) as ChannelId,
		name: sample.name,
		type: sample.type,
		icon: sample.icon,
		sectionId: null,
	},
	member: { id: idOf(50 + n) as ChannelMemberId, isMuted: false, isFavorite: false, notificationCount: 0 },
})

// The surfaces, as the app calls them.

const sidebarRow = (h: HtmlBuilder<M>, sample: Sample, n: number, _isFavorite: boolean) =>
	channelItem(h, entryOf(sample, n), 0, { orgSlug: "acme", isActive: false, links: sample.links }, h.empty)

const header = (h: HtmlBuilder<M>, sample: Sample, n: number) =>
	chatHeaderView(h, {
		channel: {
			id: idOf(n) as ChannelId,
			name: sample.name,
			type: sample.type,
			icon: sample.icon,
			organizationId: ORG,
			parentChannelId: null,
		},
		links: sample.links,
		parentChannel: null,
		orgSlug: "acme",
		isMember: true,
		otherMembers: [],
		isHiddenDm: false,
		dmPresence: null,
		pinnedTrigger: h.empty,
		mobileBack: h.empty,
	})

const card = (h: HtmlBuilder<M>, sample: Sample, n: number) =>
	channelCard(
		h,
		"acme",
		{
			id: idOf(n) as ChannelId,
			name: sample.name,
			type: sample.type,
			icon: sample.icon,
			lastMessageAtMs: null,
			lastMessageAuthorId: null,
			lastMessagePreview: null,
			isMuted: false,
			isFavorite: false,
			notificationCount: 0,
			memberCount: 4,
			members: [],
		},
		sample.type === "private",
		sample.links,
	)

const banner = (h: HtmlBuilder<M>, sample: Sample, n: number) =>
	joinBannerView(
		h,
		{
			id: idOf(n) as ChannelId,
			name: sample.name,
			type: sample.type,
			icon: sample.icon,
			organizationId: ORG,
			parentChannelId: null,
		},
		{ isJoining: false, onJoin: ignored, links: sample.links },
	)

// LAYOUT

const panel = (h: HtmlBuilder<M>, title: string, width: number, children: ReadonlyArray<Html>) =>
	h.figure(
		[h.Class("flex flex-col gap-2")],
		[
			h.figcaption([h.Class("text-muted-fg text-xs")], [title]),
			h.div(
				[
					h.Class("overflow-hidden rounded-xl border border-border bg-bg"),
					h.Style({ width: `${width}px` }),
				],
				children,
			),
		],
	)

const sidebar = (h: HtmlBuilder<M>, isFavorite: boolean) =>
	h.div(
		[h.Class("bg-sidebar p-2")],
		[
			h.div(
				[h.Class("grid grid-cols-[auto_1fr] gap-y-0.5")],
				SAMPLES.map((sample, n) => sidebarRow(h, sample, n, isFavorite)),
			),
		],
	)

const screen = (h: HtmlBuilder<M>) =>
	h.div(
		[
			h.Id("gallery"),
			h.Class("flex w-[1500px] flex-wrap items-start gap-6 bg-bg p-8 font-sans text-fg antialiased"),
		],
		[
			panel(h, "Sidebar · Channels and Customers sections", 240, [sidebar(h, false)]),
			panel(h, "Sidebar · Favorites", 240, [sidebar(h, true)]),
			panel(
				h,
				"Chat header",
				420,
				SAMPLES.map((sample, n) => header(h, sample, n)),
			),
			panel(
				h,
				"Chat index cards",
				420,
				SAMPLES.map((sample, n) => card(h, sample, n)),
			),
			panel(h, "Join banner · customer, private, Slack", 420, [
				h.div(
					[h.Class("flex h-72")],
					SAMPLES.flatMap((sample, n) => (n === 4 ? [banner(h, sample, n)] : [])),
				),
			]),
		],
	)

for (const theme of ["light", "dark"] as const) {
	test(theme, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(1500, 1200)
		render(screen)
		await document.fonts.ready
		const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
		const gallery = document.getElementById("gallery")
		if (gallery === null) throw new Error("The gallery did not render")
		await page.screenshot({ path: `${label}channel-icon-${theme}.png`, element: gallery })
	})
}
