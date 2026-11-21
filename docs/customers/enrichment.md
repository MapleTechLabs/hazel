# Customers: company enrichment

Each customer account gets a company profile looked up from its domain with
[context.dev](https://docs.context.dev): what the company does, its industry, headcount,
headquarters, founding year, funding, estimated revenue, social links, brand colours and logo.
The customer page shows it in a **Company** section, and the customer list can show and filter by
industry, size, country and funding stage.

## Data

- `customer_enrichments` (customers store, internal): one row per domain, shared by every account
  with it. `status` (`pending`, `enriched`, `not_found`, `skipped`, `failed`), `profile`,
  `fetchedAt`, `nextAttemptAt` (null: no account uses it), `forceRefresh`, `failures`, `error`,
  `creditsUsed` (every lookup's credits, summed: enrichment is billed later).
- `customer_accounts.companyProfile` (`CompanyProfile`, `@hazel/domain/customers`) and
  `companyCheckedAt` (when a lookup of its domain last answered, found or not). Synced with the
  account, so pages need no extra read. Null `companyCheckedAt`: never looked up; set with a null
  profile: context.dev knows no company there.
- The profile never overwrites a synced field. Pages picture an account by its own logo, else its
  company's (`logoOf`).

An account's domain is its first one that is not a mail provider's (`enrichmentDomainOf`,
`FREE_MAIL_DOMAINS`, the list account matching and channel suggestions use too). An account without
one is never looked up.

## Lookups

One lookup (`worker/objects/customers/enrichment/client.ts`) is:

1. `POST /v1/brand/retrieve` `{ type: "by_domain", domain }`: identity, industry (EIC), headcount
   range, address, socials, pages, colours, logos. 10 credits; a miss is free. A miss is a 400
   whose `error_code` (the docs say `code`; the API sends `error_code`) is `NOT_FOUND`,
   `WEBSITE_NOT_FOUND`, `WEBSITE_ACCESS_ERROR` or `WEBSITE_BLOCKED`; any other 400 is a failure.
2. When Brand found a company, `POST /v1/company/search` (`fast`, 2 credits) with its name and
   the domain Brand resolved to (a redirect may land elsewhere). A result counts only when its domain is the same company's (`isSameCompany`); it adds
   founded year, company type, operating status, funding rounds and an estimated revenue range,
   never replacing what Brand had. A failed search never fails the lookup.

`map.ts` keeps only `https:` links and `#rrggbb` colours, picks a light square icon for the logo,
and buckets headcounts into `EmployeeRange`.

## Schedule (`enrichment/job.ts`)

- After each compute turn, `seedEnrichments` adds a row (due now) for every live account's domain,
  stops rows no account uses, and gives each account its domain's answer: a new account at a known
  domain its profile, an account whose domain changed or went none (a profile from its old domain
  is cleared).
- An alarm turn without a compute runs `runDueEnrichments`: up to 10 due rows, 5 at a time, a
  person's refreshes first, after the turn's pulls, wakes and unmutes. A domain whose accounts were
  all deleted is stopped without a lookup. The earliest `nextAttemptAt` is one of the object's
  alarm deadlines; a turn that fails before its rows move on moves every due row a lease ahead.

| Answer                                                                               | Row                                                       | Next lookup                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------- |
| Found                                                                                | `enriched`, profile copied to the accounts                | 90 days                       |
| No company (400, see above)                                                          | `not_found`, accounts checked; an earlier profile is kept | 90 days                       |
| Mail provider or disposable (422 `FREE_EMAIL_DETECTED`, `DISPOSABLE_EMAIL_DETECTED`) | `skipped`                                                 | 1 year                        |
| Any other 422 (e.g. `COLD_DOMAIN_TIMEOUT_TOO_LOW`)                                   | `failed`, `failures` + 1                                  | backoff, as below             |
| Rate limited (429)                                                                   | unchanged                                                 | after `Retry-After`           |
| Refused key (401/403)                                                                | `failed`                                                  | 6 hours                       |
| Anything else                                                                        | `failed`, `failures` + 1                                  | 10 min × 4^failures, ≤ 7 days |

Retry deadlines count from when the answers came, not the turn's start. A failed refresh keeps
the profile found before. Each lookup first moves its row 5 minutes ahead (and takes its refresh ask), so one the runtime
kills retries then. A refresh asked while a lookup is out keeps its row due now. Round dates are
kept only as real `YYYY-MM-DD` days, and a known headcount decides the size bucket (sources' ranges
lag it). Account writes go in chunks of 90 ids (SQLite binds at most 100 values).

`customers.account.refreshCompany` (members) makes the account's domain due now with
`forceRefresh` (context.dev's cache skipped, `maxAgeMs: 0`); within a minute of the last answer it
changes nothing. It is refused for an account without a usable domain, and when lookups are not set
up.

## Configuration

`CONTEXT_DEV_API_KEY` (api Worker secret, Hazel's own key). Unset: nothing is looked up, due rows
wait a day, and refreshes are refused.
