import type { Row } from "../../dataset.ts"
import { stableId } from "../../ids.ts"
import { asset, at, channelId, memberId, message, messageId, now, orgId, reaction, userId } from "./base.ts"

/**
 * #launch: three days of conversation (date separators), grouped runs, a reply, an edit, custom
 * emoji inline and as reactions, a mention, a Discord-synced message, two pins and a thread.
 */

export const customEmojiUrl = (name: string) => asset(`emojis/${name}-64x64.png`)
const emoji = (name: string) => `![custom-emoji:${name}](${customEmojiUrl(name)})`

export const launchMessages: Row[] = [
	message({
		key: "launch:kickoff",
		channel: "launch",
		author: "grace",
		createdAt: at(-2, "10:00"),
		content: "Kicking off the launch channel. Everything for Thursday's release lives here.",
	}),
	message({
		key: "launch:kickoff-2",
		channel: "launch",
		author: "grace",
		createdAt: at(-2, "10:01"),
		content: "The docs draft is up for review, comments welcome.",
	}),
	message({
		key: "launch:kickoff-3",
		channel: "launch",
		author: "grace",
		createdAt: at(-2, "10:02"),
		content: "Standup moves to 09:30 until we ship.",
	}),
	message({
		key: "launch:runbook",
		channel: "launch",
		author: "alan",
		createdAt: at(-2, "11:30"),
		content: "I'll own the migration runbook.",
	}),
	message({
		key: "launch:plan",
		channel: "launch",
		author: "margaret",
		createdAt: at(-1, "09:15"),
		content:
			'Rollout plan for the sync service:\n\n1. Ship behind the `sync_v2` flag\n2. Ramp to 10% of orgs\n3. Watch error rates for an hour\n\n```ts\nawait flags.enable("sync_v2", { percent: 10 })\n```',
	}),
	message({
		key: "launch:plan-reply",
		channel: "launch",
		author: "ada",
		createdAt: at(-1, "09:20"),
		content: "Agreed. Let's hold the ramp if p95 latency goes above 400ms.",
		replyTo: "launch:plan",
	}),
	message({
		key: "launch:rc",
		channel: "launch",
		author: "linus",
		createdAt: at(-1, "14:00"),
		content: `Release candidate is green ${emoji("shipit")} all suites passing ${emoji("partyparrot")}`,
	}),
	message({
		key: "launch:edited",
		channel: "launch",
		author: "katherine",
		createdAt: at(-1, "16:00"),
		editedAt: at(-1, "16:05"),
		content: "Status page copy is final, screenshots go out tomorrow morning.",
	}),
	message({
		key: "launch:checklist",
		channel: "launch",
		author: "ada",
		createdAt: at(0, "13:10"),
		content: "Launch checklist: please claim your items in the thread.",
		thread: "launch-thread",
	}),
	message({
		key: "launch:window",
		channel: "launch",
		author: "grace",
		createdAt: at(0, "13:40"),
		content: "Launch window confirmed: **Thursday 17:00 UTC**.",
	}),
	message({
		key: "launch:discord",
		channel: "launch",
		author: "alan",
		createdAt: at(0, "14:20"),
		content: "Community folks on Discord are asking about the changelog.",
	}),
	message({
		key: "launch:mention",
		channel: "launch",
		author: "katherine",
		createdAt: at(0, "14:50"),
		content: `@[userId:${userId("ada")}] can you confirm the status page copy before 16:00?`,
	}),
]

export const threadMessages: Row[] = [
	["alan", "13:15", "Taking the database migration and the rollback drill."],
	["margaret", "13:22", "I've got the status page and customer email."],
	["linus", "13:31", "CI freeze and release tagging are mine."],
].map(([author, time, content], index) =>
	message({
		key: `launch-thread:${index}`,
		channel: "launch-thread",
		author: author as "alan",
		createdAt: at(0, time!),
		content: content!,
	}),
)

export const launchReactions: Row[] = [
	reaction("launch:rc", "launch", "ada", "custom:shipit"),
	reaction("launch:rc", "launch", "grace", "custom:shipit"),
	reaction("launch:rc", "launch", "margaret", "🎉"),
	reaction("launch:window", "launch", "alan", "👍"),
	reaction("launch:window", "launch", "linus", "👍"),
	reaction("launch:window", "launch", "katherine", "custom:partyparrot"),
]

export const pinnedMessages: Row[] = (["launch:checklist", "launch:window"] as const).map((key, index) => ({
	id: stableId(`rich:pin:${key}`),
	channelId: channelId("launch"),
	messageId: messageId(key),
	pinnedBy: userId("ada"),
	pinnedAt: at(0, index === 0 ? "13:11" : "13:41"),
}))

export const customEmojis: Row[] = ["shipit", "partyparrot", "hazel"].map((name) => ({
	id: stableId(`rich:emoji:${name}`),
	organizationId: orgId,
	name,
	imageUrl: customEmojiUrl(name),
	createdBy: userId("ada"),
	createdAt: at(-30, "12:00"),
	updatedAt: null,
	deletedAt: null,
}))

/** #long-reads: one message long enough to overflow, with a wide code line and a long token. */
export const longMessages: Row[] = [
	message({
		key: "long:essay",
		channel: "long-reads",
		author: "margaret",
		createdAt: at(0, "11:00"),
		content: [
			"Postmortem draft for the March 4 sync outage, please read before Friday.",
			"**Summary.** For 47 minutes, message sync stalled for roughly a third of organizations. Writes were accepted and persisted, but shape streams stopped advancing, so clients saw stale channels until they reloaded. No data was lost.",
			"**Timeline.** At 14:02 a config push lowered the replication slot's max lag. At 14:09 the first slot fell behind and was dropped, which forced every client on that shard into a full resync. The resync storm saturated the connection pool, and at 14:20 the remaining shards followed. We rolled the config back at 14:41 and streams recovered by 14:49.",
			"**What went well.** Alerting fired within two minutes, and the rollback was a single command. The incident channel stayed focused and the status page was updated three times.",
			"**What went poorly.** The config change was reviewed as a cosmetic rename. Our staging environment has one shard, so the cascade could not reproduce there. Resync has no backoff, so every client retried at the same moment.",
			"**Action items.** Add jittered backoff to resync, alert on slot lag rather than slot drops, and require a load test for any change under `replication/`.",
			'```\nERROR replication slot "shape_slot_07" dropped: max_slot_wal_keep_size exceeded (requested 2147483648, limit 1073741824) at lsn 0/4F2A9C18\n```',
			"Raw trace id for reference: 7f3a9c2e1b4d4e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
		].join("\n\n"),
	}),
]

/** #standup: a short exchange while two teammates are typing. */
export const standupMessages: Row[] = [
	message({
		key: "standup:0",
		channel: "standup",
		author: "grace",
		createdAt: at(0, "09:30"),
		content: "Standup thread for today, post your updates here.",
	}),
	message({
		key: "standup:1",
		channel: "standup",
		author: "ada",
		createdAt: at(0, "09:34"),
		content: "Yesterday: onboarding copy. Today: launch checklist.",
	}),
]

export const typingIndicators: Row[] = (["grace", "alan"] as const).map((person, index) => ({
	id: stableId(`rich:typing:${person}`),
	channelId: channelId("standup"),
	memberId: memberId("standup", person),
	lastTyped: now.getTime() - 1000 - index * 500,
}))

/** #announcements: Ada isn't a member, so the channel shows the join banner. */
export const announcementMessages: Row[] = [
	message({
		key: "announcements:0",
		channel: "announcements",
		author: "grace",
		createdAt: at(-3, "10:00"),
		content: "Welcome to announcements. Company-wide news only.",
	}),
]
