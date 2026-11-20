import "../../test/document-stub"
import { OrganizationMemberId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import { makeShared, organizationId, uuid } from "../../test/pages-fixtures"
import type { Shared } from "../contract"
import { Message } from "./message"
import { init, update } from "./update"

/** The import step's OAuth leaves the page: the answers given before it survive the round trip. */

const base = makeShared()
const shared: Shared = makeShared({
	currentUser: base.currentUser === null ? null : { ...base.currentUser, isOnboarded: false },
})
const membership = {
	organizationId,
	memberId: Schema.decodeSync(OrganizationMemberId)(uuid(90)),
	name: "Acme",
	slug: null,
}
const route = (step: string) => ({
	_tag: "Onboarding" as const,
	orgId: Option.none(),
	step: Option.some(step),
})
const answers = { timezone: "Europe/Berlin", useCases: ["2-10"], role: "engineering" }

describe("onboarding answers across the import step's OAuth", () => {
	test("entering the import step keeps the answers given so far", () => {
		const invite = [
			Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
			Message.UpdatedMembership({ membership }),
		].reduce(
			(model, message) => update(model, message, shared).model,
			init(route("teamInvitation"), shared).model,
		)
		const back = update(invite, Message.ClickedBack(), shared)
		expect(back.model.phase._tag === "Running" ? back.model.phase.step._tag : null).toBe("Import")
		expect(back.commands?.map((command) => command.name)).toContain("StoreOnboardingAnswers")
	})

	test("coming back to the import step reads them, and the flow starts with them", () => {
		const first = init(route("import"), shared)
		expect(first.commands?.map((command) => command.name)).toContain("ReadOnboardingAnswers")
		const restored = [
			Message.RestoredAnswers({ data: answers }),
			Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
			Message.UpdatedMembership({ membership }),
		].reduce((model, message) => update(model, message, shared).model, first.model)
		expect(restored.phase._tag === "Running" ? restored.phase.data : null).toEqual(answers)
		expect(restored.phase._tag === "Running" ? restored.phase.step._tag : null).toBe("Import")
	})

	test("coming back to the import step does not save over the answers it is reading back", () => {
		const started = [
			Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
			Message.UpdatedMembership({ membership }),
		].reduce<{ model: ReturnType<typeof init>["model"]; names: Array<string> }>(
			(step, message) => {
				const next = update(step.model, message, shared)
				return {
					model: next.model,
					names: [...step.names, ...(next.commands ?? []).map((c) => c.name)],
				}
			},
			{ model: init(route("import"), shared).model, names: [] },
		)
		expect(started.names).not.toContain("StoreOnboardingAnswers")
	})

	test("answers read after the flow started still land", () => {
		const running = [
			Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
			Message.UpdatedMembership({ membership }),
			Message.RestoredAnswers({ data: answers }),
		].reduce(
			(model, message) => update(model, message, shared).model,
			init(route("import"), shared).model,
		)
		expect(running.phase._tag === "Running" ? running.phase.data : null).toEqual(answers)
	})

	test("a membership that arrives after the import step opened reaches its wizard", () => {
		const opened = [
			Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
			Message.UpdatedMembership({ membership: null }),
		].reduce(
			(model, message) => update(model, message, shared).model,
			init(route("import"), shared).model,
		)
		const migrationOf = (model: typeof opened) =>
			model.phase._tag === "Running" && model.phase.step._tag === "Import"
				? model.phase.step.migration
				: null
		expect(migrationOf(opened)?.organizationId).toBeNull()
		const known = update(opened, Message.UpdatedMembership({ membership }), shared).model
		expect(migrationOf(known)?.organizationId).toBe(organizationId)
	})
})
