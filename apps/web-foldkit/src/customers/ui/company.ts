import type { CompanyProfile } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconMapPin, IconOffice, type IconOptions, IconRocket, IconUsers } from "../../icons"
import { countryFlag, employeesLabel, fundingStageLabel, fundingStageOf, headquartersLabel } from "../company"
import { badge } from "../../ui/badge"

/**
 * An enriched company at a glance (`docs/customers/enrichment.md`), wherever a customer is shown:
 * its key facts as chips.
 */

type IconComponent = <M>(h: HtmlBuilder<M>, options?: IconOptions) => Html

/**
 * The facts people size a customer by, as short chips: industry, headcount, headquarters, funding.
 * Shown under the customer's name, so the company is seen without opening anything.
 */
export const companyFacts = <M>(h: HtmlBuilder<M>, company: CompanyProfile): ReadonlyArray<Html> => {
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const employees = employeesLabel(company)
	const stage = fundingStageOf(company)
	const facts: ReadonlyArray<readonly [IconComponent, string, string] | null> = [
		company.industry === null ? null : [IconOffice, company.subindustry ?? company.industry, "Industry"],
		employees === null ? null : [IconUsers, `${employees} employees`, "Employees"],
		headquarters === null
			? null
			: [IconMapPin, flag === "" ? headquarters : `${flag} ${headquarters}`, "Headquarters"],
		stage === null ? null : [IconRocket, fundingStageLabel(stage), "Funding stage"],
	]
	return facts.flatMap((fact) =>
		fact === null
			? []
			: [
					badge(
						h,
						{
							intent: "outline",
							className: "h-6 max-w-full gap-1.5 rounded-md px-2 font-normal text-fg-2",
							attributes: [h.Key(fact[2]), h.Title(fact[2])],
						},
						[
							fact[0](h, { className: "size-3.5 shrink-0 text-muted-fg" }),
							h.span([h.Class("truncate")], [fact[1]]),
						],
					),
				],
	)
}
