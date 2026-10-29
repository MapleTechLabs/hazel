import type { IR } from "@tanstack/db"

type Expression = IR.BasicExpression<unknown>

const isFieldRef = (expr: Expression | undefined, field: string): boolean =>
	expr !== undefined && expr.type === "ref" && expr.path[expr.path.length - 1] === field

const stringValues = (value: unknown): Set<string> | undefined => {
	const values = Array.isArray(value) ? value : [value]
	const result = new Set<string>()
	for (const item of values) {
		if (typeof item === "string") result.add(item)
		else if (typeof item === "number") result.add(String(item))
	}
	return result
}

const extract = (expr: Expression | undefined, field: string): Set<string> | undefined => {
	if (expr === undefined || expr.type !== "func") return undefined
	const [left, right] = expr.args
	switch (expr.name) {
		case "eq": {
			if (isFieldRef(left, field) && right?.type === "val") return stringValues(right.value)
			if (isFieldRef(right, field) && left?.type === "val") return stringValues(left.value)
			return undefined
		}
		case "in": {
			if (isFieldRef(left, field) && right?.type === "val" && Array.isArray(right.value)) {
				return stringValues(right.value)
			}
			return undefined
		}
		case "and": {
			// Any conjunct that pins the field bounds the whole conjunction.
			let result: Set<string> | undefined
			for (const arg of expr.args) {
				const values = extract(arg, field)
				if (values === undefined) continue
				result = result === undefined ? values : new Set([...result].filter((v) => values.has(v)))
			}
			return result
		}
		case "or": {
			// Every branch must pin the field, otherwise some branch matches any partition.
			const result = new Set<string>()
			for (const arg of expr.args) {
				const values = extract(arg, field)
				if (values === undefined) return undefined
				for (const value of values) result.add(value)
			}
			return result
		}
		default:
			return undefined
	}
}

/**
 * The values of `field` a subset predicate is limited to: `eq(field, x)`, `inArray(field, [...])`,
 * nested in `and` / `or`. `undefined` when the predicate does not bound the field (no `where`, or a
 * branch that matches any value).
 */
export const extractPartitionValues = (
	where: IR.BasicExpression<boolean> | undefined,
	field: string,
): ReadonlyArray<string> | undefined => {
	const values = extract(where as Expression | undefined, field)
	return values === undefined ? undefined : [...values]
}
