# Verification

What was checked, how, and what was not. Live site: https://shaikbasha1437.github.io/researchcrew-ai/

## 1. Node tests (`npm test`): 63 tests, all passing

| File | Covers |
|---|---|
| `text.test.js` | sentence splitter (decimals, abbreviations, a.m./p.m.), tokens and stemming, number + unit extraction, BM25 ranking |
| `guard.test.js` | injection patterns flag exactly the 3 planted sources (A7, B5, C1) and no others; fence neutralises `</untrusted_source>` break-outs; key redaction; prompts containing a key are blocked |
| `critic.test.js` | verified / broken / quote-missing / mismatched / unsupported citations; conflicts; outdated and low-quality sources; missing sections; bias; length; pass rule |
| `demo.test.js` | every topic: round 1 fails with a mismatch, a missing section and a hidden conflict; the revision passes; every final citation verifies; the injection is never used; the uncovered sub-question abstains; an off-library question abstains everywhere |
| `engine.test.js` | approval gate, edited plan, pause / step / stop / resume, edits reset what depends on them, approve while paused or stopped, resume right after stop, bounded rounds, hand-edited draft gets flagged and fixed |
| `llm-agents.test.js` | Your-AI agents with a scripted mock model: full run; a fabricated quote is dropped; the planted instruction never becomes a note; model + rule critiques merge; rounds bounded; no prompt contains the key; sources are fenced; a key pasted into a source blocks the call; per-agent models routed to the provider request |
| `providers.test.js` | OpenAI, Anthropic (with `anthropic-dangerous-direct-browser-access`), Gemini, OpenAI-compatible request shapes with mocked `fetch`; readable errors for 401/404/429/CORS |
| `export.test.js` | Markdown / HTML (escaped, no scripts) / JSON (keys redacted) / bibliography / BibTeX; share link holds question + settings only; draft diff |
| `sources.test.js` | HTML to text keeps hidden comments for the guard; size cap; URL fetch falls back direct → helper → Tavily Extract → readable "paste the text" error |
| `server.test.js` | fetch helper: token required, host allowlist, private / loopback addresses refused (also after redirects), CORS only for allowed origins, size cap |

## 2. Browser checks on the live site (Playwright; scripts kept outside the repo)

Run in **Chrome (Google Chrome stable)** and **Firefox (Playwright build)**: 150 checks per browser.

- **Fresh visit:** title, 4 agent nodes, welcome toast, demo pills, 4 sample questions, service worker active.
- **Repeat visit:** page controlled by the service worker, theme persists, no second welcome, per-file versioned cache populated.
- **Each topic, full demo run at normal speed** (e-bike, 4-day week, battery):
  - the plan (5 sub-questions) is shown for approval
  - at least 2 researcher lanes run at once
  - round 1 NEEDS WORK with a mismatch, a missing section and a conflict; round 2 PASS with no major issues
  - all citations verified in the UI
  - conflicts shown side by side; abstention shown
  - the injection is listed and kept out of the notes and the report
  - clicking [1] opens the source with the quote highlighted
  - MD / HTML / JSON / bibliography / BibTeX downloads validated
  - the drafts diff shows insertions and deletions
- **Off-library question:** auto-run skips the gate and every researcher abstains, so the report has no citations.
- **Plan editing:** removing a sub-question and rewording another reshapes the run.
  - Emptying every sub-question shows an error, and Cancel still closes after the discard prompt.
- **Controls:** Step and Resume stay disabled at the gate. Pause at the gate, then Approve & research, and the run continues.
  - Pause stops after a step; Step advances exactly one step.
  - Edit the critic's requests and undo the edit; Stop mid-run; Resume to done.
- **Artifact edits:** the critic flags an uncited claim added by hand to a draft, and the writer removes it.
  - The notes editor refuses a quote that is not in the source.
  - Draft, notes and request edits each undo.
- **History:** delete + undo, clear-all + undo, reopen a past run, survives a reload (IndexedDB).
- **Modals:** 10 modals each close by X, Cancel, Esc, backdrop click and browser Back.
  - The settings, sources, plan and draft modals ask before discarding unsaved edits on Esc, Back and backdrop.
  - No stray history entries are left behind.
- **Sources:**
  - Pasted text works, with the injection inside it flagged.
  - A Markdown file upload works.
  - A PDF upload (pdf.js) works, tested in Chrome, which generated the PDF.
  - A CORS-blocked URL gives a readable "paste the text" error.
  - Remove + undo works.
- **Fetch helper:** the live page read `https://example.com/` through the real helper running on 127.0.0.1.
  - A host that is off the allowlist was refused with a readable error.
  - A non-localhost helper URL is rejected in Settings.
- **Your AI with a mocked OpenAI endpoint** (request interception, no real key):
  - the run completes
  - the fake key appears only in the `Authorization` header, never in a request body or prompt
  - researcher prompts fence the sources and the planted instruction sits inside a fence
  - per-agent models are routed (nano / mini / full / 5.1)
  - rounds stay bounded
  - the fabricated quote is dropped
  - citations verify
  - exports, share link and history contain no key
  - a key pasted into a source blocks the run
- **Each provider with a fake key, real network:** OpenAI, Anthropic, Gemini and OpenRouter (OpenAI-compatible) each show a readable error in the page.
  - Forget keys + undo works, and storage is clean afterwards.
- **Offline:** a reload works from the cache, and a full demo run still works.
- **Mobile (390×844):** no horizontal overflow on load, in any of the 6 tabs after a run, or in the 5 main modals.
- **Console:** no unexpected errors.

## 3. Bugs found and fixed during verification

- Clicking **Approve & research** while paused (or on a stopped run) left the run paused. Approving now continues.
- **Resume / Step right after Stop** could hit the still-unwinding loop and do nothing. They now restart once it has unwound.
- A hand-edited draft arriving after the round budget was spent was critiqued but never revised.
  - A hand edit now starts a fresh budget, still capped at 3 rounds.
- Uncited claims such as "became twice as happy" were not flagged. The claim-word list was extended.
- Conflict messages showed units in lowercase without separators ("2500 cycle", "210 wh/kg"). They now read "2,500 cycles" and "210 Wh/kg".
- The sample-question chips had no styles and overflowed the page in Firefox on mobile.
- Earlier in development:
  - the sentence splitter broke on decimals and "Dr."
  - the stemmer produced "crashe"
  - negative numbers were not parsed
  - the A1/A2 conflict was missed
  - an outdated source was re-added as a "conflict"
  - researchers bled sentences across facets
  - a fetch-helper test mock was wrong

## 4. Simulated or untested (honest notes)

- **The demo team is deterministic code, not AI**: topic matching, BM25, an extractive writer whose first draft is
  naive on purpose, and a rule-based critic. Demo tokens are estimates (characters / 4); cost is $0.
- **No real model was called with a real key.** Live mode was verified with mocked replies (Node and browser) and
  with fake keys that return provider errors. Real model output will vary; the rule checks still apply.
- **Not exercised end to end in the browser:** Tavily web search and Tavily Extract (unit-tested with mocked fetch only), Anthropic / Gemini /
  compatible **successful** replies (request shapes are unit-tested), Ollama / LM Studio on localhost, and WebLLM
  (needs WebGPU and a large download).
- PDF upload was checked in Chrome; the Firefox run reuses the same PDF file.
- The fictional library, its people, numbers and `.example` URLs are invented.
