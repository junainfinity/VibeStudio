# VibeStudio — design handoff

**For: Claude Design.** Everything you need to redesign VibeStudio's interface. The product is built and working; this is a visual/UX design pass, not a rebuild. Screenshots of every screen and state are in `shots/` (referenced throughout).

---

## 1. What VibeStudio is

> **Describe how your business works, in plain words. Walk away with a folder any coding agent can build.**

A non-technical person types a description of a business process — "customers order groceries, a packer packs it, a driver delivers it." An AI turns it into a formal process model. A deterministic validator checks that model against 40 structural rules and, wherever the description was silent, produces **questions only a human can answer**. The person answers them one at a time, confirms a diagram of their process, and downloads a folder containing everything an AI coding agent needs to actually build the software: the diagram, specs, per-step data contracts, a build plan, and troubleshooting notes.

The differentiator: **it never guesses.** Anything missing becomes a question; anything assumed is flagged for review before you commit. And the output is deliberately cut into pieces small enough that even a modest local AI model can build them one at a time.

**Four steps:** Describe → Questions → Confirm → Download.

---

## 2. Who uses it

A small-business owner or operations person who:
- **Cannot read code and never will.** If they see JSON, we've failed.
- Has probably been burned by, or is skeptical of, "AI builds your app" promises.
- Knows their own process *perfectly* but has never drawn a flowchart and doesn't know what a "swimlane" is.
- Is doing this once or twice, not daily. **There is no learning curve budget.** No onboarding, no tooltips they'll never read, no second visit to get good at it.
- Is likely anxious at two moments: when the AI is working (what is it doing? is it wrong?) and at Confirm (am I about to commit to something I don't understand?).

Design for someone who is capable but out of their depth, and who needs to feel in control of a machine doing something opaque.

---

## 3. What we're asking you to do

In priority order:

1. **Make the Confirm screen work.** It's the emotional and functional heart of the product — the moment the user judges whether the AI understood them — and it's currently the weakest screen (see §7.1). The diagram is small, unreadable, and floats in dead space.
2. **Make the waiting screens carry their weight.** With free/slow models these can hold the user for 30s–3min. They're currently near-empty (see §7.2).
3. **Raise the whole thing from "clean" to "designed."** It's tidy and inoffensive; it has no personality, no craft, nothing memorable. It should feel like a confident product, not a form.
4. **Design the states we don't have yet** (see §7.6): first-run/landing, empty states, the moment of arrival on Download, error recovery.
5. **Mobile.** Currently it just narrows; nothing is designed for it (see `16/17/18-mobile-*.png`).

We are **not** asking for: a new information architecture (the 4 steps are validated), new copy voice (see §8), or a brand identity from scratch (see §4).

---

## 4. Brand — locked decisions

These came from the product owner directly. **Do not undo them.**

| Decision | Detail |
|---|---|
| **Logo** | Exactly two glyphs: `>` followed by a blinking `_`. Not three characters, no extra cursor bar, no bracket. The `_` blinks (1.1s, hard steps, no fade). |
| **Logo color** | Matrix dark green `#0b8f3f`. This is *the* brand color. |
| **The site is NOT a terminal** | The logo is the only terminal reference. The product itself is light, warm, and friendly because the audience is non-technical. An earlier dark-terminal version was explicitly rejected. |
| **No third-party watermarks** | We removed an entire diagram library rather than ship its required "bpmn.io" watermark. Nothing in the UI may carry another brand. |
| **No AI-slop aesthetics** | No purple/blue gradients on dark, no glassmorphism, no generic SaaS-template look, no Inter-on-white default. Give it a real point of view. |

Everything else — typography, spacing, layout, illustration, motion, secondary palette — is **yours to redesign.**

---

## 5. Current design system (the starting point, not a constraint)

Pulled from `apps/web/src/index.css`.

```
--bg:            #f7f8f6   page background (warm off-white)
--card:          #ffffff
--border:        #e4e8e2   --border-strong: #cfd6cd
--text:          #1d2620   near-black, green-tinted
--dim:           #67736a   --faint: #98a29a
--green:         #0b8f3f   BRAND — matrix dark green
--green-deep:    #0a6e33   hover
--green-soft:    #e8f5ec   chip/badge fills
--green-glow:    rgba(11,143,63,.16)
--amber-soft:    #fdf6e5   --amber-border: #e8d5a0   --amber-text: #7a5d1b   (the "AI assumed this" box)
--red:           #c8443c   --red-soft: #fdeeed       (errors)
--shadow:        0 1px 2px rgba(29,38,32,.05), 0 8px 28px -12px rgba(29,38,32,.12)
```

- **Type:** system sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`). Body 15.5px/1.55. Questions are `clamp(27px, 4.4vw, 36px)`, weight 680, letter-spacing −0.6px. Mono (`ui-monospace/SF Mono/Menlo`) is used *only* for the logo and file paths. **There is no brand typeface — choosing one is part of the job.**
- **Layout:** one centered column. `720px` max on question screens, `980px` on Confirm/Download. Everything is vertically centered in the viewport (`margin: auto 0`), which is a problem on short-content screens.
- **Motion:** one entry animation (`rise`: 16px up + fade, 0.3s) and one exit (`sink`, 0.16s) on question transitions. A spinner. The blinking logo. That's all.

---

## 6. Screen-by-screen

Reference screenshots are 1280×900 @2x unless noted.

### 6.1 Step 1 — Describe · `01-describe-empty.png`, `02-describe-filled.png`, `03-describe-error-auth.png`

The opening screen. Full-bleed single question.

- **Eyebrow:** "Step 1 — just talk" (green, 13.5px, weight 650)
- **H1:** "What should we build?"
- **Sub:** "Describe the process in your own words, like you'd explain it to a colleague. Who does what, what gets decided, what can go wrong. Don't worry about being complete — anything missing becomes a question, not a guess."
- **Input:** borderless textarea, 6 rows, 2.5px bottom rule that turns green on focus, green caret. Placeholder is a full worked example ("Customers order on our site. We check stock, take payment — retrying once if the card is declined — then pack and ship, and email the tracking number…").
- **Footer:** left hint toggles between "a few more words…" (disabled) and "⌘↵ works too" (enabled). Right: primary "Build it →", disabled until ≥20 chars.
- **Error state** (`03`): a red-tinted band appears above the footer, e.g. *"The app's AI key was rejected. Tell whoever runs this deployment."* The typed description is preserved.

**Notes:** this is the first impression and it's currently doing zero work to establish what the product *is* — a cold user lands here with no idea what they'll get. There is no landing page in front of it.

### 6.2 Working / Building · `04-working-first-stage.png`, `05-working-multi-stage.png`

Shown while the AI drafts and self-corrects. **Duration is highly variable: ~10s on a fast model, up to 2–3 minutes on the free models currently wired up.**

- **H1:** "Building your process…" / "Updating your process…"
- **A white card** listing real progress events as they happen, each with a spinner (current) or green check (done):
  - "Drafting your process"
  - "Checking against 40 rules"
  - "Fixing 3 issues · round 1"
  - "Switching to the backup model"
  - "Working in your answers"
- **Footer:** "Usually under a minute. It writes the process, then checks its own work against 40 rules."

**Important:** every line is a *real* event from the engine. There is no fake progress bar and we don't want one — but the honesty currently comes at the cost of an almost-empty screen (see §7.2).

### 6.3 Step 2 — Questions · `06-questions-first-empty.png`, `07-questions-answered.png`, `08-questions-mid-progress.png`, `09-questions-last.png`

Typeform-style: **one question at a time, full screen.** Typically 5–15 questions.

- **Progress bar:** 4px, full width of the column, green fill.
- **Eyebrow:** "Question 1 of 8 · about a step" — the suffix is a theme label: *about the process / about a step / about a decision / about the data / about a system / checking a guess / one more thing*.
- **H1:** the question itself, verbatim from the validator, e.g. *"What must be true for 'Submit leave request' to be considered done? (e.g. what does success look like, and what should happen on failure?)"* — **these can run 3–4 lines and vary wildly in length.**
- **Input:** 2-row borderless textarea, "Type your answer…", Enter advances, Shift+Enter newlines.
- **Footer:** ↑/↓ nav buttons (↑ only after Q1, ↓ hidden on last), hint "↵ to continue · blank = let it decide, you review later", primary button whose label changes: **Skip ↵** (empty) → **OK ↵** (typed) → **Skip & finish →** / **Done — update it →** (last question).

**The key UX promise:** skipping is safe and legitimate — a skipped question becomes an assumption the AI makes *and flags for review* on the next screen. That promise is currently carried by one line of 13px grey text and is easy to miss.

### 6.4 Step 3 — Confirm · `10-confirm.png`, `11-confirm-assumed-box.png` ← **the most important screen**

Where the user decides if the AI understood them.

- **Eyebrow:** "Step 3 — check the map" · **H1:** "Is this your process?"
- **Sub:** "Rows are people & systems · boxes are steps · diamonds are decisions. Follow the arrows and check the story."
- **The diagram:** a BPMN-style swimlane diagram in a white rounded card, ~46vh. Rows = actors (Customer / Order Service / Payment Provider), rounded boxes = steps, diamonds = decisions (× = either/or, + = both at once), circles = start/end, labelled arrows.
- **Chips:** "7 steps" · "3 people & systems" · "6 kinds of data" (green-soft), plus a neutral "2 minor notes" chip when warnings exist.
- **The amber box** (`11`) — appears when the AI assumed anything: **"The AI decided these on its own — glance over them:"** then a bullet list, e.g. *Who: "Payment Provider"* / *"A cart has a single currency; multi-currency carts are out of scope."*
- **Actions:** secondary "Something's off — tell it what" (left), primary "Looks right — make my folder →" (right).

### 6.5 Correction · `12-feedback-empty.png`, `13-feedback-filled.png`

Reached from "Something's off". Same typeform treatment.

- **Eyebrow:** "One thing to tell it" · **H1:** "What should be different?"
- **Sub:** 'Plain words are fine — "the refund check should come before shipping", "there's also a warehouse team involved".'
- **Actions:** "← Back to the diagram" / "Fix it ↵". The correction goes back through the AI and returns to Confirm.

### 6.6 Step 4 — Download · `14-download.png`, `15-download-files-open.png`

The payoff screen.

- **Eyebrow:** "Step 4 — done" · **H1:** "Your build folder is ready"
- **Sub:** "30 files, ~174 KB. Everything an AI builder needs to make this real — cut into pieces small enough that even a modest local model (a ~27B model with a 32k window) can build it one piece at a time."
- **Two buttons:** primary "↓ Download checkout.zip", secondary "Copy the builder instructions"
- **"What to do with it"** card — 4 numbered steps: unzip and open README.html · open your AI coding tool in that folder · paste the builder instructions · it builds step by step, you review.
- **Collapsible "What's inside (30 files)"** (`15`) — a table of every file with a plain-language description and an audience tag: *for you* / *for your AI builder* / *for diagram tools*, each with a download button. Contents include `README.html`, `process.ir.json`, `process.bpmn`, `diagram.svg`, `speckit/` (constitution, spec, plan, ~18 per-flow contracts), `plan/graph-plan.{json,md}`, `notes/troubleshooting.md`, `notes/codebase.md`.

**Notes:** this is the moment of delivery and it currently feels like a file listing, not an achievement. There's no sense of "you just did something significant."

### 6.7 Progress rail (persistent, top right)

`01 describe · 02 questions · 03 confirm · 04 download`. Current step = white pill + shadow + green ring on the number; completed = solid green circle with a check; future = grey. Not clickable — navigation is via each screen's own buttons. On mobile the labels vanish, leaving numbered dots.

### 6.8 Mobile · `16-mobile-describe.png`, `17-mobile-questions.png`, `18-mobile-confirm.png`

390×844. Everything reflows to a single narrow column; the rail collapses to dots. **This is fallback behavior, not design** — the diagram in particular is unusable at this width.

---

## 7. Known problems and opportunities

### 7.1 Confirm: the diagram is failing its job ⚠️ highest priority
Look at `10-confirm.png` and `11-confirm-assumed-box.png`. The diagram is rendered to fit *width* inside a fixed-height card, so a wide process shrinks until the step labels are ~6px and unreadable — while huge empty margins sit above and below it. We tell the user to "follow the arrows and check the story" and then make that physically impossible. Needs: zoom/pan or a full-screen view, a better container strategy, and possibly a non-diagram fallback for verification (a readable step-by-step narrative the user can check instead of, or alongside, the picture). **Consider: does a diagram even best serve someone who has never read one? Would a plain-language "here's the story we heard" list be a better primary, with the diagram secondary?**

### 7.2 Waiting screens are nearly empty
`04`/`05`: one line of text in a big white card, floating in a centered void, for up to 3 minutes. Nothing reassures, explains, or entertains. Opportunity: show what's being built as it emerges, explain what the 40 rules are doing, or give the user something to read/prepare. Must stay honest — no fake progress.

### 7.3 The "skip is safe" promise is buried
The single most anxiety-reducing fact in the product ("blank = let it decide, you review later") is 13px grey text in a footer. It deserves real design.

### 7.4 The amber "AI decided these" box is under-designed
This is our credibility moment — the product's whole claim is *it doesn't guess silently*. Currently a plain tinted box. It should feel like a considered, trustworthy disclosure.

### 7.5 Vertical centering wastes space inconsistently
`margin: auto 0` centers everything, so short screens have enormous voids (see `05`) and tall ones are cramped. Needs a real vertical rhythm system.

### 7.6 Screens that don't exist yet and should
- **A landing / first-run screen.** Someone arriving cold has no idea what this is. Right now they get a bare question.
- **A real arrival moment on Download.** Something happened; nothing celebrates it.
- **Resume / return.** No sense of "come back to this later" — a session is currently ephemeral.
- **Error recovery beyond a red band** — particularly for "the AI couldn't produce a sound process after several tries," which is a dead end today.

### 7.7 Small things
- Long questions (4+ lines) push the input toward the fold at 900px height.
- The mid-question ↑/↓ buttons are unlabeled icon buttons of ambiguous purpose.
- The Download file table (`15`) is dense and mono-heavy for a non-technical reader.
- No favicon, no page-title states, no loading favicon.
- The 2-button footers put secondary/primary at extreme opposite ends of a 980px row — a long mouse trip and weak visual pairing.

---

## 8. Voice and content rules

- **No jargon in the main path.** The user never sees "IR", "BPMN", "schema", "validator", "gateway", or JSON. Internally they exist; in the UI they're "the map", "steps", "checks".
- **Errors are human sentences**, never codes: *"The AI model hit its rate limit. Wait a moment and try again."* / *"The AI's reply wasn't a valid document."* / *"Couldn't reach the AI. Check your internet connection and try again."*
- **Second person, plain verbs, no exclamation marks.** Current voice is calm and direct: "Is this your process?", "Something's off — tell it what", "Looks right — make my folder".
- Keep the em-dash-and-lowercase eyebrow style ("Step 3 — check the map") or replace it deliberately — don't leave it inconsistent.

---

## 9. Technical constraints you must design within

- **Pure client-side React + CSS.** No backend, no CMS. Anything you design must be buildable in plain CSS/SVG/React. No heavy runtime dependencies (we removed a whole library to avoid a watermark).
- **The diagram is generated SVG**, drawn by our own renderer from computed geometry (`apps/web/src/lib/diagramSvg.ts` over `computeLayout`). You can restyle *everything* about it — shapes, colors, type, spacing, lane treatment — but the same geometry must also produce a standalone `diagram.svg` in the downloaded folder, and it must stay recognizably BPMN-ish so the exported `.bpmn` matches what was on screen. Diagram size is unbounded: 6 steps or 40, 2 lanes or 8.
- **Content is fully dynamic and unbounded.** Question text, step names, and assumption statements come from an AI and vary in length. Design for the long case: a 4-line question, a 12-item assumption list, a 40-step diagram, a 60-file table.
- **Question count varies 3–20.** The progress bar must handle both.
- **Model latency is unpredictable** (10s–3min) and failures are routine — rate limits and malformed replies are the *normal* path, absorbed by retries. Waiting and error states are first-class screens, not edge cases.
- Target: desktop-first (1280+), must work at 390px.

---

## 10. Out of scope

- The 4-step flow itself (validated, don't restructure).
- Anything inside the downloaded folder (`README.html` cover page has its own light print-ish styling — separate job, ask if you want it).
- The marketing site (doesn't exist yet).
- Auth, accounts, pricing, dashboards — none exist.

---

## Appendix — screenshot index

| File | Screen / state |
|---|---|
| `01-describe-empty.png` | Step 1, empty, button disabled |
| `02-describe-filled.png` | Step 1, filled, button enabled |
| `03-describe-error-auth.png` | Step 1 with an error band |
| `04-working-first-stage.png` | Working, first stage |
| `05-working-multi-stage.png` | Working, update round |
| `06-questions-first-empty.png` | Q1, empty, "Skip ↵" |
| `07-questions-answered.png` | Q1, answered, "OK ↵" |
| `08-questions-mid-progress.png` | Mid-run, progress bar advanced, ↑↓ visible |
| `09-questions-last.png` | Final question, "Skip & finish →" |
| `10-confirm.png` | Confirm, no assumptions |
| `11-confirm-assumed-box.png` | Confirm **with** the amber assumptions box (full page) |
| `12-feedback-empty.png` | Correction screen, empty |
| `13-feedback-filled.png` | Correction screen, filled |
| `14-download.png` | Download screen |
| `15-download-files-open.png` | Download with file table expanded (full page) |
| `16-mobile-describe.png` | Mobile 390×844, step 1 |
| `17-mobile-questions.png` | Mobile, question |
| `18-mobile-confirm.png` | Mobile, confirm (full page) |

Live app: `npm run dev` from the repo root → `http://localhost:5173` (needs an `OPENROUTER_API_KEY` in `apps/web/.env.local`).
