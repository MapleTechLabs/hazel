import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId } from "../snapshot"

/**
 * The assistant panel over #general: T3 Code linked, and one finished chat of Ada's with each kind
 * of row the panel draws (her question, the agent's thinking, two tool steps, a markdown reply).
 */
export const ASSISTANT_THREAD_ID = "00000000-0000-4000-8000-0000000a0001"
export const ASSISTANT_THREAD_TITLE = "Summarize #general"

const itemId = (n: number) => `00000000-0000-4000-8000-0000000a01${n.toString(16).padStart(2, "0")}`
const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 14, minute)).toISOString()

const item = (
	n: number,
	fields: { kind: string; text: string; title?: string; status?: string; data?: object },
) => ({
	id: itemId(n),
	threadId: ASSISTANT_THREAD_ID,
	organizationId: orgId,
	ownerId: adaUserId,
	visibility: "private",
	kind: fields.kind,
	externalId: null,
	runId: null,
	status: fields.status ?? "completed",
	title: fields.title ?? null,
	text: fields.text,
	data: fields.data ?? null,
	authorId: fields.kind === "user" ? adaUserId : null,
	createdAt: at(50 + n),
	updatedAt: at(50 + n),
	deletedAt: null,
})

const fixture: PageFixture = {
	seed: (server) => {
		server.write("org", orgId, "assistant_threads", [
			{
				id: ASSISTANT_THREAD_ID,
				organizationId: orgId,
				ownerId: adaUserId,
				title: ASSISTANT_THREAD_TITLE,
				visibility: "private",
				engine: "t3code",
				status: "idle",
				errorMessage: null,
				context: null,
				externalThreadId: null,
				externalLink: null,
				engineLabel: "MacBook Pro",
				lastActivityAt: at(56),
				createdAt: at(51),
				updatedAt: at(56),
				deletedAt: null,
			},
		])
		server.write("org", orgId, "assistant_items", [
			item(1, { kind: "user", text: "What did the team decide about the launch this week?" }),
			item(2, { kind: "reasoning", text: "Reading the latest messages in #general." }),
			item(3, {
				kind: "tool",
				title: "Read messages",
				text: "42 messages",
				data: { input: "#general, last 7 days" },
			}),
			item(4, { kind: "tool", title: "Search", text: "3 results", data: { input: "launch date" } }),
			item(5, {
				kind: "assistant",
				text: [
					"The team agreed to **ship on Thursday**, with two follow-ups:",
					"",
					"- Grace finishes the `sync` benchmarks first",
					"- Alan writes the release notes",
					"",
					"Nobody raised a blocker since Monday.",
				].join("\n"),
			}),
		])
	},
	rpcs: {
		"assistant.status": () => ({ t3code: { state: "connected", environmentLabel: "MacBook Pro" } }),
	},
}

export default fixture
