# Devpost submission

**Live:** https://thesupermanish.github.io/whiteboard/
**Repo:** https://github.com/TheSupermanish/whiteboard (MIT)
**Video:** *(paste YouTube link)*

---

## What it is

A board where an agent draws its plan as a flowchart, and a developer reviews it node by node
before any code exists.

## Why this needs WebMCP

**The agent's primary action is writing the page, not reading it.** It is the one drawing. There
is no way to emit a node, bind an arrow between two specific steps, or settle a choice from a
screenshot. Writing structure needs tools with stable ids.

**Those ids survive revision.** When the agent redraws, `n7` is still `n7`, so the comment you
made on it is still about the same step four revisions later. This is the load-bearing part, and
it is the thing a text diagram in a chat window cannot do: Mermaid re-renders wholesale, no id
survives, and review on it collapses back into quoting prose at each other.

**The page computes what the model cannot.** Reachability, cycles, unhandled branches, route
enumeration and the staleness cascade from a rejected premise are graph theory over live state.
The page reports the structural fact; the model supplies the meaning. `check_plan` returns
*"this decision has one outbound branch"*; the model says *"that is the payment-declined path
and it is missing"*.

**Tool availability is the permission.** The board has two modes. In review mode `draw_plan` and
`remove_element` are withdrawn from the host and refused if called anyway, so an agent cannot
redraw the board or delete a step somebody objected to while that objection is open. Deleting
anything at all goes through `requestUserInteraction()` first, and the prompt names what would be
destroyed: *"Delete 'Match the name phonetically'? 1 comment on it would go too."*

## How it improves the experience for people

The problem is real and this project is the receipt for it.

An agent was asked to build a missing-persons lookup for the August 2026 Nepal floods. It planned
a nightly job to ingest the official casualty list, parse it into records, index them for search.
Reasonable. It rested on one unstated assumption: that the list is published as structured data.

It is not. It is a scanned PDF, and screenshots pasted into Facebook groups.

That single unchecked assumption cost most of a day and about thirty messages of back and forth.
Not through carelessness, but because the plan only ever existed as prose, and prose has no
anchors. You cannot point at paragraph four and say "this bit". You quote it, the agent
re-explains everything, and the thread drifts.

On a board it costs one comment on one node. Press **Play example** on the live site and you are
watching that exact session, replayed.

Four things make the difference:

- **A flowchart is legible in ten seconds.** Two thousand words of plan is not, so nobody reads
  it properly, so nobody catches the assumption.
- **Reasoning is drawn, not narrated.** Options the agent considered and rejected stay on the
  board struck through with the reason attached, so you can attack the reasoning instead of only
  seeing the outcome. Assumptions are marked *unsettled* until a human rules on them. Confidence
  below 50% is drawn dashed, which tells a reviewer where to look first.
- **Denying a premise shows you what it took with it.** The board walks the graph and marks
  everything downstream stale. Nobody has to work out which steps those were, and the amber
  clears when a step is explicitly agreed, which is the act of re-grounding it.
- **The agent is held to the objections.** `unanswered_comment` is a first-class check, and the
  agent has `reply_to_comment` but not `resolve_comment`. It can answer. Only a human can settle.

## What people and agents can now do together

- An agent draws a plan in one call, without coordinates, and gets its own structural errors back
  in the response, before a human has to point at them.
- A developer marks up a specific step, and the objection stays attached to that step through
  every subsequent redraw.
- The agent works a queue: objections nobody answered, assumptions nobody ruled on, steps a human
  dropped, and what a rejection just invalidated.
- Two people and an agent can be on the same board. Merging is element-level last-write-wins on a
  version counter, so people editing different steps never clobber each other.
- Nobody can have a discussion that is not attached to something. There is no chat box. An
  objection with no target is how a plan drifts, and drift is what this exists to stop.

## How WebMCP was implemented

`navigator.modelContext.registerTool()` for 13 tools, re-registered whenever the board mode
changes; `requestUserInteraction()` gating every destructive write.

Notable choices:

- **No tool takes a coordinate.** The agent says what connects to what; the page ranks it with
  dagre and React Flow routes it. There is a test asserting no tool schema mentions `x`, `y`,
  `width` or `height`. This is what keeps the surface small enough for a model to use well.
- **`draw_plan` takes author-chosen keys** (`"parse_body"`) and returns the ids they became, so a
  whole graph is one call and the agent never has to guess an id. Keys and real ids are
  interchangeable as edge endpoints, so extending a board is the same call shape.
- **Every write returns the analysis.** `draw_plan`, `add_step`, `connect` and `revise` all hand
  back the current error and warning count.
- **The dispatcher has no fallback.** An earlier version resolved an unregistered tool from the
  full table, which made every mode restriction cosmetic; it silently wiped a file during a test
  run. There is now an assertion that a withdrawn tool is refused, not merely hidden.

## Stack

React, React Flow, dagre, Vite. Nothing in `src/lib/` touches the DOM or React, so the graph, its
invariants, the ten checks, the tool surface and the entire recorded session are tested headless
in Node: **154 assertions**, no browser.

---

# Video script, under three minutes

Record at 1440x900 or wider. Live site, browser zoom 100%. Clear `localStorage` first.

### 0:00 — 0:22 · the receipt

> "While building this, I planned a missing-persons site for the Nepal floods around one
> assumption: that the government publishes the casualty list as structured data. It doesn't.
> It's a scanned PDF and Facebook screenshots. Finding that out took most of a day and about
> thirty messages, because the plan only existed as prose. Here's what it costs on a board."

*On screen: the empty state. Hover **Play example**.*

### 0:22 — 1:05 · the loop

*Click **Play example**. Let it run; do not narrate every step.*

> "The agent draws the plan. One call, no coordinates — it says what connects to what and the
> page lays it out. It marks its own assumption as unsettled, and admits it's only 35% sure of
> the ingest, which is why that box is dashed."

*The comment lands on the ingest node.*

> "The human goes straight to the wrong node. One comment, on one step. Not a paragraph about
> the whole plan."

*The board flags it.*

> "The board now says an objection is unanswered. That's the check that matters most — it's how a
> plan moves on without the objection being addressed."

*The assumption is denied, four steps go amber.*

> "Deny the assumption and everything that rested on it goes stale. Nobody had to work out which
> steps those were, the page walked the graph."

### 1:05 — 1:35 · ids survive the redraw

*Click the dropped ingest node. Show the thread in the panel.*

> "The agent revised the plan, but the node ids didn't change, so the objection is still attached
> to the exact step it was made about. That's the part a Mermaid diagram in a chat window can't
> do — it re-renders wholesale and every id is gone. And notice the agent replied but couldn't
> close this. It has reply_to_comment. It doesn't have resolve. Only a human settles an objection."

### 1:35 — 2:05 · what the page computes

*Open the **Checks** tab. Click a finding to highlight it on the board.*

> "These aren't opinions, they're facts about the graph: routes through the plan, decisions with
> only a happy path, dead ends where the error handling should be, circular reasoning. The page
> finds the structure. The model reads it and says what it means."

### 2:05 — 2:35 · the boundary

*Switch to **Under review**. Open the console.*

```js
await window.redline.call('draw_plan', { nodes: [{ key: 'x', label: 'X' }] })
```

> "In review mode the drawing tools are withdrawn from the agent — and refused if it calls them
> anyway. It cannot redraw the board or delete a step you objected to while that objection is
> open. Deleting anything at all asks you first, and tells you what goes with it."

### 2:35 — 2:55 · together

*Open a second tab on `?share`. Comment in one, show it appear in the other.*

> "Two people and an agent, same board. And every remark is attached to something — there's no
> chat box, on purpose. An objection with no target is how a plan drifts in the first place."

### 2:55 — 3:00 · close

> "Review the plan, not the pull request."
