# NavTailor

Tailor your resume to a job description without inventing anything.

You keep one **master profile**: experience, projects, skills and education. NavTailor can import
it from an existing PDF or DOCX. Paste a job description and NavTailor will:

1. read the job and pull out the required skills, preferred skills and keywords,
2. score every bullet in your profile against the job and pick what fits on **one page**,
3. ask an LLM to rephrase the chosen bullets in the job's language,
4. **check every rewrite in code** and keep your original wording wherever the rewrite added a
   number, a tool or a company you never wrote,
5. show a gap report (what matched, what's missing), a list of changes you can accept or reject,
   and a PDF built with LaTeX.

Saved applications track where you are with each job: saved, applied, interview, offer or rejected.

---

## Architecture

```
 Browser (React + Vite + Tailwind)
 ├─ Landing / Google sign-in        Google Identity Services gives an ID token
 ├─ Profile editor + import         PDF/DOCX/paste -> draft profile -> you review -> save
 ├─ New tailoring                   company, role, job description
 ├─ Result                          gap report · accept/reject changes · PDF + .tex download
 └─ Dashboard                       applications, newest first · status dropdown · delete
        │
        │  fetch('/api/...')  with an httpOnly session cookie (Vite proxies /api in dev)
        ▼
 Express API (Node)
 ├─ helmet · CORS (one origin) · JSON size limits · rate limits (per IP for sign-in, per user elsewhere)
 ├─ requireAuth ── verifies our own JWT from the cookie, sets req.user.id
 │
 ├─ /api/auth          POST /google (verify Google ID token -> upsert user -> set cookie) · /me · /logout
 ├─ /api/profile       GET/PUT the master profile (zod-validated)
 │   └─ /import        file -> magic-byte check -> text extraction in a worker -> LLM -> grounded draft
 ├─ /api/tailor        the tailoring pipeline (saves nothing, returns the result + a signed save token)
 ├─ /api/applications  save (verifies the token), list, read, change status, accept/reject, delete
 └─ /api/resume        /render (JSON -> LaTeX -> Tectonic -> one-page PDF) · /tex
        │                       │                                  │
        ▼                       ▼                                  ▼
 MongoDB Atlas            callLLM() router                  Tectonic (child process)
 users                    Gemini Flash ─┐                   --untrusted, no shell,
 profiles   (embedded)    Groq ─────────┼─ fallback chain   env allowlist, 30 s timeout,
 applications ─┐          Gemini Lite ──┘                   max 2 at once
 resumeVersions┘ (referenced by applicationId)
```

### The tailoring pipeline (`server/src/tailor/`)

```
job description ─► 1 analyze (LLM) ─► 2 score (code) ─► 3 select (code) ─► 4 rewrite (LLM)
                                                                              │
     gap report ◄─ 6 gap report (code) ◄─────────── 5 guardrail (code) ◄──────┘
     questions  ◄─ bullets with no metric (code)
```

Only steps 1 and 4 call a model. Everything else is plain, tested code.
- **If step 1 fails**, there's nothing to score, so the API returns a 502.
- **If step 4 fails**, you still get a resume, built from your original bullets.

### Data model

| Collection       | Holds                                                                  | Relationship                                                                                    |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `users`          | Google `sub`, email, name, picture                                     | none                                                                                            |
| `profiles`       | one master profile per user, with items embedded                      | `userId`, unique                                                                                |
| `applications`   | company, role, `jdText`, `status`, `gapReport`                         | `userId`. Index `{ userId: 1, createdAt: -1 }`                                                  |
| `resumeVersions` | the signed tailoring result, decisions, `resumeJson`, `texSource`     | `applicationId` and `userId`. Index `{ userId: 1, applicationId: 1, createdAt: -1 }`            |

**Why profiles embed their items:** a profile is bounded, and its items are always read together.

**Why resume versions are referenced:** versions grow without limit and are read on their own, so
they live in their own collection. The dashboard never loads them.

**Deleting an application deletes its versions too.** MongoDB has no cascading delete, so the
DELETE route does it explicitly.

**PDFs are never stored.** They're rebuilt on demand.

**Every query includes `userId` from the verified session.** Someone else's id gets a 404, exactly
like an id that doesn't exist.

---

## Setup

### Prerequisites

- **Node.js 22+**
- **Tectonic**, the LaTeX engine (<https://tectonic-typesetting.github.io>). It must be on your `PATH` as `tectonic`.
- **A MongoDB Atlas cluster.** The free M0 tier is enough. Add your IP to the network access list.
- **A Google OAuth client ID**, type "Web application". Add `http://localhost:5173` as an authorized JavaScript origin.
- **At least one LLM key:** Gemini (Google AI Studio) and/or Groq. Both have free tiers. With only
  one, the fallback chain uses whatever is configured.

### 1. Install

```bash
git clone <this repo> && cd NavTailor
(cd server && npm install)
(cd client && npm install)
```

### 2. Configure

`server/.env`:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/navtailor
JWT_SECRET=<a long random string, e.g. `openssl rand -hex 32`>
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
CLIENT_ORIGIN=http://localhost:5173
PORT=5000
GEMINI_API_KEY=<optional, but you need at least one of these two>
GROQ_API_KEY=<optional>
# TRUST_PROXY=1   # set ONLY when deployed behind a reverse proxy (Render, Railway, nginx, ...)
```

`client/.env`:

```bash
VITE_GOOGLE_CLIENT_ID=<the same client id>
```

The model ids are in `MODELS` in `server/src/config.js`. An empty id turns that route off.

### 3. Warm the PDF engine (once)

Tectonic downloads packages and fonts on its first compile, which takes over a minute. That's longer
than the API's 30 s compile timeout.

```bash
cd server && npm run warm:pdf
```

### 4. Run

```bash
cd server && npm run dev     # API on :5000 with NODE_ENV=development
cd client && npm run dev     # app on http://localhost:5173 (proxies /api to :5000)
```

### 5. Test

```bash
cd server && npm test        # node:test with an in-memory MongoDB, a fake LLM and real Tectonic where installed
cd client && npm run build
```

### Production notes

- **`NODE_ENV=development` is the only way to get dev behaviour.** That means the `/api/dev` routes
  and a session cookie without `Secure`. Any other value, or none, gets the safe settings, so a
  forgotten `NODE_ENV` fails closed.
- **Set `TRUST_PROXY=1` behind a proxy.** Otherwise every visitor shares the proxy's IP, and the
  per-IP sign-in limit locks everyone out together.
- **Serve the client and the API from the same site** (for example the same domain, with `/api`
  routed to Express). The session cookie is `SameSite=Lax`, so it isn't sent on cross-site requests.

---

## LLM fallback design

Every model call goes through one function, `callLLM()` in `server/src/llm/index.js`. No route
talks to a provider directly.

**Routes and order.** A *route* is a provider adapter plus a model id. Each kind of task has its own
order:

| Task                          | Order                                         | Why                                                                 |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `parse` (resume import)       | Gemini Flash → Groq → Gemini Flash Lite       | long input, structured extraction                                   |
| `analyze` (job description)   | Gemini Flash → Groq → Gemini Flash Lite       | same kind of job as parsing                                         |
| `rewrite` (bullets)           | Groq → Gemini Flash → Gemini Flash Lite       | short, fast and frequent, and it spreads load across two quotas     |

**What happens on each route:**
1. **Hard 20 s timeout per attempt.** It covers both the response headers and reading the body. An
   `AbortController` plus a `Promise.race` make sure we stop waiting even if a provider ignores the abort.
2. **JSON only, checked with zod.** The model's reply is parsed and validated against the task's
   schema. Models never write LaTeX or free text that we use directly.
3. **One repair retry.** If the JSON parses but fails the schema, the same route is asked once more,
   with the validation errors (field paths and messages, never values). JSON that can't be parsed
   is not retried; we move to the next route.
4. **Any failure moves to the next route:** timeout, 429, 5xx, auth error, network error, empty
   reply, bad JSON or schema failure. Routes with no key or no model id are skipped.
5. **When every route fails**, the caller gets a typed `LLMError('all_failed')` with a per-route
   list of causes (route, kind, HTTP status). The API turns that into a 502, and the UI shows a plain message.

**Logging.** Each attempt logs only the route, task, outcome, error kind, status and latency.
Prompts, responses, headers and keys never reach a log line. An `LLMError`'s message is just its kind.

**Cost control.**
- Short-window limits per user (10 tailoring runs and 5 imports per 10 minutes).
- A shared **daily budget of 10 AI runs per user**, covering both tailoring and import. Runs that
  fail don't count.

---

## The no-fabrication guardrail

The core rule: **the LLM may only select and rephrase what is already in your profile.** A prompt
only *asks* the model to behave, so the rule is enforced in code, in several layers.

**1. Selection is done in code, not by the model.** Code scores your bullets against the job's
skills and keywords, and code picks what fits on one page. The model only sees the selected bullets
and is asked to rephrase them by id.

**2. Every rewrite is checked** (`server/src/tailor/guardrail.js`, pure functions):

| Check                                                                                                            | Rejected as   |
| ---------------------------------------------------------------------------------------------------------------- | ------------- |
| The id is one of the selected bullets                                                                            | `unknown_id` / `not_selected` |
| Every **number** in the rewrite already appears in the original (`40%`, `3x`, `2,000`, …)                         | `new_number`  |
| Every **company, tool or technology name** is in the original, the item's own skills or your profile's skills     | `new_term`    |
| Not empty, and not much longer than the original                                                                 | `empty` / `too_long` |

The list of names a rewrite must not introduce includes:
- the job's required and preferred skills and its company (the model's strongest temptation),
- every skill and company in your profile (so a name can't hop from one job to another),
- a built-in list of common technologies.

**A rejected rewrite keeps your original bullet.** Skills you lack are listed in the gap report
under "missing" and are **never** added to the resume.

**3. You have the final say.** Every rewrite that passed can be accepted or rejected. A rejected
one can't be switched on, by the UI or by a hand-written API request. The server checks again.

**4. Saved results are tamper-proof.** `/api/tailor` saves nothing. It returns the result with an
HMAC **save token** tied to your user id, the job description and the exact result, valid for 2 hours.
- When you press Save, the server checks the token.
- It then builds the saved resume and its LaTeX itself, from the verified result and your choices.
- A result edited in the browser (for example, an invented bullet) is refused.

**5. Import is grounded too.** When a resume file is turned into a draft profile, anything the
model returns that isn't actually in the file's text is dropped or flagged. Nothing is saved until
you review the draft.

**6. LaTeX can't be injected.** Resume text reaches the template only through a tagged-template
helper that escapes every value. Links must be http(s). Tectonic runs with `--untrusted`, no shell,
a timeout and a minimal environment.

---

## Known limitations

**Guardrail**
- **It's lexical, not semantic.** It catches new numbers and new names. It can't catch a rewrite
  that inflates a claim with ordinary words, like "helped with" becoming "led". That's what the
  accept/reject review is for.
- **The name check depends on its vocabulary.** A tool that isn't in the job description, your
  profile or the built-in technology list could get through.

**Features**
- **Only Gemini and Groq are implemented.** A Hugging Face route is planned but doesn't exist yet.
- **One template**, one page, A4. The fit loop drops your lowest-scored bullets (up to 3) to reach
  one page and tells you which ones.
- **One version per application in the UI.** The data model supports many resume versions per
  application, but the app only creates the first one, when you save. Re-tailoring an existing
  application isn't built yet.
- **Unsaved results live in the browser's history state.** The save token expires after 2 hours, after which you need to tailor again.
- **Import needs a text layer.** Scanned PDFs (images only) can't be read. Uploads are capped at
  2 MB and only the first 10 PDF pages are read.
- **No account deletion** from the UI yet.

**Operations and security**
- **Rate-limit counts live in memory.** A restart resets them, including the daily AI budget.
  Running more than one server instance would need a shared store.
- **Logout doesn't revoke the session token.** The JWT is stateless and valid for 7 days, so a
  stolen cookie keeps working until it expires.
- **The PDF engine needs care.** Tectonic needs the one-time cache warm-up, has a 30 s compile
  timeout, and runs at most 2 compiles at once. Extra requests get a "busy, try again" answer.
- **The free tiers set the real limits:** LLM quotas and the 512 MB Atlas M0 storage. There's a cap
  of 200 applications per user.
