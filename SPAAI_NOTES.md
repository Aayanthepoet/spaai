# SpaAI Conversion Notes

Converting this repo from **PropAI** (real-estate intelligence platform) to **SpaAI**, a
school-outreach SaaS for a mobile spa business.

Status: **CUT executed. Rewiring in progress. No schema changes yet.**
See the [Execution log](#execution-log) at the bottom for exactly where things stand.

Core principle: the existing `contacts` / `campaigns` / `outreach_messages` / compliance
stack is reused, not rebuilt. Migration files written against an empty database were
discarded, because this database already has ~45 tables and a working compliance layer.

The domain chain `properties → owners → contacts → outreach_messages` becomes
`schools → school_staff → contacts → outreach_messages`. Same shape, two renames.

---

## Decisions

**1. Schools live in their own `schools` table. The `leads` funnel is cut.**
Schools do not flow into `leads`. Cut the `leads` table, the `leads_notify_new` trigger,
and the `app.leads` / `app.leads.$leadId` UI.

**2. Contracts are cut for now.** `contracts` table, `src/lib/contracts/*`, the SignWell
integration and its webhook. Revisit later if signed service agreements are needed.

**3. Public profile pages are kept.** `agents.$slug`, `agents.$slug.p.$postSlug`, the
`public_profiles` view, and `src/lib/social-public.functions.ts`. This keeps the social
stack (`social_accounts`, `social_posts`, `social_post_targets`, `social_post_media`)
in scope as a dependency.

---

## Consequences of the decisions (verified against the code)

### Cutting `leads` pulls more than the one table

FK dependents that must be dropped with it: `lead_notes`, `lead_emails`, `lead_assignments`.

Code that references `leads` and will break:
- `src/routes/_authenticated/app.leads.tsx`, `app.leads.$leadId.tsx` — the UI being cut
- `src/components/app/AppSidebar.tsx:49` — sidebar entry
- `src/lib/location-backfill.functions.ts:31,48` — backfills city/state/zip on leads
- `src/routes/api/chat.ts:152,170,192,278` — **the AI agent has lead-management tools**;
  these tool definitions need removing or repointing at `schools`
- `src/routes/api/public/lead-notify.ts` — the endpoint `LeadForm` posts to
- `src/components/site/LeadForm.tsx:51` — public marketing form, posts to the above
- `src/hooks/use-team-members.ts` — used for lead assignment

Also: `notification_preferences.on_new_lead` and `on_lead_reply` lose their meaning.

**Open item:** cutting `leads` removes the public site's inbound-inquiry path, including
the SMS consent capture added in commit `4f670d8` (`sms_opt_in`, `sms_opt_in_at`,
`consent_ip`, `consent_user_agent`). A mobile spa business probably still wants a public
"request a visit" form. Decide whether to (a) drop inbound entirely, (b) keep a slimmed
`leads` table purely for public inquiries, or (c) rebuild a small `inquiries` table. The
`sms_consents` table is separate and `user_id`-scoped, so it survives regardless.

### Keeping public profiles has one real-estate coupling

`src/lib/social-public.functions.ts:66` joins `properties` to render a property card on
public post pages. Under SpaAI this either repoints at `schools` or that block is removed.

Note it selects `price` and `photos`, which are **not** columns on `properties` (the table
has `list_price` and no photos column). Verify whether this path currently errors or
silently returns null before adapting it.

Route naming: `/agents/$slug` is real-estate-agent terminology. Consider `/providers/$slug`
or `/spa/$slug`, but that's a URL change — decide before anything is public.

---

## Reuse as-is (no schema change)

| Table / module | Why it fits |
|---|---|
| `contacts` | `contact_type`/`value`/`confidence`/`is_verified`/`do_not_contact` + FK to the person. Exact fit for a principal's phone/email. |
| `outreach_messages` | Channel, direction, status, provider IDs, `replied_at`, blocked-send rows. Fully generic. |
| `campaigns` | `name`/`channel`/`script`/`status`/`lead_list_id`. A "Fall wellness-day outreach" campaign is the same row. |
| `sms_consents`, `sms_opt_outs`, `suppressed_emails`, `email_unsubscribe_tokens` | TCPA/CAN-SPAM is identical for schools. Includes STOP/START keyword handling in `api/public/hooks/twilio-sms.ts:88`. |
| `compliance_digests`, `compliance_digest_reads` | Weekly opt-out digest. Only the `SITE_NAME`/domain constants at `src/lib/compliance/digest.server.ts:10-12` change. |
| `audit_logs` | Generic action + record_count. |
| Email queue infra | `email_send_log`, `email_send_state`, pgmq/pg_cron/pg_net, `/lovable/email/*` routes. |
| `profiles`, `user_roles`, `subscriptions` | Auth, `has_role()`, Stripe gating, `SubscriptionGate`. |
| `chat_threads`, `chat_messages` | Retarget the system prompt and tools only. |
| `social_*` + OAuth routes | Kept as a dependency of the public profile pages. |
| DB functions | `normalize_phone`, `is_phone_suppressed`, `is_in_quiet_hours`, `dispatch_notification`, `email_queue_dispatch`. |

**The single most valuable piece:** `sendOutreach`
(`src/lib/outreach/outreach.functions.ts:22`) takes
`{owner_id?, contact_id?, campaign_id?, channel, to, subject, body}` and never touches a
property. The DNC guard, the `is_phone_suppressed` gate, the queued-row audit trail, and
provider dispatch are all domain-free. Zero schema work needed.

---

## Light adaptation (property → school)

### `properties` → `schools`

Keep: `address`, `city`, `state`, `zip`, `county`, `neighborhood`, `notes`, `user_id`,
`lead_score`, `created_at`, `updated_at`.

Drop: `beds`, `baths`, `sqft`, `lot_sqft`, `year_built`, `equity`, `estimated_value`,
`lien_amount`, `tax_owed`, `list_price`, `list_date`, `days_on_market`, `auction_date`,
`is_vacant`, `is_absentee`, `is_preforeclosure`, `parcel_id`, `property_type`,
`zoning_code`, `zoning_long_code`, `source_provider`, `source_record_id`,
`last_synced_at`, `distress_type`, `listing_status`.

Add: `name`, `district`, `school_type`, `enrollment`, `grade_range`, `nces_id`.

The `distress_type` and `listing_status` **enums** are left orphaned once those columns
go — drop the types too.

### `owners` → `school_staff`

`full_name`, `entity_type` (→ role: principal / PTA lead / wellness coordinator),
`mailing_*`, `notes` all carry over. `property_id` → `school_id`.
`skip_trace_status` / `skip_trace_last_run_at` drop — school staff directories are public.

### `lead_list_items`

`property_id` → `school_id`. This is the one real coupling in the otherwise-clean outreach
stack: the audience chain runs `campaigns.lead_list_id → lead_lists → lead_list_items →
property_id`.

### `notification_preferences`

Quiet hours, timezone, SMS channel all keep. `on_auction_activity` drops.
`on_new_lead`/`on_lead_reply` need rethinking once `leads` is gone.

### CSV import — `src/lib/csv/mapping.ts:17`

`TARGET_FIELDS` is property-shaped (Address, Owner Name, Distress Type, Estimated Value,
Beds, Baths). Rewrite for School Name, District, Address, Principal, Enrollment, Grade
Range. **This is the primary ingest path for SpaAI** — schools come from a purchased or
scraped list, not a property API, so this file matters more here than it did in PropAI.

### Scoring engine — `src/lib/engines/scoring.functions.ts:53`

The `lead_score` column and the cold/warm/hot/on_fire tier logic are reusable. The
`SYSTEM_PROMPT` scores *seller motivation from distress signals* and must be rewritten to
score booking likelihood from enrollment, school type, budget cycle, prior engagement.

### Contact resolver — `src/lib/engines/contacts.functions.ts`

Prompt rewrite only. **Keep the `[SAMPLE — NOT VERIFIED]` prefix and
`do_not_contact: true` labeling at lines 44-52 exactly as-is** — that safety behavior is
worth more than the prompt.

### Undecided, cheap either way

`watchlist_items` and `saved_searches` are generic. Follow whatever is decided about the
school-browse UI.

---

## Cut

**Data acquisition (deepest real-estate coupling):** `distress_events`, `sync_runs`,
`lookup_history`; `src/lib/distress/*`; the ATTOM provider; env vars `ATTOM_API_KEY`,
`ENABLE_ATTOM`, `PROPERTY_PROVIDER`; cron hooks `sync-distressed`, `sync-distressed-one`;
routes `app.properties.search`, `app.properties.lookup`, `app.properties.lookup-history`,
`api/public/attom-health`.

**Valuation:** `comps`, `arv_estimates`, `market_intel_cache`; `src/lib/comps/*`;
`src/lib/market-intel.functions.ts`.

**Auctions:** `auctions`, `bids`; `src/lib/auctions/*`; `close-auctions` cron hook;
`close_expired_auctions` / `close_auction_if_expired` RPCs; `bids_notify_new` and
`auctions_notify_status` triggers; routes `app.auctions`, `app.auctions.$auctionId`.

**Title & foreclosure:** `title_searches`; `src/components/title-search/*`;
`app.title-search`, `app.title-search.history`; `app.foreclosure-agent`;
`src/lib/foreclosure/*`.

**Skip trace:** `user_skiptrace_credentials`; `src/lib/skiptrace/*`. Also abandons the
BatchData/IDI/TLO adapter work described in `.lovable/plan.md`. School staff are publicly
listed — this is spend SpaAI does not need.

**Vision Studio:** `vision_source_photos`, `media_assets`, likely `videos`;
`src/lib/vision/*`; `BeforeAfterSlider`, `SourcePhotoCropper`; routes `app.vision`,
`app.vision.library`, `app.videos`. If spa before/after marketing is wanted later, rebuild
small rather than adapting this.

**Leads funnel (decision 1):** `leads`, `lead_notes`, `lead_emails`, `lead_assignments`;
`leads_notify_new` trigger; `app.leads`, `app.leads.$leadId`; `api/public/lead-notify`;
`src/components/site/LeadForm.tsx`; `src/lib/location-backfill.functions.ts`; lead tools
in `src/routes/api/chat.ts`.

**Contracts (decision 2):** `contracts`; `src/lib/contracts/*`; `app.contracts`,
`app.contracts.$contractId`, `app.admin.contracts`, `app.admin.contracts.$contractId`;
`api/public/hooks/signwell`; env `SIGNWELL_API_KEY`, `SIGNWELL_WEBHOOK_SECRET`; the
contracts storage bucket and its policies.

**Branding assets:** `public/propai-intro.mp4`, `public/propai-intro.en.vtt`,
`public/og-image.png`, `src/assets/ainetworkagency-logo.png.asset.json`, the entire
`remotion/` sub-project.

Roughly 16–18 of the ~45 tables are removed.

---

## Execution rules

1. **Delete code before dropping tables.** Two migrations, not one. Dropping first breaks
   routes that still import the removed server functions.
2. **Regenerate `src/integrations/supabase/types.ts`** from Supabase after any migration.
   That file and both `client.ts` / `client.server.ts` are marked auto-generated — do not
   hand-edit.
3. **Preserve the RLS pattern** on every new table: `GRANT` to `authenticated` +
   `service_role`, `ENABLE ROW LEVEL SECURITY`, four `user_id = auth.uid()` policies, plus
   the admin override via `has_role()`.
4. **Never import `client.server.ts` at the top level** of a route or `*.functions.ts`
   file — those ship to the client bundle. Load it inside the handler
   (`src/integrations/supabase/client.server.ts:36`).
5. **Do not rewrite published git history** — this repo syncs to Lovable
   (see `AGENTS.md`). Keep the branch in a working state.
6. Hardcoded "PropAI" strings live in `src/routes/__root.tsx:67-76` (all meta/OG tags),
   `src/routes/_authenticated/app.tsx:16`, the 404 button in `__root.tsx:28`, and
   `src/lib/compliance/digest.server.ts:10`. The sidebar and shell already render from
   i18n keys across 5 locales (`en`, `es`, `ht`, `ru`, `zh`), so nav renaming is a
   locale-file edit.
7. **Env vars are not in the repo.** Only Supabase keys are in `.env`; everything else
   (`STRIPE_*`, `TWILIO_*`, `META_*`, `X_*`, `GOOGLE_*`, `LOVABLE_API_KEY`, `CRON_SECRET`,
   `NOTIFY_HOOK_SECRET`, `OUTREACH_WEBHOOK_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`) is set
   in the Lovable host env. The deploy checklist must cover unsetting the cut ones.

---

## Testing gap

There is effectively no test coverage — one Python E2E file
(`tests/e2e/property_row_click_test.py`), itself tied to a cut feature. The conversion has
no safety net; verify manually against the running app, especially the outreach send path
and the compliance gates.

---

## Execution log

### Step 1 — CUT: done

**92 files deleted** (91 tracked + `remotion/bun.lock`, which was gitignored). Staged, not
committed. Covers every module in the Cut section above: auctions/bids, vision studio,
video pipeline + `remotion/`, title search, foreclosure, ATTOM/distress acquisition,
skip trace, comps/ARV/market-intel, contracts, the leads funnel, and `watchlist`.

Also deleted, found during the pass:
- `src/lib/location-parse.ts` — became dead once `location-backfill.functions.ts` and the
  old `lead-notify.ts` body went; those were its only two consumers.
- `public/og-image.png`, plus the 6 `og:image` / `twitter:image` meta lines referencing it
  in `index.tsx`, `pricing.tsx`, `features.tsx`.

**Deliberately NOT deleted** (decision changed mid-pass — inbound is stubbed, not dropped):
- `src/components/site/LeadForm.tsx` — rewrite in place as a simple contact/inquiry form
  (name, email, phone, message) that still captures SMS consent.
- `src/routes/api/public/lead-notify.ts` — rewrite in place, slim. Keeps the honeypot,
  the 5/hour per-IP rate limit, and `sms_opt_in` / `sms_opt_in_at` / `consent_ip` /
  `consent_user_agent`. Drops the location enrichment and the `new-lead-alert` email
  fan-out. Filenames and the `/api/public/lead-notify` route path stay as-is for now.
- Kept `public/sample-leads.csv` — it feeds `ImportLeadsDialog`, the primary school-ingest
  path.

**Created:** `src/lib/owners/owners.functions.ts`. `skiptrace.functions.ts` could not just
be deleted — it also held `listOwners`, `listOwnerContacts`, `setContactDoNotContact`,
which `app.owners.tsx` and `app.contacts.tsx` still need. Those three moved verbatim;
`runSkipTrace` is gone. The `[SAMPLE — NOT VERIFIED]` / `do_not_contact: true` safeguard is
a separate copy in `engines/contacts.functions.ts:40-50` and is intact.

**Still owed from the cut:** the additive `inquiries` table migration (the stub form needs
a write target now that `leads` is going away). No drops today — code first, per rule 1.

### Step 2 — Rewire: in progress

Baseline established by running both checks against `HEAD` in a throwaway worktree:

| | HEAD (pre-cut) | After cut |
|---|---|---|
| `tsc --noEmit` | **3 errors** | **58 errors** |
| `eslint` | 5310 problems | 4111 problems |

So the cut introduced **55 TypeScript errors** and **zero** new lint problems. Lint counts
went *down* only because deleted files took their formatting violations with them — the
4070 remaining `prettier/prettier` errors are pre-existing repo-wide drift, unrelated.

The 3 pre-existing errors, which are **not** ours and exist unchanged at `HEAD`:
```
DashboardAnalyticsWidget.tsx(121,11)  TS2322
DashboardAnalyticsWidget.tsx(143,11)  TS2322
app.outreach.tsx(366,20)              TS2741
```

Every one of the 55 lands in a file that was already on the modify list. **No hidden
coupling was discovered.** They break down as: 19 × `TS2307` missing module, 11 × dead
typed-router links, 25 × cascading implicit-`any` that evaporate once imports are repointed.

**COMPLETE. `tsc` went 58 → 1.** All 55 cut-related errors are fixed. Two of the three
pre-existing errors were incidentally fixed along the way; one remains:

```
DashboardAnalyticsWidget.tsx(94,11)  TS2322   pre-existing, /app/audit export.csv tile
```

- [x] Batch 1 — `app.owners.tsx`, `app.contacts.tsx`. 58 → 39.
- [x] Batch 2 — `app.properties.$propertyId.tsx` **stubbed**, 1153 → 172 lines.
- [x] Batch 3 — `app.settings.integrations.tsx` **deleted**, `registry.ts` trimmed.
- [x] Batch 4 — nav + dead links: sidebar 25 → 14 entries, 11 dead keys removed from all
      5 locales, `app.properties.index.tsx`, `app.scoring.tsx`, `app.outreach.tsx`.
- [x] Batch 5 — `LeadForm.tsx` + `lead-notify.ts` rewritten, `inquiries` migration added.
- [x] Correctness cleanups that were not type errors: `DashboardAnalyticsWidget` +
      `dashboard.functions.ts` skip-trace tiles, `app.audit.tsx` `skiptrace.run` filter,
      and the 5 lead/contract tools in `api/chat.ts` (plus their SYSTEM_PROMPT lines).

Decisions taken during the rewire, worth knowing before step 3:

- **`app.properties.$propertyId.tsx` is a stub.** Its data source (`getPropertyDetail`)
  was deleted and ~900 of 1153 lines were cut modules. It now loads the `properties` row
  directly and renders only the header plus `AiLeadScoreSection`, which was the one
  cleanly reusable piece. This is where the real school detail page gets built.
- **`app.settings.integrations.tsx` was deleted, not stubbed** — all five of its sections
  (ATTOM status, distress sync, location backfill, skip-trace credentials) were cut. The
  Integrations card in `app.settings.tsx` went with it.
- **`app.owners.tsx` lost `validateSearch`** (the pending/traced filter was pure skip
  trace). That incidentally fixed the pre-existing `app.outreach.tsx(366)` TS2741.
- A prediction that turned out **wrong**: `DashboardAnalyticsWidget`'s
  `search={{ status }}` props on `/app/owners` did *not* become type errors after
  `validateSearch` was removed — TanStack tolerates extra search params. Removing those
  tiles was still correct, but for dead-UI reasons, not compilation.
- `runSkipTrace` is gone, so **no code path writes `skip_trace_status` anymore**. The
  columns still exist and `listOwners` still selects them; they get dropped in step 3.

### Known-failing, and NOT caused by the cut

`npx vite build` fails with `Error: css content for "" was not found`. **Verified
pre-existing** — `HEAD` fails with the identical error in a clean worktree against the same
`node_modules`. Almost certainly an artifact of the npm-resolved tree (vite 8 + rolldown)
rather than bun's. Re-test after `bun install` before spending time on it.

`eslint` is at 3871 problems, down from 5310 at `HEAD`; non-prettier problems 99 → 40.
**Zero** new lint problems were introduced. The ~3831 `prettier/prettier` errors are
repo-wide pre-existing formatting drift.

### Step 3 — property → school rename: NOT STARTED

**Unblocked** — `tsc` is at the pre-existing baseline, so the rename can begin against a
known-good tree. Everything under "Light adaptation" above belongs to this step, plus:

- Rebuild the real school detail page in place of the `app.properties.$propertyId.tsx` stub.
- Retarget `scoring.functions.ts`'s SYSTEM_PROMPT from seller motivation to booking
  likelihood, and the tier copy in `AiLeadScoreSection`.
- Drop the `skip_trace_status` / `skip_trace_last_run_at` columns and remove them from
  `listOwners`; nothing writes them anymore.
- Drop the cut tables (`leads`, `lead_notes`, `lead_emails`, `lead_assignments`, auctions,
  bids, comps, contracts, vision, title_searches, …) — the code referencing them is gone,
  so rule 1 is satisfied and the drop migration is safe to write.
- Regenerate `src/integrations/supabase/types.ts` after any migration, including the
  already-written `inquiries` table.

### Environment notes

- `node_modules/` was installed with `npm install --no-save` (846 packages).
  `package.json`, `package-lock.json`, and `bun.lock` are all verified untouched.
- **`npm ci` does not work here** — `package-lock.json` is stale (last touched in
  `7a83a0c`, well before `bun.lock` in `4a0d54b`). bun is the real toolchain; it just
  isn't installed on this machine. For a faithful install use
  `brew install bun && bun install`, which also honors the `minimumReleaseAge = 86400`
  supply-chain guard in `bunfig.toml`.
- `src/routeTree.gen.ts` was regenerated via `npx vite build` and now has 0 stale route
  references. It is auto-generated — never hand-edit it.
- **Nothing is committed.** The tree does not build in this state. Per `AGENTS.md`, commits
  sync to Lovable and the branch should stay working — do not push until step 2 finishes.
