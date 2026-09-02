// ---------------------------------------------------------------------------
// A recorded session, replayed for anyone who opens this page without an agent
// attached.
//
// It is not a mock-up. It is what actually happened while this project was
// being built, compressed. An agent (me) planned a missing-persons site for the
// August 2026 Nepal floods on the assumption that the official casualty list
// was published as structured data. It is not: it is a scanned PDF, and
// screenshots pasted into Facebook groups. That single unchecked assumption
// cost most of a day and about thirty messages of back and forth.
//
// On a board it costs one comment on one node. That is the entire pitch, and
// this replay is the receipt.
// ---------------------------------------------------------------------------

export const recorded = [

  {
    say: 'An agent is asked to plan a missing-persons lookup for the Nepal floods.',
    mode: 'draft',
    wait: 1500,
  },

  {
    say: 'It draws the plan. One call, no coordinates: the board lays itself out.',
    tool: 'draw_plan',
    keep: true,
    wait: 2200,
    args: () => ({
      title: 'Missing-persons lookup, Nepal floods',
      nodes: [
        { key: 'ask', label: 'Family enters a name', kind: 'entry' },
        { key: 'cron', label: 'Nightly, at 02:00', kind: 'entry' },
        { key: 'ingest', label: 'Nightly ingest of the official list', kind: 'io',
          detail: 'Poll the government site, pull the newest casualty list',
          confidence: 0.35 },
        { key: 'parse', label: 'Parse the list into records',
          detail: 'One row per person: name, age, district, status' },
        { key: 'index', label: 'Our copy of the records', kind: 'store',
          confidence: 0.5 },
        { key: 'match', label: 'Match the name phonetically',
          detail: 'Adhikary and Adhikari are the same surname; so are Bishnu and Bisnu' },
        { key: 'show', label: 'Show the matching record', kind: 'terminal' },
      ],
      edges: [
        { from: 'ask', to: 'match' },
        { from: 'cron', to: 'ingest' },
        { from: 'ingest', to: 'parse' },
        { from: 'parse', to: 'index' },
        { from: 'index', to: 'match' },
        { from: 'match', to: 'show' },
      ],
      notes: [
        { anchor: 'ingest', kind: 'assumption',
          text: 'the official list is published as structured data' },
        { anchor: 'index', kind: 'risk',
          text: 'we would be holding other people\'s missing-person records' },
      ],
    }),
  },

  {
    say: 'It states its assumption out loud, and admits it is only 35% sure of the ingest.',
    select: ids => ids.ingest,
    wait: 2600,
  },

  {
    say: 'The human reads the diagram, and goes straight to the wrong node.',
    mode: 'review',
    wait: 1400,
  },

  {
    human: (scene, you, ids) => scene.addComment({
      anchor: ids.ingest, author: you,
      body: 'this does not seem fine. the government list is a scanned PDF and screenshots '
        + 'pasted into facebook groups. there is no structured feed to ingest.',
    }),
    say: 'One comment, on one node. Not a paragraph about the whole plan.',
    wait: 2800,
  },

  {
    say: 'The board now says an objection is unanswered. That is the check that matters most.',
    tool: 'list_open_items',
    wait: 2000,
  },

  {
    say: 'The agent answers in the thread where the objection was made.',
    tool: 'reply_to_comment',
    wait: 2400,
    args: ids => ({
      id: ids.objection,
      body: 'You are right, and it invalidates the ingest. I checked: the source is a scanned '
        + 'PDF with no text layer, and the rest is images. Dropping the nightly ingest.',
    }),
  },

  {
    human: (scene, you, ids) => scene.setStickyState(ids.assumption, 'denied', { author: you }),
    say: 'The human denies the assumption. Everything the plan built on it turns stale.',
    wait: 2600,
  },

  {
    say: 'Four steps go amber at once. Nobody had to work out which ones.',
    tool: 'check_plan',
    wait: 2600,
  },

  {
    say: 'The agent revises. The node ids do not change, so the objection stays attached to it.',
    tool: 'revise',
    wait: 2400,
    args: ids => ({
      because: ids.objection,
      reject: [
        { id: ids.ingest, because: 'the source is a scanned PDF, there is nothing to ingest' },
        { id: ids.index, because: 'and without an ingest we would be copying records for no reason' },
        { id: ids.cron, because: 'nothing left for it to trigger' },
      ],
    }),
  },

  {
    say: 'Then it draws the replacement: the family brings the document, we never keep it.',
    tool: 'add_step',
    keepAs: 'bring',
    wait: 1600,
    args: ids => ({
      label: 'Family pastes the link to the official list',
      kind: 'entry',
      detail: 'The browser fetches it directly. Nothing about anybody is stored on our side.',
      before: ids.parse,
      confidence: 0.9,
    }),
  },

  {
    tool: 'revise',
    say: 'The remaining steps are re-grounded on a premise that survived review.',
    wait: 2000,
    args: ids => ({
      because: ids.objection,
      agree: [ids.parse, ids.match, ids.show, ids.ask],
      connect: [{ from: ids.parse, to: ids.match }],
    }),
  },

  {
    human: (scene, you, ids) => scene.resolveComment(ids.objection, {
      author: you, because: 'good, the browser fetches it and we keep nothing',
    }),
    say: 'The human closes the objection. Only they can: the agent can answer, not settle.',
    select: ids => ids.bring,
    wait: 2400,
  },
];
