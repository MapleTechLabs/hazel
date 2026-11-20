import { describe, expect, test } from "vitest"
import { uuidv5, uuidv7 } from "./uuid"

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

describe("uuidv5", () => {
	test("matches the reference vectors", () => {
		expect(uuidv5("www.example.com", DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2")
		expect(uuidv5("hello", DNS)).toBe("9342d47a-1bab-5709-9869-c840b2eac501")
		expect(uuidv5("", DNS)).toBe("4ebd0208-8328-5d69-8c44-ec50939c0967")
	})

	test("hashes multi-byte names and names longer than one block", () => {
		expect(uuidv5("héllo wörld 👋", DNS)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		)
		expect(uuidv5("x".repeat(200), DNS)).not.toBe(uuidv5("x".repeat(201), DNS))
	})
})

describe("uuidv7", () => {
	test("leads with the timestamp and carries version 7", () => {
		const id = uuidv7(0x0189_0a7b_1c2d)
		expect(id.slice(0, 13)).toBe("01890a7b-1c2d")
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
	})

	test("sorts by creation time", () => {
		expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true)
	})
})
