/**
 * The spike's script (`EffectUiSpike` target): runs in a bare JavaScriptCore context, no WebKit and
 * no DOM. The shell gives it `__native.post(json)` and timers (`EffectUiRuntime.swift`); it mounts
 * the channel list on the native host and answers presses through `__effectUi.fire(id, event)`.
 */
import "./jsc-globals"
import { Effect } from "effect"
import { channelMemberRows, channelRows, channelSectionRows, userRows, adaUserId } from "../fixture/snapshot"
import type { Section } from "./ChannelList"
import { mountChannelList } from "./mount"
import type { NativeElement } from "./native-host"

declare const __native: { post: (json: string) => void }

/** The fixture org's sidebar, as the web groups it: sections in order, then direct messages. */
const sections = (): ReadonlyArray<Section> => {
	const unread = new Map(
		channelMemberRows
			.filter((row) => row.userId === adaUserId)
			.map((row) => [row.channelId, row.notificationCount]),
	)
	const grouped = [...channelSectionRows]
		.sort((a, b) => a.order - b.order)
		.map((section) => ({
			title: section.name,
			channels: channelRows
				.filter((channel) => channel.sectionId === section.id)
				.map((channel) => ({
					id: channel.id,
					title: channel.name,
					symbol: channel.type === "private" ? "lock" : "number",
					unread: unread.get(channel.id) ?? 0,
				})),
		}))
	const people = channelRows
		.filter((channel) => channel.type === "single")
		.map((channel) => {
			const partner = channelMemberRows.find(
				(row) => row.channelId === channel.id && row.userId !== adaUserId,
			)
			const user = userRows.find((row) => row.id === partner?.userId)
			const title = user === undefined ? "Direct message" : `${user.firstName} ${user.lastName}`
			const initials = title
				.split(/\s+/)
				.map((part) => part[0] ?? "")
				.join("")
				.slice(0, 2)
			return { id: channel.id, title, initials, unread: unread.get(channel.id) ?? 0 }
		})
	return [...grouped, { title: "Direct messages", channels: people }]
}

let fire: (id: number, event: string) => boolean = () => false

Effect.gen(function* () {
	const native = yield* mountChannelList({ sections: sections(), tickMs: 2000 }, (ops) =>
		__native.post(JSON.stringify(ops)),
	)
	fire = native.fire
	return yield* Effect.never
}).pipe(Effect.scoped, Effect.runFork)

Object.assign(globalThis, {
	__effectUi: {
		fire: (id: number, event: string) => fire(id, event),
	},
})

export type { NativeElement }
