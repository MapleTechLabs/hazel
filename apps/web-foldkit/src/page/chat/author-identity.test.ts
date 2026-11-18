import { describe, expect, it } from "vitest"
import { authorIdentity } from "./derive"

const user = (userType: string, email?: string) => ({
	firstName: "fiws",
	lastName: "",
	avatarUrl: null,
	userType,
	email,
})

describe("authorIdentity", () => {
	it("marks an app as a bot, under its bot name", () => {
		expect(authorIdentity(user("machine", "bot-123@bots.internal"), "Maple")).toEqual({
			displayName: "Maple",
			avatarUrl: null,
			isBot: true,
			syncProvider: null,
		})
	})

	it("marks a Discord person by platform, not as an app", () => {
		expect(authorIdentity(user("machine", "discord-user-42@discord.internal"), undefined)).toMatchObject({
			displayName: "fiws",
			isBot: false,
			syncProvider: "discord",
		})
	})

	it("marks a Slack person by platform, not as an app", () => {
		expect(authorIdentity(user("machine", "slack-user-U42@slack.internal"), undefined)).toMatchObject({
			isBot: false,
			syncProvider: "slack",
		})
	})

	it("leaves a Hazel person alone", () => {
		expect(authorIdentity(user("user", "discord-user-fan@example.com"), undefined)).toMatchObject({
			isBot: false,
			syncProvider: null,
		})
	})
})
