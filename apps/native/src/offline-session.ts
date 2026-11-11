import * as CurrentUser from "../../../packages/domain/src/current-user"
import { adaUserId, generalChannelId } from "./fixture/snapshot"

/** Where the offline app opens: the fixture org's #general, signed in as Ada. */
export const startPath = `/hazel/chat/${generalChannelId}`

export const currentUser = new CurrentUser.Schema({
	id: adaUserId,
	role: "owner",
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	isOnboarded: true,
	timezone: "Europe/London",
	settings: null,
})
