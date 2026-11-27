// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** Locators the auth pages' scene tests share: a vocabulary element by a prop, or a text by its words. */
import { Locator } from "@effect/ui/testing"

export const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

export const button = (label: string) => byProp("button", "label", label)
export const link = (label: string) => byProp("link", "label", label)
export const screenTitled = (title: string) => byProp("screen", "title", title)
export const field = (label: string) => byProp("textField", "label", label)

export const textOf = (value: string): Locator.Locator => ({
	description: `<hz:text>${value}</hz:text>`,
	all: (root) => Locator.all(root, Locator.tag("hz:text")).filter((node) => Locator.textOf(node) === value),
})
