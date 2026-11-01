import type { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { HazelApiClient } from "../../../rpc"
import { PROVIDERS } from "./providers"

const orgId = "00000000-0000-0000-0000-000000000001" as OrganizationId

/** The org's Slack install answering for workspace `T0INSTALLED`. */
const slackApi = {
	"integration-resources": {
		getSlackChannels: () =>
			Effect.succeed({
				workspace: { id: "T0INSTALLED", name: "Acme" },
				channels: [{ id: "C0GENERAL1", name: "general", isPrivate: false, isMember: true }],
			}),
	},
}

const channels = (workspaceId: string) =>
	Effect.runPromiseExit(
		PROVIDERS.slack
			.fetchChannels(orgId, workspaceId)
			.pipe(Effect.provideService(HazelApiClient, slackApi as never)),
	)

describe("Slack channels for a connection", () => {
	test("lists the install's channels for the connection's own workspace", async () => {
		const exit = await channels("T0INSTALLED")
		expect(exit._tag === "Success" && exit.value.map((channel) => channel.name)).toEqual(["general"])
	})

	test("refuses them for a connection to another workspace (Slack reconnected elsewhere)", async () => {
		const exit = await channels("T0EARLIER")
		expect(exit._tag).toBe("Failure")
		expect(JSON.stringify(exit)).toContain("IntegrationResourceError")
	})
})
