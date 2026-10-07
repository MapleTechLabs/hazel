/** The Clerk resources onboarding writes to (`useUser()`, `useOrganization()`), via `window.Clerk`. */

const fieldOf = (value: unknown, key: string): unknown =>
	typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined

const callMethod = (target: unknown, name: string, argument: unknown): Promise<unknown> => {
	const method = fieldOf(target, name)
	return typeof method === "function"
		? Promise.resolve(Reflect.apply(method, target, [argument]))
		: Promise.reject(new TypeError(`Clerk ${name} is unavailable`))
}

const user = () => fieldOf(window.Clerk, "user")
const organization = () => fieldOf(window.Clerk, "organization")

export const clerkResource = {
	updateUser: (fields: { readonly firstName: string; readonly lastName: string }) =>
		user() ? callMethod(user(), "update", fields) : Promise.reject(new TypeError("No Clerk user")),
	hasOrganization: () => Boolean(organization()),
	inviteMembers: (emails: ReadonlyArray<string>) =>
		Promise.allSettled(
			emails.map((emailAddress) =>
				callMethod(organization(), "inviteMember", { emailAddress, role: "org:member" }),
			),
		),
}
