// Each fixture plants exactly one defect, so a finding cannot be explained by a
// neighbouring defect. The first fixture plants none: it exists to catch false
// positives, which is the failure mode that actually destroys trust in a
// review tool.

import { createScene } from '../src/lib/scene.js';
import { analyze } from '../src/lib/analyze.js';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}
function checks(report, name) {
  return report.findings.filter(f => f.check === name);
}
function ids(report, name) {
  return checks(report, name).flatMap(f => f.ids);
}
const section = s => console.log(`\n${s}`);

// --- fixture 0: a correct plan must produce nothing -----------------------
section('a plan with no defects');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Request arrives', kind: 'entry', status: 'agreed' });
  const parse = s.addNode({ label: 'Parse body', status: 'agreed' });
  const valid = s.addNode({ label: 'Valid?', kind: 'decision', status: 'agreed' });
  const save = s.addNode({ label: 'Save record', status: 'agreed' });
  const reject = s.addNode({ label: 'Return 400', status: 'agreed' });
  const done = s.addNode({ label: 'Response sent', kind: 'terminal', status: 'agreed' });
  s.addEdge({ from: entry.id, to: parse.id });
  s.addEdge({ from: parse.id, to: valid.id });
  s.addEdge({ from: valid.id, to: save.id, label: 'yes' });
  s.addEdge({ from: valid.id, to: reject.id, label: 'no' });
  s.addEdge({ from: save.id, to: done.id });
  s.addEdge({ from: reject.id, to: done.id });
  const a = s.addSticky({ kind: 'assumption', anchor: parse.id, label: 'body is JSON' });
  s.setStickyState(a.id, 'confirmed');
  const c = s.addComment({ anchor: valid.id, body: 'what counts as valid?' });
  s.reply(c.id, { body: 'schema check, see sticky' });
  s.resolveComment(c.id);

  const r = analyze(s);
  ok('no errors', r.summary.error === 0, JSON.stringify(checks(r, 'x') || r.findings.map(f => f.check)));
  ok('no warnings', r.summary.warn === 0, r.findings.filter(f => f.severity === 'warn').map(f => f.check).join(','));
  ok('both routes found', r.paths.count === 2, `got ${r.paths.count}`);
  ok('reports agreed', r.agreed === true);
}

// --- unreachable ----------------------------------------------------------
section('a node nothing can reach');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const live = s.addNode({ label: 'Live step', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: live.id });
  const orphanA = s.addNode({ label: 'Forgotten worker' });
  const orphanB = s.addNode({ label: 'Its output', kind: 'terminal' });
  s.addEdge({ from: orphanA.id, to: orphanB.id });

  const r = analyze(s);
  const flagged = ids(r, 'unreachable');
  ok('downstream orphan flagged', flagged.includes(orphanB.id));
  ok('root orphan flagged', flagged.includes(orphanA.id));
  ok('live node not flagged', !flagged.includes(live.id));
  ok('declared entry not flagged', !flagged.includes(entry.id));
}

// --- dead end -------------------------------------------------------------
section('flow that stops without saying so');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const stops = s.addNode({ label: 'Charge card' });
  const ends = s.addNode({ label: 'Done', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: stops.id });
  s.addEdge({ from: entry.id, to: ends.id });

  const r = analyze(s);
  ok('unterminated step flagged', ids(r, 'dead_end').includes(stops.id));
  ok('terminal node not flagged', !ids(r, 'dead_end').includes(ends.id));
}

// --- unhandled branch -----------------------------------------------------
section('a decision with only a happy path');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const oneWay = s.addNode({ label: 'Payment ok?', kind: 'decision' });
  const twoWay = s.addNode({ label: 'Retry?', kind: 'decision' });
  const a = s.addNode({ label: 'Ship it', kind: 'terminal' });
  const b = s.addNode({ label: 'Give up', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: oneWay.id });
  s.addEdge({ from: oneWay.id, to: twoWay.id });
  s.addEdge({ from: twoWay.id, to: a.id, label: 'yes' });
  s.addEdge({ from: twoWay.id, to: b.id, label: 'no' });

  const r = analyze(s);
  ok('one-branch decision flagged', ids(r, 'unhandled_branch').includes(oneWay.id));
  ok('two-branch decision not flagged', !ids(r, 'unhandled_branch').includes(twoWay.id));
}

// --- cycles ---------------------------------------------------------------
section('loops in control and in reasoning');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const a = s.addNode({ label: 'Poll' });
  const b = s.addNode({ label: 'Wait' });
  s.addEdge({ from: entry.id, to: a.id });
  s.addEdge({ from: a.id, to: b.id });
  s.addEdge({ from: b.id, to: a.id });

  const r = analyze(s);
  const cyc = ids(r, 'cycle');
  ok('control loop found', cyc.includes(a.id) && cyc.includes(b.id));
  ok('loop reported once', checks(r, 'cycle').length === 1, `got ${checks(r, 'cycle').length}`);
}
{
  const s = createScene();
  const x = s.addNode({ label: 'We need a queue', kind: 'entry' });
  const y = s.addNode({ label: 'Because writes are slow' });
  s.addEdge({ from: x.id, to: y.id, kind: 'derives' });
  s.addEdge({ from: y.id, to: x.id, kind: 'derives' });

  const r = analyze(s);
  ok('circular justification found', checks(r, 'circular_reasoning').length === 1);
  ok('circular reasoning is an error', checks(r, 'circular_reasoning')[0].severity === 'error');
}

// --- comments -------------------------------------------------------------
section('objections the agent walked past');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const billing = s.addNode({ label: 'Billing service', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: billing.id });

  const ignored = s.addComment({ anchor: billing.id, author: 'manish',
    body: 'this does not seem fine, you are not building billing here' });
  const answered = s.addComment({ anchor: entry.id, author: 'manish', body: 'entry from where?' });
  s.reply(answered.id, { body: 'the webhook', author: 'agent' });
  const selfReplied = s.addComment({ anchor: entry.id, author: 'manish', body: 'and the timeout?' });
  s.reply(selfReplied.id, { body: 'bumping this', author: 'manish' });

  const r = analyze(s);
  const flagged = ids(r, 'unanswered_comment');
  ok('ignored objection flagged', flagged.includes(ignored.id));
  ok('answered comment not flagged', !flagged.includes(answered.id));
  ok('a reply from the same author does not count as an answer', flagged.includes(selfReplied.id));
  ok('unanswered objection is an error', checks(r, 'unanswered_comment')[0].severity === 'error');
}

// --- stale cascade --------------------------------------------------------
section('what a rejection invalidated downstream');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const premise = s.addNode({ label: 'Government publishes a structured list' });
  const built = s.addNode({ label: 'Nightly ingest job' });
  const deeper = s.addNode({ label: 'Search index', kind: 'terminal' });
  const unrelated = s.addNode({ label: 'Static about page', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: premise.id });
  s.addEdge({ from: premise.id, to: built.id });
  s.addEdge({ from: built.id, to: deeper.id });
  s.addEdge({ from: entry.id, to: unrelated.id });
  s.setStatus(premise.id, 'rejected', { because: 'the list is a PDF of scanned images' });

  const r = analyze(s);
  ok('direct dependant is stale', r.stale.includes(built.id));
  ok('transitive dependant is stale', r.stale.includes(deeper.id));
  ok('the rejected node is not itself stale', !r.stale.includes(premise.id));
  ok('an unrelated branch stays fresh', !r.stale.includes(unrelated.id));
  ok('rejected node is not reported unreachable', !ids(r, 'unreachable').includes(premise.id));
}
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const step = s.addNode({ label: 'Match names phonetically' });
  const after = s.addNode({ label: 'Show ranked results', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: step.id });
  s.addEdge({ from: step.id, to: after.id });
  const a = s.addSticky({ kind: 'assumption', anchor: step.id, label: 'names arrive romanised' });
  s.setStickyState(a.id, 'denied');

  const r = analyze(s);
  ok('denying an assumption stales what it supported', r.stale.includes(after.id));
}

// --- stickies -------------------------------------------------------------
section('the agent held to its own assumptions');
{
  const s = createScene();
  const n = s.addNode({ label: 'Only node', kind: 'entry' });
  const open = s.addSticky({ kind: 'assumption', anchor: n.id, label: 'traffic is under 100 rps' });
  const floating = s.addSticky({ kind: 'note', label: 'we should think about scale sometime' });
  const settled = s.addSticky({ kind: 'assumption', anchor: n.id, label: 'single region' });
  s.setStickyState(settled.id, 'confirmed');

  const r = analyze(s);
  ok('unruled assumption flagged', ids(r, 'unverified_assumption').includes(open.id));
  ok('settled assumption not flagged', !ids(r, 'unverified_assumption').includes(settled.id));
  ok('unanchored note flagged', ids(r, 'orphan_sticky').includes(floating.id));
  ok('anchored sticky not flagged as orphan', !ids(r, 'orphan_sticky').includes(open.id));
}

// --- edges left dangling by hand-edited or replicated state --------------
section('an edge pointing at nothing');
{
  const s = createScene({
    rev: 9,
    seq: { n: 2, e: 1, s: 0, c: 0 },
    elements: [
      { id: 'n1', type: 'node', kind: 'entry', label: 'Start', status: 'agreed', ver: 1 },
      { id: 'e1', type: 'edge', kind: 'flow', from: 'n1', to: 'n2', label: '', ver: 1 },
    ],
  });
  const r = analyze(s);
  ok('dangling edge flagged', ids(r, 'unbound_edge').includes('e1'));
  ok('dangling edge is an error', checks(r, 'unbound_edge')[0].severity === 'error');
  ok('analysis survives a broken graph', typeof r.summary.error === 'number');
}

// --- path enumeration -----------------------------------------------------
section('routes a coder has to walk');
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const d1 = s.addNode({ label: 'Cached?', kind: 'decision' });
  const d2 = s.addNode({ label: 'Authorised?', kind: 'decision' });
  const done = s.addNode({ label: 'Respond', kind: 'terminal' });
  const denied = s.addNode({ label: 'Deny', kind: 'terminal' });
  s.addEdge({ from: entry.id, to: d1.id });
  s.addEdge({ from: d1.id, to: done.id, label: 'hit' });
  s.addEdge({ from: d1.id, to: d2.id, label: 'miss' });
  s.addEdge({ from: d2.id, to: done.id, label: 'yes' });
  s.addEdge({ from: d2.id, to: denied.id, label: 'no' });

  const r = analyze(s);
  ok('three routes enumerated', r.paths.count === 3, `got ${r.paths.count}`);
  ok('routes carry labels a human can read', r.paths.paths[0][0].label === 'Start');
  ok('longest route measured', r.paths.longest === 4, `got ${r.paths.longest}`);
}
{
  const s = createScene();
  const entry = s.addNode({ label: 'Start', kind: 'entry' });
  const a = s.addNode({ label: 'A' });
  const b = s.addNode({ label: 'B' });
  s.addEdge({ from: entry.id, to: a.id });
  s.addEdge({ from: a.id, to: b.id });
  s.addEdge({ from: b.id, to: a.id });
  const r = analyze(s);
  ok('a cyclic graph does not hang path enumeration', r.paths.count >= 1 && r.paths.count < 200);
}

// --- deletion blast radius ------------------------------------------------
section('deleting a node reports what went with it');
{
  const s = createScene();
  const a = s.addNode({ label: 'A', kind: 'entry' });
  const b = s.addNode({ label: 'B', kind: 'terminal' });
  const edge = s.addEdge({ from: a.id, to: b.id });
  const note = s.addSticky({ kind: 'risk', anchor: b.id, label: 'this is the risky one' });
  const comment = s.addComment({ anchor: b.id, body: 'do not build this' });
  const removed = s.remove(b.id).map(x => x.id);

  ok('the node itself is removed', removed.includes(b.id));
  ok('its edge goes with it', removed.includes(edge.id));
  ok('its sticky goes with it', removed.includes(note.id));
  ok('its comment goes with it, and is reported', removed.includes(comment.id));
  ok('the untouched node survives', s.has(a.id));
  ok('nothing dangles afterwards', analyze(s).findings.every(f => f.check !== 'unbound_edge'));
}

// --- invariants -----------------------------------------------------------
section('writes that must be refused');
function throws(label, fn, match) {
  try { fn(); ok(label, false, 'no error thrown'); }
  catch (e) { ok(label, !match || e.message.includes(match), e.message); }
}
{
  const s = createScene();
  const a = s.addNode({ label: 'A', kind: 'entry' });
  throws('unanchored comment refused', () => s.addComment({ body: 'vibes' }), 'unanchored chat');
  throws('unknown node kind refused', () => s.addNode({ label: 'x', kind: 'wormhole' }), 'kind must be one of');
  throws('empty label refused', () => s.addNode({ label: '   ' }), 'label is required');
  throws('self edge refused', () => s.addEdge({ from: a.id, to: a.id }), 'cannot connect a node to itself');
  throws('edge to a missing node refused', () => s.addEdge({ from: a.id, to: 'n99' }), 'no element "n99"');
  const b = s.addNode({ label: 'B' });
  s.addEdge({ from: a.id, to: b.id });
  throws('duplicate edge refused', () => s.addEdge({ from: a.id, to: b.id }), 'already exists');
  const note = s.addSticky({ kind: 'note', anchor: a.id, label: 'plain note' });
  throws('a plain note cannot be confirmed', () => s.setStickyState(note.id, 'confirmed'), 'only assumptions and questions');
  const c = s.addComment({ anchor: a.id, body: 'q' });
  s.resolveComment(c.id);
  throws('double resolve refused', () => s.resolveComment(c.id), 'already resolved');
  throws('comment cannot anchor to a comment', () => s.addComment({ anchor: c.id, body: 'meta' }), 'cannot anchor to a comment');
}

// --- re-grounding after a rejection ---------------------------------------
section('agreeing a step clears the staleness it inherited');
{
  const s = createScene();
  const bad = s.addNode({ label: 'Ingest the official feed', kind: 'entry' });
  const good = s.addNode({ label: 'Family pastes the document', kind: 'entry' });
  const parse = s.addNode({ label: 'Parse it' });
  const show = s.addNode({ label: 'Show the record', kind: 'terminal' });
  s.addEdge({ from: bad.id, to: parse.id });
  s.addEdge({ from: good.id, to: parse.id });
  s.addEdge({ from: parse.id, to: show.id });
  s.setStatus(bad.id, 'rejected', { because: 'there is no feed' });

  let r = analyze(s);
  ok('before re-grounding, downstream work is stale', r.stale.includes(parse.id));
  ok('and so is what came after it', r.stale.includes(show.id));

  s.setStatus(parse.id, 'agreed', { author: 'manish' });
  r = analyze(s);
  ok('agreeing the step clears its own staleness', !r.stale.includes(parse.id));
  ok('and stops it spreading further', !r.stale.includes(show.id), r.stale.join(','));

  ok('routes skip the dropped step',
    r.paths.paths.every(p => !p.some(x => x.id === bad.id)));
  ok('and still find the surviving route', r.paths.count === 1, `got ${r.paths.count}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
