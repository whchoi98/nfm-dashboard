# Phase 5 — Chatbot Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Rework the nfm-dashboard chatbot to adopt the cleaner streaming/rendering/UX of `ontology-for-gcc` (single Markdown renderer + global `.chat-markdown` CSS, tidy SSE client, guided empty-state + follow-up chips, phase/tool transparency, consistent bubbles) AND fix the shared weaknesses (syntax highlighting + copy button, Stop button, multiline input, incremental render, smart autoscroll, a11y, error-retry), plus simplify the popup logic — all theme-aware (light/dark, NOT force-dark) with SnowUI tokens and t() ko/en.

**Architecture:** Keep the existing server SSE wire format (`event: X\ndata: {json}\n\n`) and the SigV4 AgentCore gateway path (`mcp-client.ts`) UNCHANGED — only align the event vocabulary (add a `followups` event) and enrich the client. The rework is concentrated in the renderer (`Markdown.tsx` + `globals.css`), the SSE client (`use-sse.ts`), the two SSE routes (`/api/ai`, `/api/diagnose`), the chat UI (`ChatPanel`, `FloatingChat`), and `ua.ts`.

**Tech Stack:** Next 16 App Router, React 19, react-markdown ^10 + remark-gfm ^4 (already present), **rehype-highlight ^7** (NEW — spec §17.2), lucide-react, Tailwind v4 tokens, vitest + @testing-library/react, Bedrock ConverseStream, AgentCore Gateway (SigV4 MCP).

## Global Constraints

- All visible strings via `t()` with BOTH ko + en keys (flat JSON `app/src/lib/i18n/translations/{ko,en}.json`). New keys under `chat.*`.
- SnowUI tokens only — no hardcoded hex. **Theme-aware light/dark** (do NOT copy ontology-for-gcc's force-dark slate CSS; rewrite `.chat-markdown` + highlight theme with tokens + `dark:` variants).
- Do NOT modify `app/src/lib/mcp-client.ts` (SigV4 gateway) or `app/src/lib/bedrock.ts`'s model fallback. Model stays `global.anthropic.claude-sonnet-5` (fallback sonnet-4-5). Keep the tool-less fallback (`status:fallback`) and the 15s keepalive (do NOT remove — protects the followups no-event gap).
- Keep the server SSE wire format (`event:`+`data:`); only ADD the `followups` event to the vocabulary. Existing `use-sse` frame parsing + `diagnose` consumer must keep working.
- rehype-highlight theme CSS must be INLINE in globals.css (no external CDN — CSP blocks it), two variants (light/dark), token-based.
- App-only phase. Conventional commits. TDD for pure logic (followups parser, use-sse framing, ua); render-smoke + headless for UI. Redeploy at the end of the phase (chatbot is user-facing; deploy after review — subject to user authorization).

## Existing interfaces (consume / preserve)

```ts
// SSE server helper app/src/lib/sse.ts: sseEvent(event, data), keepalive, simulateStreaming
// app/src/app/api/ai/route.ts: SSM gateway-url → mcp listTools → ConverseStream loop (≤8 turns, tool_use dispatch)
//   emits: status{stage:'connecting'|'fallback'|'tool:<name>'|'keepalive'} , chunk{delta}, done{content,usedTools,elapsedMs,model}, error{message}
// app/src/app/api/diagnose/route.ts: same SSE vocabulary, second surface
// app/src/lib/mcp-client.ts: SigV4 MCP JSON-RPC (DO NOT TOUCH). app/src/lib/bedrock.ts: ConverseStream + model fallback.
// app/src/lib/use-sse.ts: sendSse(url, body, {onStatus,onChunk,onDone,onError}) → { done:Promise, abort() }  (abort implemented, UI not wired)
// app/src/components/Markdown.tsx: react-markdown+gfm w/ 15 inline component overrides, memo'd (NO highlight/copy)
// app/src/components/chat/ChatPanel.tsx (200), FloatingChat.tsx (135): current chat UI (single <input>, no stop/suggested/followups, always-autoscroll, italic inline error)
// app/src/lib/ua.ts: chatOpenMode(ua) → 'mobile-sheet'|'popup'|'iframe-modal' (3-way + 500ms recheck — to simplify)
// app/src/app/chat-popup/page.tsx: standalone ChatPanel route (keep). sessionStorage 'nfm-chat' history sync across iframe/parent.
// middleware.ts: Cognito cookie + X-Origin-Verify on /api/ai,/api/diagnose (401 as JSON → stream never starts)
// AppShell.tsx mounts FloatingChat. i18n chat.* keys (8) exist.
```

## Shared interfaces (produce here)

```ts
// use-sse.ts additions (keep sendSse):
export interface SseDone { content: string; usedTools?: string[]; elapsedMs?: number; model?: string; followups?: string[]; }
export function sendSse(url, body, handlers: { onStatus?; onChunk?; onDone?(d: SseDone); onError?; onFollowups?(q: string[]) }): { done: Promise<void>; abort(): void };
// optional: export async function* streamSSE<T>(url, body): AsyncGenerator<{type,data}>  (async-generator form)
// app/src/lib/followups.ts (server):
export async function generateFollowups(answer: string, lastUser: string, lang: 'ko'|'en'): Promise<string[]>; // ≤3, [] on failure
export function parseFollowups(text: string): string[]; // pure: split lines, strip bullets, 5..120 chars, cap 3
// app/src/components/CodeBlock.tsx: copy-button wrapper for <pre>
```

## Task sequence

| # | Task | Deliverable |
|---|---|---|
| 1 | Markdown renderer unify + syntax highlight + copy button | Markdown.tsx, globals.css .chat-markdown, CodeBlock.tsx |
| 2 | SSE client dual-form + followups handler | use-sse.ts (+test) |
| 3 | Backend followups event + generateFollowups | /api/ai, /api/diagnose, followups.ts (+test) |
| 4 | ChatPanel rewrite (suggested, followups, stop, textarea, smart scroll, retry, usedTools, a11y) | ChatPanel.tsx, ChatMessages.tsx, i18n |
| 5 | FloatingChat + popup simplification | FloatingChat.tsx, ua.ts (+test) |
| 6 | Regression + headless smoke + deploy | full suite, prod smoke |

---

## Task 1: Markdown renderer unify + syntax highlighting + copy button

**Files:** Modify `app/src/components/Markdown.tsx`, `app/src/app/globals.css`; Create `app/src/components/CodeBlock.tsx`, `app/src/components/Markdown.test.tsx`. Add dep `rehype-highlight`.

**Interfaces:** `Markdown({ children }: { children: string })` stays the public API (used by ChatPanel + diagnose). CodeBlock: `function CodeBlock({ className, children })` — renders a `<pre><code>` with a copy button (top-right) using `navigator.clipboard.writeText`, showing `t('chat.copy')`→`t('chat.copied')` for ~1.5s.

- [ ] **Step 1:** `npm i -w app rehype-highlight` (^7). Verify it resolves against react-markdown v10 (rehype pipeline).
- [ ] **Step 2:** Rewrite `Markdown.tsx`: keep `react-markdown` + `remarkPlugins:[remarkGfm]` + add `rehypePlugins:[rehypeHighlight]`. REMOVE the 15 inline component overrides EXCEPT a `pre` override that wraps code in `<CodeBlock>`. Add `className="chat-markdown"` on the wrapper. Keep memo. (Styling moves to globals.css.)
- [ ] **Step 3:** In `globals.css` add a `.chat-markdown` block porting ontology-for-gcc's element styles (h1-h6, p, ul/ol, code, pre, blockquote, table, hr, a) but using SnowUI tokens + `dark:`/`prefers-color-scheme` variants (NOT slate hardcode). Add a highlight.js token theme (two variants) INLINE — map hljs classes (.hljs-keyword/.hljs-string/.hljs-comment/.hljs-number/.hljs-title etc.) to token colors for light + dark. No external CSS.
- [ ] **Step 4:** CodeBlock.tsx: copy button (lucide Copy/Check), token-styled, accessible name, clipboard write, transient "copied" state via t().
- [ ] **Step 5:** Test `Markdown.test.tsx`: renders headings/lists/tables/inline-code; a fenced ```json block gets an `.hljs` highlighted `<code>` + a copy button present; clicking copy calls clipboard (mock) and toggles label. Render in LanguageProvider.
- [ ] **Step 6:** Verify diagnose page still renders (import unchanged). `npx -w app vitest run Markdown` PASS; `npx -w app tsc --noEmit`; `npm -w app run build`.
- [ ] **Step 7:** Commit `feat(app): unified chat markdown renderer with syntax highlighting + copy button`.

---

## Task 2: SSE client dual-form + followups handler

**Files:** Modify `app/src/lib/use-sse.ts`; Modify/extend `app/src/lib/use-sse.test.ts`.

**Interfaces:** Extend `SseDone` with `followups?: string[]`. Add `onFollowups?(questions: string[])` to the handlers. Keep `sendSse(...) → { done, abort() }`. (Optional `streamSSE` async-generator — add only if it stays small.) Parse a new SSE frame `event: followups\ndata: {"questions": [...]}` → call `onFollowups`. 401 (JSON, non-stream) → `onError` with a clear localized reason. Ensure `abort()` prevents further handler calls.

- [ ] **Step 1:** Failing test: feed a split/chunked SSE byte stream containing `status`, two `chunk`s, a `followups` event, and `done`; assert handlers fire in order and followups parsed. Assert abort mid-stream stops handler calls. Assert a non-OK JSON response routes to onError.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (add followups frame handling + onFollowups + SseDone.followups; keep existing frame parser). **Step 4:** Run → PASS. `tsc` + build.
- [ ] **Step 5:** Commit `feat(app): sse client followups event + hardened abort/401 handling`.

---

## Task 3: Backend followups event + generateFollowups

**Files:** Create `app/src/lib/followups.ts`, `app/src/lib/followups.test.ts`; Modify `app/src/app/api/ai/route.ts`, `app/src/app/api/diagnose/route.ts`.

**Interfaces:** `parseFollowups(text): string[]` (pure — split lines, strip `-`/`*`/`1.` bullets, keep 5..120 char lines, cap 3). `generateFollowups(answer, lastUser, lang): Promise<string[]>` — a NON-streaming `ConverseCommand` (reuse bedrock client; temperature 0.7, max ~300 tokens) with a system prompt "Return EXACTLY 3 short follow-up questions, one per line, no numbering" in the given lang, seeded with answer (≤1200 chars) + lastUser (≤300 chars). On any error → `[]` (graceful). NFM-ops domain framing.

Route change: after the ConverseStream loop finishes and BEFORE emitting `done`, call generateFollowups(finalContent, lastUserMessage, lang) and emit `sseEvent('followups', { questions })` (skip if empty). Keep keepalive running through this second call. `done` payload unchanged. Apply to BOTH `/api/ai` and `/api/diagnose` (diagnose gets diagnosis-oriented follow-ups). Derive `lang` from request (body or Accept-Language; default 'ko').

- [ ] **Step 1:** Failing test `followups.test.ts` for `parseFollowups`: bullets stripped, numbering stripped, blank/oversized lines dropped, capped at 3, empty input → []. (generateFollowups is I/O — cover only the parser + a mocked-bedrock happy path if easy.)
- [ ] **Step 2:** FAIL → **Step 3:** implement followups.ts + wire both routes → **Step 4:** PASS. Live-verify: `AUTH_DISABLED=1 npm -w app run dev -- -p 3050`, POST a chat message to `/api/ai` and confirm a `followups` event arrives before `done` (curl the SSE or a tiny node reader). tsc + build.
- [ ] **Step 5:** Commit `feat(app): backend follow-up question generation (sse followups event)`.

---

## Task 4: ChatPanel rewrite (core UX)

**Files:** Rewrite `app/src/components/chat/ChatPanel.tsx`; Create `app/src/components/chat/ChatMessages.tsx`; add i18n keys.

**Behavior (all via t(), tokens, theme-aware, a11y):**
1. **Guided empty state:** 5 NFM-ops suggested prompts (`chat.suggested.1..5`, e.g. top retransmission pods, top inter-AZ cost, unhealthy monitors, DNS failures, slowest paths) shown when history empty; click → sends.
2. **Follow-up chips:** consume the `followups` event → rounded-full chips under the last answer; click → sends.
3. **Stop button:** while streaming, Send toggles to a Stop (lucide Square); click → `abort()` + KEEP the partial answer (persist to sessionStorage). Handler must run the finish path itself (abort suppresses onDone).
4. **Multiline input:** `<input>` → auto-growing `<textarea>` (rows 1–5), Enter sends, Shift+Enter newline.
5. **Smart autoscroll:** stick to bottom only when already near bottom (`scrollTop+clientHeight >= scrollHeight-40`); otherwise show a "맨 아래로 / Jump to latest" pill.
6. **Error + retry:** on error show the reason + a Retry button that re-sends the last user message.
7. **usedTools transparency:** collapsible footer under an answer listing `usedTools` (from `done`) + the last `status.stage` phases; a `<details>`/toggle, not a badge that disappears.
8. **a11y:** message list `aria-live="polite"`; input labelled; buttons named.
9. **Incremental render:** stream into a live bubble; keep `<Markdown>` memo so completed content isn't re-parsed every chunk (split settled vs in-flight, or memo the settled prefix). Extract the list into `ChatMessages.tsx`.
Preserve the sessionStorage `nfm-chat` history + iframe/parent sync.

- [ ] **Step 1:** Implement ChatPanel + ChatMessages + i18n (`chat.stop`,`chat.retry`,`chat.followups`,`chat.usedTools`,`chat.scrollToBottom`,`chat.suggested.1..5`,`chat.copy`,`chat.copied` — reuse Task-1 copy keys; ko+en).
- [ ] **Step 2:** Component tests (`ChatPanel.test.tsx`): empty state shows 5 suggestions; clicking a suggestion triggers send; a mocked stream produces a streaming bubble then followup chips; Stop calls abort and keeps partial text; retry re-sends. Use a mocked sendSse.
- [ ] **Step 3:** `npx -w app vitest run ChatPanel Markdown use-sse` green; tsc; build.
- [ ] **Step 4:** Commit `feat(app): chat panel rework (suggested/follow-up chips, stop, textarea, smart scroll, retry, tool trace)`.

---

## Task 5: FloatingChat + popup simplification

**Files:** Modify `app/src/components/chat/FloatingChat.tsx`, `app/src/lib/ua.ts`; Modify `app/src/lib/ua.test.ts`.

**Behavior:** Desktop default = a right-side slide-over drawer (SnowUI tokens, ESC to close, focus trap); mobile = full-screen sheet (keep). A "새 창으로 / Open in new window" button: Firefox → `window.open('/chat-popup')`; others → iframe modal. Simplify `ua.ts`: drop the 500ms popup-recheck heuristic; `chatOpenMode(ua)` returns `'mobile-sheet' | 'desktop-popup' | 'desktop-iframe'`. Keep `/chat-popup` + sessionStorage history sync.

- [ ] **Step 1:** Update `ua.test.ts` for the simplified 3-value output (mobile UA → sheet; Firefox desktop → popup; other desktop → iframe). FAIL.
- [ ] **Step 2:** Simplify `ua.ts` → PASS. Rewrite FloatingChat drawer + open-in-window button + focus/ESC. Render-smoke test if practical.
- [ ] **Step 3:** `npx -w app vitest run ua FloatingChat` green; tsc; build.
- [ ] **Step 4:** Commit `feat(app): floating chat drawer + simplified open-mode logic`.

---

## Task 6: Regression + headless smoke + deploy

**Files:** none (verification + deploy).

- [ ] **Step 1:** Full suite `npx -w app vitest run` green; `tsc --noEmit` clean; `npm -w app run build` succeeds.
- [ ] **Step 2:** Headless (`~/.cache/ms-playwright/chromium_headless_shell-1228`): `AUTH_DISABLED=1 npm -w app run dev -- -p 3051` → open the chat: empty state shows 5 suggestions → click one → streaming answer renders (markdown + a highlighted code block + copy button works) → follow-up chips appear → click a chip streams again → Stop button aborts mid-stream keeping partial text → error/retry path → usedTools footer toggles → smart autoscroll pill → textarea Shift+Enter. Diagnose page still renders. light+dark; iPhone 390×844 no page h-scroll; 0 console errors. Kill dev.
- [ ] **Step 3:** Final whole-branch review (adversarial) → fix Critical/Important.
- [ ] **Step 4:** Merge to main; build new SHA image; redeploy `NfmDash-App -c imageTag=<sha>` (SUBJECT TO USER AUTHORIZATION); headless prod smoke of the chat.

---

## Phase 5 self-review checklist
- [ ] Single Markdown renderer + global .chat-markdown, theme-aware (not force-dark) — T1.
- [ ] Syntax highlighting + copy button — T1.
- [ ] SSE client handles followups + robust abort/401 — T2.
- [ ] Backend emits followups event (both /api/ai + /api/diagnose), graceful [] — T3.
- [ ] Suggested prompts + follow-up chips + Stop + textarea + smart scroll + retry + usedTools + a11y — T4.
- [ ] Drawer + simplified popup logic — T5.
- [ ] SigV4 gateway (mcp-client) + model fallback + keepalive UNCHANGED; wire format preserved.
- [ ] t() ko+en everywhere, tokens-only, mobile-safe, full suite green + build. Deploy after review (authorized).
