import type { Row } from "../../dataset.ts"
import { stableId } from "../../ids.ts"
import { asset, at, channelId, message, messageId, orgId, userId, type PersonKey } from "./base.ts"

/**
 * #media: image grids (1, 3 and 5 images), document attachments and a video. Images load from the
 * fixture backend through `externalUrl`; documents and the video are never fetched by a capture.
 */

const posts: ReadonlyArray<{
	key: string
	author: PersonKey
	time: string
	content: string
	files: ReadonlyArray<readonly [name: string, size: number, url?: string]>
}> = [
	{
		key: "media:moodboard",
		author: "katherine",
		time: "10:00",
		content: "Moodboard for the launch page",
		files: [1, 2, 3, 4, 5].map((n) => [
			`moodboard-${n}.png`,
			240_000 + n * 1000,
			`moodboard-${n}-600x600.png`,
		]),
	},
	{
		key: "media:screenshot",
		author: "grace",
		time: "11:15",
		content: "New dashboard screenshot",
		files: [["dashboard.png", 512_000, "dashboard-1280x720.png"]],
	},
	{
		key: "media:trio",
		author: "alan",
		time: "12:30",
		content: "Icon explorations",
		files: [1, 2, 3].map((n) => [`icon-${n}.png`, 32_000 + n * 1000, `icon-${n}-400x400.png`]),
	},
	{
		key: "media:docs",
		author: "margaret",
		time: "13:45",
		content: "Launch plan and the metrics export",
		files: [
			["launch-plan.pdf", 1_482_000],
			["metrics-export.csv", 86_500],
			["press-kit.zip", 24_800_000],
		],
	},
	{
		key: "media:video",
		author: "linus",
		time: "14:30",
		content: "Screen recording of the new onboarding",
		files: [["onboarding-walkthrough.mp4", 18_400_000]],
	},
]

export const mediaMessages: Row[] = posts.map((post) =>
	message({
		key: post.key,
		channel: "media",
		author: post.author,
		createdAt: at(0, post.time),
		content: post.content,
	}),
)

export const attachments: Row[] = posts.flatMap((post) =>
	post.files.map(([fileName, fileSize, url], index) => ({
		id: stableId(`rich:attachment:${post.key}:${index}`),
		organizationId: orgId,
		channelId: channelId("media"),
		messageId: messageId(post.key),
		fileName,
		fileSize,
		externalUrl: url ? asset(`attachments/${url}`) : asset(`attachments/${fileName}`),
		uploadedBy: userId(post.author),
		status: "complete",
		uploadedAt: new Date(at(0, post.time).getTime() + index * 1000),
		deletedAt: null,
	})),
)
