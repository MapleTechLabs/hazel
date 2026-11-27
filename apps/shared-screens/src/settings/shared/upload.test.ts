import { describe, expect, test } from "vitest"
import { acceptOf, kindOf, MAX_AVATAR_SIZE, uploadProblemMessage, validateUploadFile } from "./upload"

describe("settings uploads", () => {
	test("avatars and emoji have their own types and limits", () => {
		expect(validateUploadFile("avatar", { type: "image/png", size: 1024 })).toBeNull()
		expect(validateUploadFile("avatar", { type: "image/gif", size: 1024 })).toBe("InvalidType")
		expect(validateUploadFile("avatar", { type: "image/png", size: MAX_AVATAR_SIZE + 1 })).toBe(
			"TooLarge",
		)
		expect(validateUploadFile("emoji", { type: "image/gif", size: 1024 })).toBeNull()
		expect(validateUploadFile("emoji", { type: "image/png", size: 300 * 1024 })).toBe("TooLarge")
		expect(kindOf({ _tag: "UserAvatar" })).toBe("avatar")
		expect(acceptOf("emoji")).toBe("image/png,image/gif,image/webp")
	})

	test("each problem has today's copy, naming the kind's limits", () => {
		expect(uploadProblemMessage("emoji", "TooLarge").description).toBe(
			"File size must be less than 256KB",
		)
		expect(uploadProblemMessage("avatar", "InvalidType").description).toBe(
			"Please select a JPEG, PNG, or WebP image",
		)
		expect(uploadProblemMessage("avatar", "StorageOffline").title).toBe("Upload failed")
	})
})
