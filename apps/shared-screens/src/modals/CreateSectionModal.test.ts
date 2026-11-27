// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { CreateSection, CreateSectionMessage, CreateSectionModalNoDeps } from "./CreateSectionModal"
import { ModalEvents } from "./feedback"
import { button, dialog, field, organizationId, session, typed } from "./test-support"

/** Create section: a name of two characters or more, then the section is created and the modal closes. */

const start = () => Scene.start(CreateSectionModalNoDeps, { session })

describe("create section modal", () => {
	test("opens empty, without an error", () => {
		const s = start()
		s.expect(dialog("Create section")).toExist()
		expect(s.get(field("Section name")).props?.["error"]).toBeUndefined()
		expect(s.get(button("Create section")).props?.["disabled"]).toBeUndefined()
	})

	test("a short name says why and blocks the submit", () => {
		const s = start().fire(field("Section name"), "change", typed("D"))
		expect(s.get(field("Section name")).props?.["error"]).toBe("Section name must be at least 2 characters")
		expect(s.get(button("Create section")).props?.["disabled"]).toBe(true)
	})

	test("submitting empty shows the error instead of creating", () => {
		const s = start().fire(field("Section name"), "submit", typed(""))
		expect(s.get(field("Section name")).props?.["error"]).toBe("Section name must be at least 2 characters")
	})

	test("a valid name creates the section and closes", () => {
		const s = start()
			.fire(field("Section name"), "change", typed("Design"))
			.fire(button("Create section"), "press")
			.expectExact(CreateSection.make({ name: "Design", organizationId }))
		expect(s.get(button("Creating...")).props?.["disabled"]).toBe(true)
		s.resolve(CreateSection, CreateSectionMessage.SucceededCreateSection()).emitted(
			ModalEvents.RequestedClose(),
		)
	})

	test("a failed create stays open to try again", () => {
		const s = start()
			.fire(field("Section name"), "change", typed("Design"))
			.fire(field("Section name"), "submit", typed("Design"))
			.expectExact(CreateSection.make({ name: "Design", organizationId }))
			.resolve(CreateSection, CreateSectionMessage.FailedCreateSection())
		expect(s.get(button("Create section")).props?.["disabled"]).toBeUndefined()
	})

	test("cancel and dismiss ask to close", () => {
		start().fire(button("Cancel"), "press").emitted(ModalEvents.RequestedClose())
		start().fire(dialog("Create section"), "dismiss").emitted(ModalEvents.RequestedClose())
	})
})
