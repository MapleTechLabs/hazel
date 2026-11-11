import { describe, expect, test } from "vitest"
import { CheckForUpdate, check, install, isInstalling, Message, Model, update } from "./updates"

describe("desktop updates", () => {
	test("a check runs once at a time and records what it found", () => {
		const checking = check(Model.Idle())
		expect(checking.model).toEqual(Model.Checking())
		expect(checking.commands?.map((command) => command.name)).toEqual([CheckForUpdate.name])
		expect(check(checking.model).commands ?? []).toEqual([])

		const found = update(checking.model, Message.FoundUpdate({ version: "1.1.0", body: "Fixes" })).model
		expect(found).toEqual(Model.Available({ version: "1.1.0", body: "Fixes" }))
		expect(update(checking.model, Message.FoundNoUpdate({ checkedAtMs: 5 })).model).toEqual(
			Model.UpToDate({ checkedAtMs: 5 }),
		)
	})

	test("installing goes through download, install and restart; a failure can be checked again", () => {
		const downloading = install(Model.Available({ version: "1.1.0", body: null })).model
		expect(isInstalling(downloading)).toBe(true)
		const progressed = update(
			downloading,
			Message.ProgressedDownload({ downloadedBytes: 5, totalBytes: 10 }),
		).model
		expect(progressed).toEqual(Model.Downloading({ downloadedBytes: 5, totalBytes: 10 }))
		expect(update(progressed, Message.StartedInstall()).model).toEqual(Model.Installing())
		const failed = update(progressed, Message.FailedInstall({ reason: "DownloadFailed" })).model
		expect(isInstalling(failed)).toBe(false)
		expect(check(failed).model).toEqual(Model.Checking())
	})

	test("install only starts from an available update", () => {
		expect(install(Model.Idle()).model).toEqual(Model.Idle())
		expect(check(Model.Installing()).model).toEqual(Model.Installing())
	})
})
