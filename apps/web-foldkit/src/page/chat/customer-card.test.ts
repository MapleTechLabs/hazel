import { describe, expect, it } from "vitest"
import { hasGlance, init, Message, type Model, update } from "./customer-card"

const step = (model: Model, ...messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message).model, model)

const commandNames = (model: Model, message: Message) =>
	(update(model, message).commands ?? []).map((command) => command.name)

describe("customer card", () => {
	it("shows after the hover delay, not on a pass over the chip", () => {
		expect(commandNames(init(), Message.HoveredChip())).toEqual(["WaitBeforeCustomerCard"])
		const passed = step(
			init(),
			Message.HoveredChip(),
			Message.LeftHover(),
			Message.ElapsedOpenDelay({ token: 1 }),
		)
		expect(passed.phase).toBe("closed")
		// Back on the chip before the first timer: only the second one opens it.
		const again = step(passed, Message.HoveredChip())
		expect(step(again, Message.ElapsedOpenDelay({ token: 1 })).phase).toBe("waiting")
		expect(step(again, Message.ElapsedOpenDelay({ token: again.token })).phase).toBe("hover")
	})

	it("stays while the pointer crosses to the card, and closes after the grace once it is gone", () => {
		const shown = step(init(), Message.HoveredChip(), Message.ElapsedOpenDelay({ token: 1 }))
		const left = step(shown, Message.LeftHover())
		expect(commandNames(shown, Message.LeftHover())).toEqual(["WaitBeforeCustomerCardClose"])
		// Reaches the card in time: the stale timer changes nothing.
		const crossed = step(left, Message.EnteredCard(), Message.ElapsedLeaveDelay({ token: left.token }))
		expect(crossed.phase).toBe("hover")
		const gone = step(crossed, Message.LeftHover())
		expect(step(gone, Message.ElapsedLeaveDelay({ token: gone.token })).phase).toBe("closed")
	})

	it("pins on a click until Escape or a click outside; a phone opens the sheet", () => {
		const pinned = step(init(), Message.PressedChip({ isMobile: false }))
		expect(pinned.phase).toBe("pinned")
		expect(commandNames(init(), Message.PressedChip({ isMobile: false }))).toEqual(["FocusCustomerCard"])
		// Leaving does not close a pinned card.
		expect(step(pinned, Message.LeftHover(), Message.ElapsedLeaveDelay({ token: 1 })).phase).toBe(
			"pinned",
		)
		expect(step(pinned, Message.PressedEscape()).phase).toBe("closed")
		expect(step(pinned, Message.PressedOutside()).phase).toBe("closed")
		expect(step(pinned, Message.PressedChip({ isMobile: false })).phase).toBe("closed")
		const phone = step(init(), Message.PressedChip({ isMobile: true }))
		expect(phone.sheet.isOpen).toBe(true)
		expect(phone.phase).toBe("closed")
	})

	it("tells a row projected before the glance from an account with nothing to show", () => {
		const row = { lifecycleStage: null } as const
		const synced = { lifecycleStage: "lead" } as const
		// SAFETY: hasGlance reads only lifecycleStage.
		expect(hasGlance(row as never)).toBe(false)
		// SAFETY: as above.
		expect(hasGlance(synced as never)).toBe(true)
	})
})
