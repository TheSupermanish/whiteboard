// ---------------------------------------------------------------------------
// The pieces the sidebar and the cards both need: a comment thread with its
// reply box and its one human-only button, and the composer itself.
//
// Only a person can settle an objection. The agent has reply_to_comment and
// nothing else, so "Settled" exists here and has no counterpart in the tool
// surface.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';

export const YOU = 'you';

export function Comment({ comment, scene, onSelect, act }) {
  const answered = comment.replies.some(r => r.author !== comment.author);
  return (
    <div className={`card ${comment.resolved ? 'info' : answered ? 'warn' : 'err'}`}>
      <div className="card-top">
        <span className={`who ${comment.author === 'agent' ? 'agent' : 'human'}`}>{comment.author}</span>
        <button className="about link" onClick={() => onSelect(comment.anchor)}>
          on {labelOf(scene, comment.anchor)}
        </button>
      </div>
      <div className="body">{comment.body}</div>
      {comment.replies.length > 0 ? (
        <div className="thread">
          {comment.replies.map((r, i) => (
            <div className="reply" key={i}>
              <span className={`who ${r.author === 'agent' ? 'agent' : 'human'}`}>{r.author}</span>
              {r.body}
            </div>
          ))}
        </div>
      ) : (
        <div className="why">Waiting for the agent to answer this.</div>
      )}
      {!comment.resolved && (
        <>
          <Say small placeholder="Reply&hellip;" label="Reply"
            onSay={body => act.reply(comment.id, body)} />
          <div className="actions">
            <button className="mini good" onClick={() => act.resolve(comment.id)}>Settled</button>
          </div>
        </>
      )}
      {comment.resolved && <div className="why">Settled by {comment.resolved_by}.</div>}
    </div>
  );
}

export function Say({ placeholder, label, onSay, small }) {
  const [text, setText] = useState('');
  const box = useRef(null);
  useEffect(() => { if (!small) box.current?.focus({ preventScroll: true }); }, [small]);

  const send = () => {
    const body = text.trim();
    if (!body) { box.current?.focus(); return; }
    onSay(body);
    setText('');
  };

  return (
    <>
      <textarea
        ref={box}
        className={`say${small ? ' small' : ''}`}
        placeholder={placeholder}
        value={text}
        onChange={ev => setText(ev.target.value)}
        onKeyDown={ev => {
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); send(); }
        }}
      />
      <div className="actions">
        <button className="mini" onClick={send}>{label}</button>
        <span className="kbd-hint">or {navigator.platform.includes('Mac') ? '⌘' : 'ctrl'}+enter</span>
      </div>
    </>
  );
}

function labelOf(scene, id) {
  if (!id || !scene.has(id)) return id || 'the board';
  const e = scene.get(id);
  return shorten(e.label || e.body || id, 34);
}
