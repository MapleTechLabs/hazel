import type { BotInstallationId } from "@hazel/schema"
import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { reconcileInstallRoute } from "./bot-installs"

const ours = { installationId: "ours" as BotInstallationId, region: "eu" }

describe("reconciling a regional approval's gateway route", () => {
	it("leaves the route alone when our install committed", () => {
		expect(reconcileInstallRoute(ours, Option.some({ id: ours.installationId, region: "eu" }))).toBe(
			undefined,
		)
	})

	it("clears our route when no install committed (the approval failed or rolled back)", () => {
		expect(reconcileInstallRoute(ours, Option.none())).toEqual({ installationId: "ours", region: null })
	})

	it("points the route at the install a concurrent approval committed", () => {
		const theirs = "theirs" as BotInstallationId
		expect(reconcileInstallRoute(ours, Option.some({ id: theirs, region: "eu" }))).toEqual({
			installationId: theirs,
			region: "eu",
		})
	})

	it("clears our route when the committed install is in the default region", () => {
		const theirs = "theirs" as BotInstallationId
		expect(reconcileInstallRoute(ours, Option.some({ id: theirs, region: null }))).toEqual({
			installationId: "ours",
			region: null,
		})
	})
})
