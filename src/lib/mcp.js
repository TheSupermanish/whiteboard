// ---------------------------------------------------------------------------
// The WebMCP surface.
//
// Two things make this worth doing over "ask the model for a Mermaid diagram":
//
//  1. The agent WRITES the board, and every element it writes keeps a stable
//     id. A comment made on n7 is still about n7 after four revisions. Text
//     diagrams get re-rendered wholesale and lose that identity, which is what
//     makes review on them collapse back into prose.
//
//  2. The tools available depend on which mode the board is in. In review mode
//     the agent physically cannot redraw the board or delete a node someone
//     objected to. The human's current view is the permission.
// ---------------------------------------------------------------------------

import { analyze } from './analyze.js';

let scene = null;
let onChange = () => {};
let askPage = null;               // page-supplied confirmation, used when the host has none
let currentMode = 'draft';
const registered = new Map();     // name -> unregister handle or true

export function attach({ scene: s, notify, confirm: pageConfirm }) {
  scene = s;
  onChange = notify || (() => {});
  if (pageConfirm) askPage = pageConfirm;
}

// --- helpers --------------------------------------------------------------

const listOf = v => Array.isArray(v) ? v : [];

function requireScene() {
  if (!scene) throw new Error('the board is not ready yet');
  return scene;
}

/** Renders an element the way a model should see it: ids, never coordinates. */
function describeNode(n, s) {
  const out = {
    id: n.id, label: n.label, kind: n.kind, status: n.status, author: n.author,
  };
  if (n.detail) out.detail = n.detail;
  if (n.confidence != null) out.confidence = n.confidence;
  if (n.rejected_because) out.rejected_because = n.rejected_because;
  const notes = s.stickies().filter(x => x.anchor === n.id);
  if (notes.length) out.notes = notes.map(describeSticky);
  const open = s.comments().filter(c => c.anchor === n.id && !c.resolved);
  if (open.length) out.open_comments = open.map(c => c.id);
  return out;
}

const describeSticky = x => ({
  id: x.id, kind: x.kind, text: x.label, anchor: x.anchor,
  ...(x.state ? { state: x.state } : {}),
  author: x.author,
});

const describeComment = c => ({
  id: c.id, anchor: c.anchor, author: c.author, body: c.body,
  resolved: c.resolved, created_at: c.created_at,
  replies: c.replies.map(r => ({ author: r.author, body: r.body, at: r.at })),
});

function boardSnapshot() {
  const s = requireScene();
  return {
    revision: s.rev,
    mode: currentMode,
    nodes: s.nodes().map(n => describeNode(n, s)),
    edges: s.edges().map(e => ({
      id: e.id, from: e.from, to: e.to, kind: e.kind,
      ...(e.label ? { label: e.label } : {}),
    })),
    floating_notes: s.stickies().filter(x => !x.anchor).map(describeSticky),
    comments: s.comments().map(describeComment),
  };
}

/**
 * Resolves an author-chosen key ("parse_body") or a real element id ("n3").
 * Keys let the agent describe a whole graph in one call without knowing what
 * ids it is about to be given.
 */
function resolver(keyMap) {
  return function resolve(ref, field) {
    const key = String(ref ?? '').trim();
    if (!key) throw new Error(`${field} is required`);
    if (keyMap.has(key)) return keyMap.get(key);
    if (requireScene().has(key)) return key;
    const known = [...keyMap.keys()].sort().join(', ');
    throw new Error(
      `${field} "${key}" is neither a key defined in this call nor an element already on the board`
      + (known ? `. keys in this call: ${known}` : ''));
  };
}

/**
 * Asks the person at the board before doing something destructive.
 *
 * `navigator.modelContext.requestUserInteraction()` is the right way to do
 * this, and it is not in Chrome 152: the API ships `registerTool`, `getTools`
 * and `executeTool` and nothing else. An earlier version of this function
 * returned `true` when the method was missing, which meant the gate silently
 * evaporated on the only browser you can currently run this in. So there are
 * three fallbacks and the last one is a refusal. Never "no gate available,
 * carry on" for an irreversible action.
 */
async function confirm(message) {
  const mc = globalThis.navigator?.modelContext;

  if (typeof mc?.requestUserInteraction === 'function') {
    const answer = await mc.requestUserInteraction({ message });
    // Anything other than an explicit refusal counts as consent, but a refusal
    // is final.
    if (answer === false || answer?.granted === false || answer?.accepted === false) {
      throw new Error('the person at the board declined this change');
    }
    return true;
  }

  if (askPage) {
    if (await askPage(message)) return true;
    throw new Error('the person at the board declined this change');
  }

  if (typeof globalThis.confirm === 'function') {
    if (globalThis.confirm(message)) return true;
    throw new Error('the person at the board declined this change');
  }

  throw new Error(
    'this change needs a person to confirm it, and there is no way to ask in this environment');
}

// --- tools ----------------------------------------------------------------

export const TOOLS = {

  draw_plan: {
    name: 'draw_plan',
    annotations: { untrustedContentHint: true },
    description:
      'Draw a whole plan on the board in one call. Give each node a short key of your own '
      + 'choosing and refer to those keys in edges and notes. Do not send coordinates: the board '
      + 'lays itself out. Use this once at the start; use add_step and connect to extend it after.',
    inputSchema: {
      type: 'object',
      required: ['nodes'],
      properties: {
        title: { type: 'string', description: 'what this plan is for, one line' },
        replace: { type: 'boolean', description: 'wipe the existing board first. requires the human to confirm.' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'label'],
            properties: {
              key: { type: 'string', description: 'your own short handle, e.g. "parse_body"' },
              label: { type: 'string' },
              kind: { type: 'string', enum: ['entry', 'process', 'decision', 'store', 'io', 'external', 'terminal'] },
              detail: { type: 'string', description: 'what a coder needs to know about this step' },
              confidence: { type: 'number', description: '0 to 1. be honest; low confidence is drawn dashed so it gets reviewed first.' },
            },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string' }, to: { type: 'string' },
              label: { type: 'string', description: 'the condition, e.g. "declined"' },
              kind: { type: 'string', enum: ['flow', 'derives'], description: '"derives" means the target exists because of the source' },
            },
          },
        },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string' },
              kind: { type: 'string', enum: ['note', 'assumption', 'risk', 'question'] },
              anchor: { type: 'string', description: 'the node key this is about' },
            },
          },
        },
      },
    },
    async execute(args) {
      const s = requireScene();
      const nodes = listOf(args.nodes);
      if (!nodes.length) throw new Error('draw_plan needs at least one node');

      if (args.replace && s.nodes().length) {
        await confirm(`Replace the whole board? ${s.nodes().length} nodes and `
          + `${s.comments().filter(c => !c.resolved).length} open comments would be discarded.`);
        for (const n of s.nodes()) if (s.has(n.id)) s.remove(n.id, { author: 'agent' });
        for (const x of s.stickies()) if (s.has(x.id)) s.remove(x.id, { author: 'agent' });
      }

      const keyMap = new Map();
      for (const spec of nodes) {
        const key = String(spec.key ?? '').trim();
        if (!key) throw new Error('every node needs a key');
        if (keyMap.has(key)) throw new Error(`duplicate node key "${key}"`);
        const made = s.addNode({
          label: spec.label, kind: spec.kind || 'process',
          detail: spec.detail || '', confidence: spec.confidence ?? null,
          author: 'agent',
        });
        keyMap.set(key, made.id);
      }
      const resolve = resolver(keyMap);

      const edges = [];
      for (const spec of listOf(args.edges)) {
        edges.push(s.addEdge({
          from: resolve(spec.from, 'edges[].from'),
          to: resolve(spec.to, 'edges[].to'),
          label: spec.label || '', kind: spec.kind || 'flow', author: 'agent',
        }).id);
      }
      const notes = [];
      for (const spec of listOf(args.notes)) {
        notes.push(s.addSticky({
          label: spec.text, kind: spec.kind || 'note', author: 'agent',
          anchor: spec.anchor ? resolve(spec.anchor, 'notes[].anchor') : null,
        }).id);
      }

      onChange();
      return {
        drawn: { nodes: Object.fromEntries(keyMap), edges, notes },
        revision: s.rev,
        // Hand the analysis straight back, so the agent sees the holes in its
        // own plan before the human has to point them out.
        check: summarise(analyze(s)),
        next: 'The board is drawn. The human reviews it and comments on specific nodes. '
          + 'Call list_open_items to see what they said.',
      };
    },
  },

  add_step: {
    name: 'add_step',
    annotations: { untrustedContentHint: true },
    description: 'Add one node to the board, optionally wired to nodes that already exist.',
    inputSchema: {
      type: 'object',
      required: ['label'],
      properties: {
        label: { type: 'string' },
        kind: { type: 'string', enum: ['entry', 'process', 'decision', 'store', 'io', 'external', 'terminal'] },
        detail: { type: 'string' },
        confidence: { type: 'number' },
        after: { type: 'string', description: 'id of a node this follows' },
        before: { type: 'string', description: 'id of a node this precedes' },
      },
    },
    execute(args) {
      const s = requireScene();
      const n = s.addNode({
        label: args.label, kind: args.kind || 'process',
        detail: args.detail || '', confidence: args.confidence ?? null, author: 'agent',
      });
      const wired = [];
      if (args.after) wired.push(s.addEdge({ from: args.after, to: n.id, author: 'agent' }).id);
      if (args.before) wired.push(s.addEdge({ from: n.id, to: args.before, author: 'agent' }).id);
      onChange();
      return { id: n.id, wired, revision: s.rev, check: summarise(analyze(s)) };
    },
  },

  connect: {
    name: 'connect',
    annotations: { untrustedContentHint: true },
    description:
      'Join two nodes. kind "flow" means control or data moves along it. kind "derives" means '
      + 'the target only exists because of the source, which is how the board works out what a '
      + 'rejection invalidates downstream.',
    inputSchema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'string' }, to: { type: 'string' },
        label: { type: 'string' },
        kind: { type: 'string', enum: ['flow', 'derives'] },
      },
    },
    execute(args) {
      const s = requireScene();
      const e = s.addEdge({
        from: args.from, to: args.to, label: args.label || '',
        kind: args.kind || 'flow', author: 'agent',
      });
      onChange();
      return { id: e.id, revision: s.rev, check: summarise(analyze(s)) };
    },
  },

  add_note: {
    name: 'add_note',
    annotations: { untrustedContentHint: true },
    description:
      'Stick a note on a node. Use kind "assumption" for anything you are taking on faith: it '
      + 'shows up as unsettled until the human confirms or denies it, and if they deny it the '
      + 'board marks everything downstream as stale. State assumptions generously. Most wasted '
      + 'work comes from one unstated assumption nobody checked.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        kind: { type: 'string', enum: ['note', 'assumption', 'risk', 'question'] },
        anchor: { type: 'string', description: 'the node or edge id this is about' },
      },
    },
    execute(args) {
      const s = requireScene();
      const x = s.addSticky({
        label: args.text, kind: args.kind || 'note',
        anchor: args.anchor || null, author: 'agent',
      });
      onChange();
      return { id: x.id, state: x.state, revision: s.rev };
    },
  },

  propose_options: {
    name: 'propose_options',
    annotations: { untrustedContentHint: true },
    description:
      'Show a choice you are weighing, with the candidates you considered. Draws a decision node '
      + 'with one option hanging off it per candidate. This is the point of the board: the human '
      + 'can attack the reasoning behind a rejected option instead of only seeing what you picked.',
    inputSchema: {
      type: 'object',
      required: ['question', 'options'],
      properties: {
        question: { type: 'string', description: 'the choice, e.g. "how do we store the graph?"' },
        after: { type: 'string', description: 'id of the node this choice follows' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label'],
            properties: {
              label: { type: 'string' },
              because: { type: 'string', description: 'why it is or is not a good idea' },
              confidence: { type: 'number' },
            },
          },
        },
      },
    },
    execute(args) {
      const s = requireScene();
      const options = listOf(args.options);
      if (options.length < 2) throw new Error('a choice needs at least two options');
      const decision = s.addNode({ label: args.question, kind: 'decision', author: 'agent' });
      if (args.after) s.addEdge({ from: args.after, to: decision.id, author: 'agent' });
      const made = [];
      for (const o of options) {
        const node = s.addNode({
          label: o.label, kind: 'option', detail: o.because || '',
          confidence: o.confidence ?? null, author: 'agent',
        });
        s.addEdge({ from: decision.id, to: node.id, kind: 'option', author: 'agent' });
        made.push({ id: node.id, label: node.label });
      }
      onChange();
      return { decision: decision.id, options: made, revision: s.rev };
    },
  },

  decide_option: {
    name: 'decide_option',
    annotations: { untrustedContentHint: true },
    description:
      'Settle a choice: mark one option agreed and the rest rejected, each with a reason. '
      + 'Rejected options stay visible on the board, struck through, so the human can argue with '
      + 'the reason rather than wonder what you ruled out.',
    inputSchema: {
      type: 'object',
      required: ['chosen'],
      properties: {
        chosen: { type: 'string', description: 'id of the option you are going with' },
        because: { type: 'string' },
        rejected: {
          type: 'array',
          description: 'the options you are ruling out, each with a reason',
          items: {
            type: 'object',
            required: ['id', 'because'],
            properties: { id: { type: 'string' }, because: { type: 'string' } },
          },
        },
      },
    },
    execute(args) {
      const s = requireScene();
      s.setStatus(args.chosen, 'agreed', { author: 'agent' });
      if (args.because) s.relabel(args.chosen, { detail: args.because, author: 'agent' });
      const ruled = [];
      for (const r of listOf(args.rejected)) {
        s.setStatus(r.id, 'rejected', { author: 'agent', because: r.because });
        ruled.push(r.id);
      }
      onChange();
      const report = analyze(s);
      return { chosen: args.chosen, rejected: ruled, stale: report.stale, revision: s.rev };
    },
  },

  explain_node: {
    name: 'explain_node',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      'Attach the detail a coder needs to one node, and say how sure you are. Low confidence is '
      + 'drawn dashed, which tells the reviewer where to look first. Understating uncertainty '
      + 'here is the single most expensive thing you can do.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        detail: { type: 'string' },
        confidence: { type: 'number' },
      },
    },
    execute(args) {
      const s = requireScene();
      if (args.detail !== undefined) s.relabel(args.id, { detail: args.detail, author: 'agent' });
      if (args.confidence !== undefined) s.setConfidence(args.id, args.confidence, { author: 'agent' });
      onChange();
      return { id: args.id, revision: s.rev };
    },
  },

  get_board: {
    name: 'get_board',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      'Read the board: every node, edge, note and comment, with ids. Call this before revising '
      + 'anything, because the human may have moved, rejected or commented on things since you '
      + 'last drew.',
    inputSchema: { type: 'object', properties: {} },
    execute() { return boardSnapshot(); },
  },

  check_plan: {
    name: 'check_plan',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      'Run the board\'s structural checks: unreachable nodes, dead ends, decisions with only one '
      + 'branch, loops, circular justification, every route through the plan, unsettled '
      + 'assumptions, objections nobody answered, and what a rejection has made stale. These are '
      + 'facts about the graph, not opinions. Reading them and saying what they mean is your job.',
    inputSchema: {
      type: 'object',
      properties: {
        include_routes: { type: 'boolean', description: 'list every route through the plan in full' },
      },
    },
    execute(args) {
      const s = requireScene();
      const report = analyze(s);
      const out = {
        revision: report.rev, counts: report.counts, summary: report.summary,
        agreed: report.agreed, stale: report.stale,
        route_count: report.paths.count,
        findings: report.findings.map(f => ({
          check: f.check, severity: f.severity, ids: f.ids,
          says: f.message, why_it_matters: f.why,
        })),
      };
      if (args?.include_routes) {
        out.routes = report.paths.paths.map(p => p.map(x => x.label));
      }
      return out;
    },
  },

  list_open_items: {
    name: 'list_open_items',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      'The queue: objections the human made that you have not answered, assumptions nobody has '
      + 'ruled on, nodes they rejected, and anything the checks call an error. Work this list '
      + 'before drawing anything new.',
    inputSchema: { type: 'object', properties: {} },
    execute() {
      const s = requireScene();
      const report = analyze(s);
      const unanswered = s.comments().filter(c =>
        !c.resolved && !c.replies.some(r => r.author !== c.author));
      const awaiting = s.comments().filter(c =>
        !c.resolved && c.replies.some(r => r.author !== c.author));
      return {
        revision: s.rev,
        unanswered_objections: unanswered.map(c => ({
          ...describeComment(c),
          about: s.has(c.anchor) ? s.get(c.anchor).label : c.anchor,
        })),
        answered_but_open: awaiting.map(c => ({ id: c.id, anchor: c.anchor, body: c.body })),
        unsettled_assumptions: s.stickies()
          .filter(x => x.state === 'unverified')
          .map(x => ({ id: x.id, kind: x.kind, text: x.label, anchor: x.anchor })),
        rejected_by_human: s.nodes()
          .filter(n => n.status === 'rejected' && n.updated_by && n.updated_by !== 'agent')
          .map(n => ({ id: n.id, label: n.label, because: n.rejected_because || null })),
        stale_because_of_a_rejection: report.stale.map(id => ({ id, label: s.get(id).label })),
        errors: report.findings.filter(f => f.severity === 'error')
          .map(f => ({ check: f.check, ids: f.ids, says: f.message })),
        nothing_outstanding:
          unanswered.length === 0 && report.summary.error === 0
          && s.stickies().every(x => x.state !== 'unverified'),
      };
    },
  },

  reply_to_comment: {
    name: 'reply_to_comment',
    annotations: { untrustedContentHint: true },
    description:
      'Answer an objection in the thread where it was made. Answer it, do not resolve it: '
      + 'whether the objection is dealt with is the human\'s call, not yours.',
    inputSchema: {
      type: 'object',
      required: ['id', 'body'],
      properties: { id: { type: 'string' }, body: { type: 'string' } },
    },
    execute(args) {
      const s = requireScene();
      const c = s.reply(args.id, { body: args.body, author: 'agent' });
      onChange();
      return { id: c.id, replies: c.replies.length, resolved: c.resolved, revision: s.rev };
    },
  },

  revise: {
    name: 'revise',
    annotations: { untrustedContentHint: true },
    description:
      'Change the board in response to review, in one call: relabel nodes, reject them with a '
      + 'reason, add edges, or remove edges. Node ids stay the same, so the comments made on them '
      + 'stay attached. Removing a node is a separate tool on purpose.',
    inputSchema: {
      type: 'object',
      properties: {
        because: { type: 'string', description: 'which comment or objection this revision answers' },
        relabel: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' } },
          },
        },
        reject: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'because'],
            properties: { id: { type: 'string' }, because: { type: 'string' } },
          },
        },
        agree: { type: 'array', items: { type: 'string' }, description: 'node ids now settled' },
        connect: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string' }, to: { type: 'string' },
              label: { type: 'string' },
              kind: { type: 'string', enum: ['flow', 'derives'] },
            },
          },
        },
        disconnect: { type: 'array', items: { type: 'string' }, description: 'edge ids to remove' },
      },
    },
    execute(args) {
      const s = requireScene();
      const done = { relabelled: [], rejected: [], agreed: [], connected: [], disconnected: [] };
      for (const r of listOf(args.relabel)) {
        s.relabel(r.id, { label: r.label, detail: r.detail, author: 'agent' });
        done.relabelled.push(r.id);
      }
      for (const r of listOf(args.reject)) {
        s.setStatus(r.id, 'rejected', { author: 'agent', because: r.because });
        done.rejected.push(r.id);
      }
      for (const id of listOf(args.agree)) {
        s.setStatus(id, 'agreed', { author: 'agent' });
        done.agreed.push(id);
      }
      for (const c of listOf(args.connect)) {
        done.connected.push(s.addEdge({
          from: c.from, to: c.to, label: c.label || '',
          kind: c.kind || 'flow', author: 'agent',
        }).id);
      }
      for (const id of listOf(args.disconnect)) {
        const e = s.get(id);
        if (e.type !== 'edge') throw new Error(`${id} is a ${e.type}; disconnect takes edge ids`);
        s.remove(id, { author: 'agent' });
        done.disconnected.push(id);
      }
      onChange();
      return { ...done, revision: s.rev, check: summarise(analyze(s)) };
    },
  },

  remove_element: {
    name: 'remove_element',
    annotations: { untrustedContentHint: true },
    description:
      'Delete a node and everything that only existed because of it. Needs the human at the board '
      + 'to confirm, and reports exactly what went with it, because deleting something a person '
      + 'commented on destroys the record of the objection.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, because: { type: 'string' } },
    },
    async execute(args) {
      const s = requireScene();
      const target = s.get(args.id);
      const attached = s.comments().filter(c => c.anchor === args.id);
      await confirm(
        `Delete "${target.label || target.body}"?`
        + (attached.length ? ` ${attached.length} comment(s) on it would go too.` : '')
        + (args.because ? ` Reason given: ${args.because}` : ''));
      const removed = s.remove(args.id, { author: 'agent' });
      onChange();
      return { removed, revision: s.rev };
    },
  },
};

function summarise(report) {
  return {
    errors: report.summary.error,
    warnings: report.summary.warn,
    top: report.findings.slice(0, 4).map(f => `${f.severity}: ${f.message}`),
  };
}

// --- modes ----------------------------------------------------------------
//
// The difference between these two lists is the security story. In review mode
// draw_plan and remove_element are not merely hidden from the tool list, they
// are refused if called, because a hidden-but-callable tool is not a boundary.

export const MODES = {
  draft: {
    label: 'Drafting',
    hint: 'The agent is drawing. It can create, connect and explain.',
    tools: [
      'draw_plan', 'add_step', 'connect', 'add_note', 'propose_options', 'decide_option',
      'explain_node', 'get_board', 'check_plan', 'list_open_items', 'reply_to_comment',
      'revise', 'remove_element',
    ],
  },
  review: {
    label: 'Under review',
    hint: 'A human is marking the board up. The agent can answer and revise, but it cannot '
      + 'redraw the board or delete anything that was commented on.',
    tools: [
      'get_board', 'check_plan', 'list_open_items', 'reply_to_comment', 'revise',
      'add_step', 'connect', 'add_note', 'explain_node',
    ],
  },
};

// --- registration ---------------------------------------------------------

/**
 * The spec puts this on `document`. Chromium's Origin Trial builds also carry
 * `navigator.modelContext`, and the polyfill installs on `document`, so both
 * are checked rather than betting on one.
 * @see https://webmachinelearning.github.io/webmcp/#modelcontext
 */
function modelContext() {
  return globalThis.document?.modelContext || globalThis.navigator?.modelContext || null;
}

/** Which surface answered, for the badge in the header. */
export function hostKind() {
  if (globalThis.document?.modelContext) return 'document.modelContext';
  if (globalThis.navigator?.modelContext) return 'navigator.modelContext';
  return null;
}

export function register(tool) {
  if (registered.has(tool.name)) return registered.get(tool.name);
  const mc = modelContext();
  // registerTool resolves to undefined, so there is no handle to keep. Removal
  // is done by aborting the signal the tool was registered with, which is the
  // only withdrawal mechanism the spec has.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  if (mc?.registerTool) {
    try {
      const result = mc.registerTool(hostFacing(tool),
        controller ? { signal: controller.signal } : undefined);
      // A rejection here is the host refusing the tool, and a tool the host
      // does not have must not sit in the registry as though it does.
      if (result && typeof result.catch === 'function') {
        result.catch(err => {
          console.warn(`host refused ${tool.name}:`, err?.message || err);
          registered.delete(tool.name);
        });
      }
    } catch (err) { console.warn(`could not register ${tool.name}:`, err.message); }
  }
  registered.set(tool.name, controller);
  return controller;
}

/**
 * Withdraws a tool for the current mode.
 *
 * There is no removal method in Chrome 152, and the promise `registerTool`
 * returns is not a handle either, so "unregister" often cannot mean "take it
 * off the host's list". When it cannot, the tool is replaced in place by one
 * that carries the same name and refuses, explaining which mode withdrew it.
 *
 * That is better than leaving the original registered and relying on the
 * in-page check alone: an agent reading the host's tool list would otherwise
 * see a working `draw_plan` during review, call it, and get an error it has no
 * way to interpret.
 */
export function unregister(name) {
  if (!registered.has(name)) return false;
  const controller = registered.get(name);
  const mc = modelContext();
  let removed = false;
  try {
    if (controller && typeof controller.abort === 'function') { controller.abort(); removed = true; }
    else if (typeof mc?.unregisterTool === 'function') { mc.unregisterTool(name); removed = true; }
  } catch (err) { console.warn(`could not unregister ${name}:`, err.message); }

  registered.delete(name);
  // No second registration is needed to enforce this. Whether or not the host
  // honoured the signal, the tool it holds is the wrapper from hostFacing, and
  // that refuses on its own.
  if (!removed) {
    console.warn(`${name} was withdrawn; the host may still list it, `
      + 'in which case calling it will be refused.');
  }
  return true;
}

/**
 * What the host actually gets. The execute it receives goes through callTool
 * rather than straight to the implementation, so a host that keeps a tool
 * after its signal aborted still meets the mode check and the argument check.
 * Withdrawal then does not depend on the host honouring anything.
 */
function hostFacing(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    execute: input => callTool(tool.name, input || {}),
  };
}

const currentModeLabel = () => MODES[currentMode]?.label || currentMode;

export const registeredToolNames = () => [...registered.keys()];
export const getMode = () => currentMode;

export function setMode(mode) {
  if (!MODES[mode]) throw new Error(`unknown mode: ${mode}`);
  const wanted = new Set(MODES[mode].tools);
  for (const name of wanted) {
    if (!TOOLS[name]) throw new Error(`mode "${mode}" lists a tool that does not exist: ${name}`);
  }
  // The mode changes first so that a refusal explains itself in terms of the
  // mode being entered, and the surviving tools register before the withdrawn
  // ones leave, so the refusal can list what is available instead.
  const leaving = registeredToolNames().filter(name => !wanted.has(name));
  currentMode = mode;
  for (const name of wanted) register(TOOLS[name]);
  for (const name of leaving) unregister(name);
  return { mode, tools: registeredToolNames().sort() };
}

/**
 * The in-page call path, used by the demo controls and the tests.
 *
 * There is deliberately no fallback to TOOLS here. An earlier version had one,
 * which meant a tool withdrawn by the current mode was still callable: the mode
 * looked like a boundary and was not one.
 */
export async function callTool(name, args = {}) {
  if (!registered.has(name)) {
    throw new Error(
      `"${name}" is not available in ${currentMode} mode. available: ${registeredToolNames().sort().join(', ')}`);
  }
  const tool = TOOLS[name];
  if (!tool) throw new Error(`"${name}" is registered but has no implementation`);
  rejectUnknownArgs(tool, args);
  return tool.execute(args);
}

/**
 * An argument the tool does not read is a change that silently did not happen.
 * A near miss on a key name is the likely cause, so the error names both what
 * was sent and what was expected rather than leaving the agent to believe the
 * success it just got back.
 */
function rejectUnknownArgs(tool, args) {
  const known = Object.keys(tool.inputSchema?.properties || {});
  if (!known.length || !args || typeof args !== 'object') return;
  const strays = Object.keys(args).filter(k => !known.includes(k));
  if (!strays.length) return;
  throw new Error(
    `"${tool.name}" does not take ${strays.join(', ')}. it takes: ${known.sort().join(', ')}`);
}
