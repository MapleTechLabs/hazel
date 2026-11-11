import { OperationHttpError } from "@yielded/auth/OperationHttp"
import {
	PasskeyBrowserBusy,
	PasskeyBrowserInputRejected,
	PasskeyBrowserNotCompleted,
	PasskeyBrowserUnsupported,
} from "@yielded/auth-simplewebauthn/Browser"
import { describe, expect, it } from "vitest"
import { authFailureOf } from "./flows"

/** Auth failures are classified by their declared tag, never by the shape of the tag's name. */
describe("authFailureOf", () => {
	it("a closed or busy passkey prompt is a quiet cancel", () => {
		expect(authFailureOf(new PasskeyBrowserNotCompleted())).toBe("Cancelled")
		expect(authFailureOf(new PasskeyBrowserBusy())).toBe("Cancelled")
	})

	// It ends in "Rejected", which the old suffix match read as an expired sign-in.
	it("a browser refusing the passkey options is unexpected, not an expired sign-in", () => {
		expect(authFailureOf(new PasskeyBrowserInputRejected())).toBe("Unexpected")
	})

	it("a browser without passkeys says so", () => {
		expect(authFailureOf(new PasskeyBrowserUnsupported())).toBe("PasskeyUnsupported")
	})

	it("the transport's reason picks offline, timeout or unavailable", () => {
		expect(authFailureOf(new OperationHttpError({ reason: "network" }))).toBe("Offline")
		expect(authFailureOf(new OperationHttpError({ reason: "timeout" }))).toBe("Timeout")
		expect(authFailureOf(new OperationHttpError({ reason: "unavailable" }))).toBe("Unavailable")
		expect(authFailureOf(new OperationHttpError({ reason: "csrf" }))).toBe("Unexpected")
	})
})
