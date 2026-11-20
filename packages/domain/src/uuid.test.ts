import { describe, expect, test } from "vitest"
import { ChannelId, UserId } from "@hazel/schema"
import { clientMessageId } from "./models/message-model"
import { uuidv5, uuidv7 } from "./uuid"

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

describe("uuidv5", () => {
	test("matches the reference vectors", () => {
		expect(uuidv5("www.example.com", DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2")
		expect(uuidv5("hello", DNS)).toBe("9342d47a-1bab-5709-9869-c840b2eac501")
		expect(uuidv5("", DNS)).toBe("4ebd0208-8328-5d69-8c44-ec50939c0967")
	})

	// Expected values from node:crypto's SHA-1, independent of this implementation. With the 16-byte
	// namespace, 39/40 and 47/48 byte names straddle SHA-1's padding and block boundaries.
	test("matches an independent SHA-1 on Unicode names and at block boundaries", () => {
		expect(uuidv5("héllo wörld 👋", DNS)).toBe("d3ab4ba8-9c23-5541-b5eb-74ed3ee73909")
		const cases: ReadonlyArray<readonly [number, string]> = [
			[39, "2f80c0d1-1c62-579f-8d68-e61ad5592c9b"],
			[40, "e56fd57a-7633-5e1d-8f80-70e05ac413e5"],
			[47, "a112377b-8258-5ef7-b5b0-d2540bc03abb"],
			[48, "83993b6c-dea9-55ca-be5b-9989c85943fc"],
			[55, "4c506c2a-c3a2-508b-b2ce-25c3a06bf481"],
			[56, "f1b9151e-183c-58b7-b276-8dafd14a10b6"],
			[64, "2b539495-76e8-5ab9-8067-4d5b1acb2e27"],
		]
		for (const [length, expected] of cases) expect(uuidv5("x".repeat(length), DNS)).toBe(expected)
	})

	test("derives a client message id the server and older clients agree on", () => {
		const channelId = ChannelId.make("0192aaaa-0000-7000-8000-000000000001")
		const authorId = UserId.make("0192bbbb-0000-7000-8000-000000000002")
		expect(clientMessageId(channelId, authorId, "nonce-1")).toBe("370d211c-95d1-5b62-86c0-cd94fe791c8d")
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
