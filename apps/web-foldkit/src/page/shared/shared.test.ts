import { Option } from "effect"
import { describe, expect, it } from "vitest"
import * as Modal from "../../ui/modal"
import { validateUploadFile } from "../settings/upload"
import * as ConfirmAction from "./confirm-action"
import * as DropZone from "./drop-zone"

const fileOf = (type: string, size: number) => new File([new Uint8Array(size)], "file", { type })

describe("ConfirmAction", () => {
	const asked = ConfirmAction.ask(ConfirmAction.init<string>("delete"), "row-1")

	it("opens the dialog with its target", () => {
		expect(asked.state).toEqual({ _tag: "Confirming", target: "row-1" })
		expect(asked.modal.isOpen).toBe(true)
	})

	it("runs the confirmed target and closes on success", () => {
		const [running, target] = Option.getOrThrow(ConfirmAction.confirm(asked))
		expect(target).toBe("row-1")
		expect(ConfirmAction.isRunning(running)).toBe(true)
		expect(ConfirmAction.confirm(running)).toEqual(Option.none())
		const closed = ConfirmAction.close(running)
		expect(closed.state._tag).toBe("Closed")
		expect(closed.modal.isOpen).toBe(false)
	})

	it("returns to asking when the action fails with the dialog open", () => {
		const [running] = Option.getOrThrow(ConfirmAction.confirm(asked))
		expect(ConfirmAction.failed(running).state).toEqual({ _tag: "Confirming", target: "row-1" })
	})

	it("cancels a pending confirmation when the dialog is dismissed, but not a running action", () => {
		const dismiss = ConfirmAction.toModalMessage(Modal.Message.RequestedClose())
		expect(ConfirmAction.update(asked, dismiss).model.state._tag).toBe("Closed")
		const [running] = Option.getOrThrow(ConfirmAction.confirm(asked))
		const dismissed = ConfirmAction.update(running, dismiss).model
		expect(dismissed.state._tag).toBe("Running")
		expect(ConfirmAction.failed(dismissed).state._tag).toBe("Closed")
	})
})

describe("DropZone", () => {
	it("tracks the zone hover and nested page drags", () => {
		const over = DropZone.update(DropZone.init(), DropZone.Message.EnteredZone()).model
		expect(over.isOver).toBe(true)
		const entered = DropZone.update(
			over,
			DropZone.Message.DraggedFilesOverPage({ isEntering: true }),
		).model
		expect(DropZone.isDraggingOnPage(entered)).toBe(true)
		expect(DropZone.update(entered, DropZone.Message.EndedPageDrag()).model).toEqual(DropZone.init())
	})
})

describe("validateUploadFile", () => {
	it("checks the kind's types and size limit", () => {
		expect(validateUploadFile("avatar", fileOf("image/png", 10))).toBeNull()
		expect(validateUploadFile("avatar", fileOf("image/gif", 10))).toBe("InvalidType")
		expect(validateUploadFile("emoji", fileOf("image/gif", 10))).toBeNull()
		expect(validateUploadFile("emoji", fileOf("image/png", 300 * 1024))).toBe("TooLarge")
	})
})
