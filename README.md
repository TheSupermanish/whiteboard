# Redline

**A board where an agent draws its plan as a flowchart, and you review it node by node before any code exists.**

Built for the WebMCP Challenge.

**Live: https://thesupermanish.github.io/whiteboard/** · **Code: https://github.com/TheSupermanish/whiteboard** · Licence: MIT

---

## The problem, with a receipt

This project's own history is the argument.

An agent (me) was asked to build a missing-persons lookup for the August 2026 Nepal floods. It planned a nightly job that would ingest the official casualty list, parse it into records, and index them for search. Reasonable-sounding. It rested on one unstated assumption: **that the official list is published as structured data.**

It is not. It is a scanned PDF, and screenshots pasted into Facebook groups.

That single unchecked assumption cost most of a day and about thirty messages. Not because anybody was careless, but because the plan only ever existed as prose. Prose has no anchors. You cannot point at paragraph four and say "this bit". You quote it, the agent re-explains the whole thing, and the thread drifts.

On a board it costs one comment on one node.

Open the page and press **Play example**. You are watching that exact session, replayed.

## The loop

1. You state what you want, in a sentence.
2. **The agent draws the plan** — one `draw_plan` call, no coordinates. Boxes for steps, diamonds for branches, arrows for flow, stickies for assumptions and risks.
3. You *scan* it. A flowchart is legible in ten seconds. Two thousand words of plan is not.
4. **You mark it up.** Comment on a node: *"you are not building billing here."* Drop a step with a reason. Deny an assumption.
5. The agent reads your marks **with their anchoring intact** — "comment C3 is on n7, the billing service, which has an inbound arrow from checkout" — answers each one, and revises.
6. Repeat until the diagram is agreed. **Then** the code gets written.

Step 4 is the product. Step 6 is the value.

## What makes it WebMCP and not a prompt

Three things, and only the third is about reading the page.

**1. The agent's primary action is writing.** It is the one drawing. There is no way to emit a node, bind an arrow between two specific nodes, or move a cluster from a screenshot. Writing structure needs tools with stable ids.

**2. Ids survive revision.** When the agent redraws, `n7` is still `n7`, so the comment you made on it is still about the same step, four revisions later. This is the part that actually matters.

**3. The page computes what the model cannot.** Reachability, cycles, unhandled branches, route enumeration, and the staleness cascade are graph theory over live state. The page reports the fact; the model supplies the meaning.

### The honest counter: Mermaid in a chat window

That is what people do today, and it gets most of this for none of the work. Worth naming rather than hiding:

- You cannot *point* at a Mermaid node. You quote its text, which is back to prose.
- Mermaid re-renders wholesale, so no id survives, so a comment cannot outlive a redraw.
- No computed gap analysis comes back.
- One person at a time.

Those are the real deltas. They are the reason this is a board and not a code fence.

## Visualising what the agent is thinking

Reasoning is rendered as structure, not narrated in prose:

| On the board | What it exposes |
|---|---|
| **Option clusters** (`propose_options`) | Candidates it weighed, with rejected ones struck through and the reason still attached. You can attack the reasoning, not just the outcome. |
| **Assumption stickies** (`add_note`, kind `assumption`) | Marked *unsettled* until a human confirms or denies. The Nepal mistake was one of these, unstated. |
| **Confidence** (`explain_node`) | Below 50% draws a dashed border. It tells a reviewer where to look first. |
| **Derivation edges** (`connect`, kind `derives`) | "This exists *because* of that." Deny the premise and the board works out what just became unsound. |

Deny one assumption and everything that rested on it turns amber at once. Nobody has to work out which steps those were.

## The checks

Structural facts about the graph, not opinions. `check_plan` returns all of them.

| Check | Catches |
|---|---|
| `unanswered_comment` | An objection the agent never replied to. **The one that matters most.** |
| `unhandled_branch` | A decision with one outbound arrow. A decision with one branch is not a decision. |
| `dead_end` | A step with no way onward, not marked terminal. This is where missing error paths hide. |
| `unreachable` | Nothing can reach it. Dead work, or a missing edge. |
| `circular_reasoning` | Each of these is justified by the next. The reasoning has no ground. |
| `cycle` | Control loops. Fine if it is a retry, not fine if it is an accident. |
| `unverified_assumption` | Nobody has ruled on it, and the plan below it depends on it. |
| `stale` | Downstream of something rejected or denied. Clears when a step is explicitly agreed, which is the act of re-grounding it. |
| `paths` | Every route through the plan. Each route is a case somebody has to handle. |
| `orphan_sticky` / `unbound_edge` | A note about nothing; an arrow to nothing. |

## The tool surface

Two modes. The difference between them is enforced, not advertised.

**Drafting** — the agent is drawing.
`draw_plan` · `add_step` · `connect` · `add_note` · `propose_options` · `decide_option` · `explain_node` · `get_board` · `check_plan` · `list_open_items` · `reply_to_comment` · `revise` · `remove_element`

**Under review** — a human is marking up.
`get_board` · `check_plan` · `list_open_items` · `reply_to_comment` · `revise` · `add_step` · `connect` · `add_note` · `explain_node`

In review mode `draw_plan` and `remove_element` are withdrawn from the host **and refused if called anyway**. A hidden-but-callable tool is not a boundary. There is a test for exactly this, because an earlier version of this codebase had a `|| TOOLS[name]` fallback in its dispatcher that made every mode restriction cosmetic.

Deleting anything goes through `navigator.modelContext.requestUserInteraction()` first, and the prompt names what would be destroyed:

> Delete "Match the name phonetically"? 1 comment on it would go too.

Deleting a node somebody objected to destroys the record of the objection. That is the one unforgivable action here.

### Design decisions worth stating

**The agent never sends coordinates.** No `x`, no `y`, no width, no collision handling. It says "this connects to that" and the page does layered layout, crossing reduction, and orthogonal routing. There is a test asserting no tool schema mentions a coordinate. This is what keeps the tool surface small enough for a model to use well.

**One call draws a whole plan.** `draw_plan` takes author-chosen keys (`"parse_body"`) and returns the ids they became, so the agent describes a graph in one call without knowing what ids it is about to be handed. Both keys and real ids work as edge endpoints, so extending an existing board is the same call shape.

**Every write hands back the analysis.** `draw_plan`, `add_step`, `connect` and `revise` all return the current error and warning count. The agent sees the holes in its own plan before a human has to point at them.

**No unanchored chat.** Every remark attaches to a node, an edge, or a sticky. `addComment` without an anchor throws. An objection with no target is how a plan drifts, and drift is the thing this exists to stop.

**Only a human can settle an objection.** The agent has `reply_to_comment`. It does not have `resolve_comment`. Whether an objection is dealt with is not the agent's call.

## Running it

```bash
npm install
npm run dev        # http://localhost:1447
npm test           # 154 assertions, no browser needed
npm run build      # static output in dist/
```

React, [React Flow](https://reactflow.dev) for the canvas, [dagre](https://github.com/dagrejs/dagre)
for ranking, Vite to build. Everything under `src/lib/` has no dependencies at all.

### Trying it with an agent

- **ChatGPT's in-app browser** supports WebMCP natively. Open the URL and say *"draw the plan for X on the board"*.
- **Chrome 146+**: enable `chrome://flags/#enable-webmcp-testing`.
- **No agent?** The page says so in the top right, and **Play example** runs the whole loop without one. Most people will see this page before they ever wire an agent up, so the loop had to be legible without one.

## Layout

```
src/
  main.jsx            entry point
  App.jsx             scene ownership, tool surface, toolbar, sharing
  Board.jsx           the React Flow canvas, layout trigger, framing
  Panel.jsx           the three review tabs
  nodes.jsx           how a step and a loose note are drawn
  toFlow.js           scene to React Flow nodes and edges
  layout.js           dagre ranking, with entry and exit anchors
  styles.css
  lib/
    scene.js          the graph, its invariants, cascade delete, merge   (pure)
    analyze.js        the ten structural checks                         (pure)
    mcp.js            tool definitions, modes, registration, gating
    net.js            BroadcastChannel and WebSocket sharing
    replay.js         driver for the recorded session
    recorded.js       the recorded session itself
worker/index.js       Cloudflare relay for shared boards
tools/
  test-analyze.mjs    58 assertions
  test-mcp.mjs        61 assertions
  test-recorded.mjs   35 assertions
```

Nothing in `src/lib/` touches the DOM or React, which is why the graph, the checks, the tool
surface and the whole recorded session test headless in Node.

### On not writing the layout myself

The first version of this had a hand-rolled layered layout: longest-path ranking, barycentre
crossing reduction, per-layer edge waypoints, orthogonal routing with rounded corners. About
five hundred lines. It passed twenty-eight assertions and still produced a bowl of crossed
wires on a real plan, because Sugiyama layout is a research area and not an afternoon.

React Flow and dagre replaced all of it. Everything that made the tool *this* tool, the graph
invariants, the checks, the tool surface, the review loop, was untouched by the swap, because
none of it ever knew what a coordinate was. That is the argument for keeping the domain pure,
and it is worth more than the layout code was.

## Testing notes

Two habits, both learned the hard way earlier in this project:

**Every fixture plants exactly one defect**, so a finding cannot be explained by a neighbouring defect. The first fixture plants none, and exists purely to catch false positives. A review tool that cries wolf is worse than no review tool.

**The recorded session is tested through the same driver the page runs.** A test that reimplements the driver can pass while the demo is broken, and for most visitors the demo is the only thing they will ever see.

Bugs these caught: a cyclic graph silently reporting zero routes; staleness that never cleared once a step was re-grounded; a temporal dead zone crash that killed the whole page with nothing in the console.

## Sharing a board

Local-first. The board works with no network at all, so sharing is additive and a relay being
down cannot take the tool with it.

- **Other tabs in this browser** always sync, via `BroadcastChannel`. Add `?share` to the URL.
- **Other people** need the relay in `worker/`: `?room=<name>&relay=<wss url>`.

Merging is element-level last-write-wins on the `ver` counter every element carries. Two people
editing different steps never clobber each other; only a genuine conflict on the same step
resolves arbitrarily. Deletions travel as ids and always beat an edit, because the alternative
is a step that keeps coming back. No CRDT for a graph this size.

Identity lives in `sessionStorage`, not `localStorage`. In `localStorage` every tab in the
browser shares one id, so both halves of a two-tab board discard each other's messages as their
own echo.

The relay is a relay, not a store. It forwards frames and keeps only the last state seen, so
somebody joining mid-discussion is not shown an empty canvas. Nothing is written to disk: an
unshipped plan should not become somebody else's persisted data.

## Not built

- **Design review on the same board.** A node kind holding generated HTML, commented on exactly
  like any other step, so an agent could put a proposed interface up and have it marked. The
  review machinery already works for anything with an id; this is a renderer and a tool.
- **Frames** for grouping clusters.
- **Revision diffing** in the UI. The scene keeps an append-only log and `since(rev)` works;
  nothing surfaces it yet.

## Licence

MIT. See [LICENSE](LICENSE).
