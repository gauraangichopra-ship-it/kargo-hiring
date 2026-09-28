# Kargo Hiring Dashboard

Next.js · Neon Postgres · Gemini Flash · Resend

A ranked PM / SPM shortlist for Arjun Mehta, founder of Kargo.
**The system ranks and explains. Arjun decides. Nothing is sent without his click.**

Candidates are scored against a rubric built from Kargo's best past hires (`rubric.txt`), not the job description.

## Setup

```bash
npm install
npx neon auth                                  # sign in (browser)
npx neon link --project-id <id> --branch production -y   # writes DATABASE_URL into .env.local
```

Then add `GEMINI_API_KEY` (and later the Resend vars) to `.env.local`.

1. `npm run db:push`: creates the 9 tables on Neon from `db/schema.sql`. It does nothing if they already exist; `npm run db:push -- --reset` wipes and recreates them.
2. `npm run seed`: parses `rubric.txt` into `rubric_criteria` (fails loudly if a role's weights don't sum to 100).
3. `npm run dev` → http://localhost:3000
4. Open **/api/health**. Every check should be `ok: true` (Resend can stay false until checkpoint B·2).

### Environment variables

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string; written by `neon link`. Server-side only |
| `DATABASE_URL_UNPOOLED` | for `db:push` | Direct connection used for schema changes |
| `GEMINI_API_KEY` | yes | **Use a key with billing enabled** (see Privacy) |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash` |
| `RESEND_API_KEY` | later | Blank = Send buttons show "Email not configured" |
| `RESEND_FROM_EMAIL` | no | Defaults to `onboarding@resend.dev` |
| `TEST_RECIPIENT_EMAIL` | for sending | MESA test inbox; every email goes here in test mode |
| `SEND_MODE` | no | `test` (default) or `live` |

`.env.local` is git-ignored. Only `.env.example` (blank values) is committed.

## Architecture (matches the Components Map)

```
FOUNDER    TRIGGER     /upload: pick role (PM|SPM), drop up to 60 CVs
              │
           INPUT       CV file + role  ──►  POST /api/process   (3 files in parallel)
              │
SYSTEM     CONTEXT     parse PDF/DOCX/TXT
              │        regex → name, email, phone, links      ──► candidate_pii     (never sent to AI)
              │        redact → [CANDIDATE] [EMAIL] [PHONE] [LINK] [INSTITUTION]
              │        ASSERT no PII left, else status=error, no AI call
              │                                               ──► candidate_content (only thing AI sees)
              │
           PROCESSING  Gemini scores 0-5 per criterion, BOTH rubrics, temp 0, JSON schema
              │        code: validate → verify quote is in CV (else cap at 3) → weighted total
              │        code: rank per applied role → top 5 invite / within 5 pts review / rest reject
              │                                               ──► scores, score_totals
              │
AI         AI          POST /api/draft: 3-sentence brief + probe questions (invite/review)
              │        email draft for everyone with [NAME]/[ROLE] placeholders
              │                                               ──► briefs, emails (status=draft)
              │
FOUNDER    OUTPUT      /  ranked dashboard  ·  /candidate/[id]  ·  /bulk-send
              │        Arjun reads, edits, switches Invite/Reject, clicks Confirm & Send
              │
EMAIL      RESEND      POST /api/send-email: fill [NAME]/[ROLE], refuse leftovers,
                       lock row, send, status=sent, never twice
```

### Pages

- **/**: tabs per role, summary strip, ranked table with a line under the top 5, cross-role toggle.
- **/upload**: role selector, drag-and-drop, live per-file progress, Retry.
- **/candidate/[id]**: both scores, evidence quote per criterion, brief, probe questions, editable email, Confirm & Send.
- **/bulk-send**: every unsent draft, nothing pre-ticked, one confirmation.

### Where things live

| Concern | File |
|---|---|
| Rubric parsing / seeding | `src/lib/rubric-parse.ts`, `scripts/seed-rubric.ts` |
| PII extraction + redaction + leak assert | `src/lib/pii.ts` |
| Scoring prompt | `src/lib/scoring.ts` |
| Weighted totals, quote check, ranking (pure code) | `src/lib/scoring-core.ts` |
| Brief + email prompts | `src/lib/drafts.ts` |
| Pipeline orchestration | `src/lib/pipeline.ts` |
| Database connection (Neon) | `src/lib/db.ts`, `db/schema.sql`, `scripts/db-push.ts` |
| Resend + test/live mode | `src/lib/email.ts` |
| Tunables (top-N, review band, concurrency) | `src/lib/config.ts` |

## Guardrails

- **No auto-reject, no auto-send.** Every email needs a click plus a confirmation.
- **Gemini never sees** name, email, phone, links, photos or institution names. If redaction fails the check, the candidate is marked `error` and no AI call is made.
- **Scores are computed in code.** The model returns 0–5 per criterion with a verbatim quote; code verifies the quote exists in the CV and does the weighting.
- **Emails can't send twice.** The row is locked (`draft → sending → sent`) before Resend is called.

## Privacy: use the paid Gemini API

The Google AI Studio **free tier may use your prompts to improve Google's models**. The paid API (billing enabled on the project) does not. These are real people's CVs, so use a billed key. Redaction limits what reaches Gemini, but CV content is still personal data.

## Going live

Emails go to `TEST_RECIPIENT_EMAIL` with the subject prefixed `[TEST -> candidate@email]` until you set:

```
SEND_MODE=live
```

Before doing that: verify your own domain in Resend and set `RESEND_FROM_EMAIL` to it (`onboarding@resend.dev` can only deliver to your own address), and put the app behind a login (e.g. Neon Auth) so only Arjun can open it.

## Deploy (Vercel)

1. `git push` to GitHub.
2. Import the repo in Vercel and add every env var from the table above (copy `DATABASE_URL` from `.env.local`, or connect the Neon integration in Vercel).
3. Deploy. Visit `/api/health` on the live URL.

## Notes

- Re-running `npm run seed` with unchanged criterion names keeps existing scores. Renaming a criterion replaces that role's rubric and deletes its scores.
- `CONFIRM_NAME_WITH_AI` in `src/lib/config.ts` is **off**: sending the top of a CV to Gemini to confirm the name would break "Gemini never receives the name". Names come from deterministic code.
