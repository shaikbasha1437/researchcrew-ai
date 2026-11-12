# ResearchCrew AI

**A multi-agent research team that runs in your browser:** a planner, parallel researchers, a writer and a critic that
checks every claim. Every `[n]` citation is verified against the exact quote in its source.

**Live app:** https://shaikbasha1437.github.io/researchcrew-ai/ · free demo, no key, no sign-up.

## What it does

1. **Planner** splits your question (plus audience, length and depth) into sub-questions and a report outline.
   You approve or edit the plan first, or turn on auto-run.
2. **Researchers** run in parallel, one per sub-question. They search the sources and return evidence notes: exact
   quotes with source IDs. If nothing covers a sub-question they say **"not enough evidence"** instead of guessing.
3. **Writer** drafts a Markdown report with inline `[n]` citations tied to those quotes.
4. **Critic** scores the draft on a rubric (support, citations, coverage, balance, source quality, length) and sends
   revision requests. The writer revises until the critic passes it, for at most 3 rounds (you can pick 1-3).

You watch it happen: an agent graph with each agent's status, the researcher lanes, tokens, estimated cost and time
per agent, and a timeline of every message passed between agents. You can **pause, step, stop and resume**, and edit
any intermediate artifact (the plan, a sub-question's notes, the draft, the critic's revision requests) before resuming.

### Checks that always run (both modes)

- **Citation checker:** every `[n]` must map to a note whose quote appears word for word in the source; every number
  in a sentence must appear in a cited quote; claim-like sentences with no citation are highlighted as unsupported.
- **Conflicts:** notes from different sources that report different numbers for the same thing are shown side by side,
  and the critic rejects a draft that only presents one side.
- **Source quality:** outdated sources (3+ years older than the newest evidence) and low-quality ones (blogs, forums,
  newsletters) must be replaced or labelled.
- **Coverage:** every sub-question needs a section, including explicit "not enough evidence" sections.
- **Prompt injection:** source text is fenced as untrusted data (`<untrusted_source>`), fence-breaking tags are
  neutralised, instruction-like sentences are flagged and never used as evidence, and every prompt is checked for your
  keys before it is sent.

### Exports

Markdown report, standalone HTML, JSON of the full run (plan, notes, drafts, critiques, messages, and the cited
sources' text so citations can be re-checked), bibliography (Markdown and BibTeX), and a share link that carries the
**question and settings only**. Runs are saved in your browser's history with a word-level diff between drafts.

## Modes

| | Demo team (default) | Your AI |
|---|---|---|
| Key | none | your own: OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible server (OpenRouter, Ollama, LM Studio, vLLM); optional in-browser WebLLM |
| Agents | deterministic code (see below) | your model; pick a model per agent, e.g. a cheap one for researchers and a stronger one for the writer and critic |
| Sources | bundled fictional library | your URLs, pasted text, PDF / Markdown / text / HTML files, optional Tavily web search with your key, optionally the demo library |

Keys stay in this browser (localStorage, or memory only if you untick "remember") and go only to the provider you pick.
They never appear in prompts, exports, history or share links. Anthropic is called with the
`anthropic-dangerous-direct-browser-access` header.

**Fetching URLs:** most sites block cross-origin reads (CORS), so the app tries a direct read, then your optional
local fetch helper, then Tavily Extract (with your key), and otherwise asks you to paste the text.

## The demo library (fictional)

22 invented sources on three invented topics. Every person, place, company, number and `.example` URL is made up.

- **Larkspur e-bike share** (a city program): the department's ridership figure (+41%) is contradicted by the city
  auditor (+22%), a 2021 feasibility study is outdated, a personal blog makes sweeping claims, and a forum post contains
  a planted instruction aimed at AI agents.
- **Quillfern 4-day week pilot** (a software company): the company's +8% productivity claim is disputed by an
  independent evaluation, a 2020 survey is outdated, and a newsletter is low quality with a hidden `[system: ...]` instruction.
- **Halden NaFe-S battery** (a battery chemistry): the press release (210 Wh/kg, 4,000 cycles, plus a planted
  instruction) conflicts with peer-reviewed tests (185 Wh/kg, 2,500 cycles); a 2023 preprint is outdated; a hype blog is low quality.

Each topic has one sub-question that no source covers, so the team has to abstain.

## Honest notes

- **The demo team is not an AI.** The planner matches your question to a topic shelf; researchers use BM25 search over
  sentences; the writer is extractive (it quotes the evidence) and its **first draft is deliberately naive** (one top
  note per section, a summary that cites only its first figure, no gap sections), so the rule-based critic has real
  problems to catch. The revision is driven by the critic's requests: drop a request and the writer won't act on it.
  Demo token counts are estimates (characters / 4) and cost is $0.
- **Your AI mode was tested with mocked provider replies**, not real keys. With fake keys, each provider returns a
  readable error from the browser. Real models will phrase things differently; the rule-based checks run on whatever
  they write, and quotes they return are kept only if they appear verbatim in the source.
- The in-browser WebLLM option is experimental and untested here (it needs WebGPU and a 1-2 GB download).
- Your browser may ask to allow this site to reach your local network when you use Ollama, LM Studio or the fetch helper.

## Optional fetch helper (`server/`)

A tiny Node server (no dependencies) that fetches pages for the app: localhost only, token required, host allowlist,
refuses private addresses (re-checked on redirects), text only, 2 MB / 15 s caps. See [server/README.md](server/README.md).

## Develop

No build step. Serve the folder with any static server (`python3 -m http.server`) and open it.

```sh
npm test   # Node tests: text/BM25, guard, citation checker and critic, demo topics, engine controls,
           # live-mode agents with a mocked model, providers with mocked fetch, exports, sources, fetch helper
```

The app is a PWA with a network-first service worker, so it works offline after the first visit (the demo too).

## License

MIT
