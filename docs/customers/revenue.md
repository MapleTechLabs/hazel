# Revenue: MRR, run-rate MRR and revenue

How Hazel turns billing data into the revenue numbers on the overview and the customer page. Nothing
here is specific to one product's pricing: what counts as recurring, variable or one-off is the
org's **revenue rules** (Settings → Revenue), applied to every Stripe line Hazel reads.

## The three numbers

| Number           | What it is                                                                       | Source                                    |
| ---------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **MRR**          | Contracted recurring revenue per month, now                                      | subscription items classed `recurring`    |
| **Run-rate MRR** | MRR + **variable MRR** (the trailing average of variable billing)                | MRR, and invoice lines classed `variable` |
| **Revenue**      | Money collected in a period, excluding tax, split recurring / variable / one-off | paid invoices' lines, by paid date        |

- MRR is the stable number: movements (new, expansion, contraction, churn, reactivation), NRR,
  at-risk MRR and the customer list's MRR column are on it. Usage swings never show up as
  expansion or contraction.
- Run-rate MRR is the headline for usage-based pricing. A run-rate NRR sits beside NRR.
- Revenue is cash: what paid invoices billed, net of discounts and credits, without tax.

All three are in the org's reporting currency; billing in another currency is left out of the totals
(no FX), as MRR always was.

## Classification

Each **billing line** gets one class:

| Class       | MRR                                    | Run-rate         | Revenue   |
| ----------- | -------------------------------------- | ---------------- | --------- |
| `recurring` | yes (fixed price), or trailing average | yes              | recurring |
| `variable`  | no                                     | trailing average | variable  |
| `one_off`   | no                                     | no               | one-off   |
| `excluded`  | no                                     | no               | no        |

A billing line is a subscription item (what a subscription bills each period) or an invoice line.
Both name a Stripe price and product, so one rule classifies both the same way.

### Rules

An ordered list; the first rule whose conditions all hold decides. A line no rule matches falls to
the **defaults**, which follow Stripe's own pricing semantics:

1. a price billed by usage (`usage_type: metered`, or `billing_scheme: tiered`) → `variable`
2. a recurring price (or a subscription item) → `recurring`
3. anything else (a one-time price, an invoice item with no price) → `one_off`

A condition tests one field of the line:

| Field            | Values                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| `product`        | Stripe product ids                                                                      |
| `price`          | Stripe price ids                                                                        |
| `lookup_key`     | price lookup keys                                                                       |
| `usage_type`     | `licensed`, `metered`                                                                   |
| `billing_scheme` | `per_unit`, `tiered`                                                                    |
| `price_type`     | `recurring`, `one_time`                                                                 |
| `line_source`    | `subscription` (a subscription item), `invoice_item`                                    |
| `proration`      | `true`, `false`                                                                         |
| `metadata`       | a key, and values: matched on the line's, then the price's, then the product's metadata |

A condition holds when the line's value is one of its values (`metadata`: the key's value). The
price's fields come from the price catalog Hazel reads from Stripe (`customer_prices`); a line whose
price is not in it yet is matched on what the line itself says.

### What a line is worth

An invoice line's **net amount** is Stripe's `amount` minus its `discount_amounts`, minus its
pre-tax credits from the credit balance (billing credits), minus tax when the tax is inclusive
(exclusive tax is not in `amount`). It can be negative (a proration credit). A subscription item's
monthly amount is its price × quantity normalized to a month, with the subscription's discounts
spread over its priced items in proportion to their amounts.

## MRR

Per account, from its billing source's live, billed subscriptions in the reporting currency
(`billingProviderOf`, unchanged):

- each item classed `recurring` with a fixed price adds its monthly amount;
- a `recurring` item without a fixed price (metered or tiered, classed recurring by a rule) adds the
  trailing average of its invoice lines, as variable MRR is computed;
- items of any other class add nothing.

A subscription Hazel holds no items for (Autumn's; Stripe's read before items were stored) counts its
`mrrMinor` as recurring.

## Variable MRR

The average monthly variable billing over the last **N full calendar months** (Settings → Revenue,
1–12, default 3), before the current month:

- invoices that are `open` or `paid` (billed; void and uncollectible ones are not revenue);
- each variable line's net amount is spread over its service period (`period.start`–`period.end`)
  by day, so usage billed in arrears on 1 November counts for October, and an annual line a twelfth
  per month;
- divided by the months of the window the account has been billed in (from the month its first
  line's service period starts), at most N: a customer billed for one month is not diluted by two
  months it was not a customer.

It changes only when a month ends or an invoice is billed, never day to day, so it adds no noise.

## Revenue

Per period: the paid invoices whose `paidAt` falls in it, each line's net amount by its class. An
invoice Hazel holds no lines for (read before lines were stored, Autumn) counts its paid amount as
**unclassified**. Credit notes and refunds are not read yet: revenue is gross of refunds.

## Changing the rules

Rules and the window are the **revenue basis**. Each account stores the basis its MRR was computed
under (`mrrBasis`); when it changes (an edit in settings, or a release that changes the method),
the next compute restates the last 12 months from the billing data under the new basis, as it does
after a billing backfill: MRR movements and the org's daily MRR are rebuilt, and no movement is
written for the change itself. A reclassification is never expansion or contraction.

A restated day's MRR is what the subscription's invoices billed for it: the fixed-price recurring
lines in effect then, prorations aside, so an upgrade appears on the renewal that billed it.

While Stripe imports, an account's variable MRR (and MRR, when a rule can put usage in it) stays at
the end of its recorded series; the first compute after the import records the whole change. A
restatement waits for the connections importing again, for up to a day; one that finishes later gets
a second restatement. Deleted accounts keep their recorded movements, which retention reads.

## Known limits

- Credit notes and refunds are not read: revenue is gross of them.
- Revenue counts a paid invoice's lines, so an invoice settled from a customer's credit balance counts
  in full though less cash moved on it.
- Editing a Stripe price or product (its metadata, say) that a rule matches changes the class without
  changing the basis: the MRR it moves is written as a normal movement, not restated.
- A customer billed only on usage has no MRR, so no MRR movements: it is absent from logo churn.
