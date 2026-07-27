import { awardXP } from './progression.js';
import { addLog }  from './combat.js';

const _STORAGE_KEY = 'dnd-quests';
const _FLAGS_KEY   = 'dnd-quest-flags';

// ── Quest state ───────────────────────────────────────────────────────────────
const _quests      = [];
const _questActions = {};  // id → { label, onClick }
let _panelEl  = null;
let _btnEl    = null;
let _visible  = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function initQuests() {
  _panelEl = document.getElementById('quest-log');
  _btnEl   = document.getElementById('quest-log-btn');
  _btnEl?.addEventListener('click', () => _setVisible(!_visible));

  // Restore persisted quests; auto-show panel if any are still active
  _load();

  // Starting quest — heroes already have this job at game open.
  // addQuest's duplicate guard + localStorage mean it only ever adds once.
  addQuest('deliver_provisions', 'Deliver the Provisions',
    "Deliver Gundren Rockseeker's wagon of mining supplies to Barthen's Provisions in Phandalin.");

  if (_quests.some(q => q.status === 'active')) _setVisible(true);
}

// `parent` (a quest id) makes this a SUBQUEST: it renders indented beneath its
// parent instead of as a top-level entry, and follows the parent between the
// active and completed sections. An unknown/absent parent falls back to
// top-level, so a subquest added before its parent still shows up.
export function addQuest(id, title, description, reward = null, parent = null) {
  if (_quests.find(q => q.id === id)) return;
  _quests.push({ id, title, description, reward, parent, status: 'active', open: false });
  _save();
  _render();
  if (!_visible) _setVisible(true);
}

export function completeQuest(id, reward = null) {
  const q = _quests.find(q => q.id === id);
  if (!q || q.status === 'completed') return;
  q.status = 'completed';
  if (reward) q.reward = reward;
  _save();
  _render();
  _showCompleteFloat(q.title, q.reward);
  if (q.reward?.xp) awardXP(q.reward.xp, addLog);
}

export function openQuestPanel()  { _setVisible(true); }

export function setQuestAction(id, label, onClick) {
  _questActions[id] = { label, onClick };
  _render();
}

export function clearQuestAction(id) {
  delete _questActions[id];
  _render();
}

export function expandQuest(id) {
  const q = _quests.find(q => q.id === id);
  if (q) { q.open = true; _render(); }
}

// Call this on a "new run" to wipe quest progress
export function resetQuests() {
  _quests.length = 0;
  try { localStorage.removeItem(_STORAGE_KEY); } catch {}
  try { localStorage.removeItem(_FLAGS_KEY); } catch {}
  _render();
}

// ── Quest flags ───────────────────────────────────────────────────────────────
// Named boolean markers that record choices and stage completions within quests.
// Gate continuation content: if (!getQuestFlag('goblin_pursuit')) return;

function _loadFlags() {
  try { return new Set(JSON.parse(localStorage.getItem(_FLAGS_KEY) ?? '[]')); } catch { return new Set(); }
}
function _saveFlags(set) {
  try { localStorage.setItem(_FLAGS_KEY, JSON.stringify([...set])); } catch {}
}

export function setQuestFlag(flag) {
  const s = _loadFlags();
  s.add(flag);
  _saveFlags(s);
}

export function getQuestFlag(flag) {
  return _loadFlags().has(flag);
}

// ── Persistence ───────────────────────────────────────────────────────────────

function _save() {
  try {
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(
      _quests.map(q => ({ id: q.id, title: q.title, description: q.description,
                          reward: q.reward, parent: q.parent ?? null, status: q.status }))
    ));
  } catch {}
}

function _load() {
  try {
    const raw = localStorage.getItem(_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    saved.forEach(q => {
      if (!_quests.find(x => x.id === q.id)) {
        _quests.push({ ...q, open: false });
      }
    });
  } catch {}
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _setVisible(v) {
  _visible = v;
  _panelEl?.classList.toggle('show', v);
  _btnEl?.classList.toggle('active', v);
}

function _render() {
  if (!_panelEl) return;

  const active = _quests.filter(q => q.status === 'active');
  const done   = _quests.filter(q => q.status === 'completed');

  let html = '<div class="ql-title">QUESTS</div>';
  html += _sectionHtml(active);
  if (done.length) {
    html += '<div class="ql-section-done">COMPLETED</div>';
    html += _sectionHtml(done);
  }
  _panelEl.innerHTML = html;

  _panelEl.querySelectorAll('.ql-row').forEach(row => {
    row.addEventListener('click', () => {
      const q = _quests.find(q => q.id === row.dataset.quest);
      if (q) { q.open = !q.open; _render(); }
    });
  });

  _panelEl.querySelectorAll('.ql-action-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _questActions[btn.dataset.questAction]?.onClick?.();
    });
  });
}

// Renders one status section with each subquest tucked under its parent.
// A subquest whose parent is in the OTHER section (parent still active while the
// child is done, or vice versa) would otherwise vanish, so anything left over is
// emitted at top level rather than dropped.
function _sectionHtml(list) {
  const ids  = new Set(list.map(q => q.id));
  const kids = q => list.filter(c => c.parent === q.id);
  const out  = [];
  for (const q of list) {
    if (q.parent && ids.has(q.parent)) continue;   // rendered under its parent below
    out.push(_questHtml(q) + kids(q).map(c => _questHtml(c, true)).join(''));
  }
  return out.join('');
}

function _questHtml(q, isSub = false) {
  const arrow     = q.open ? '&#9660;' : '&#9658;';
  const doneClass = q.status === 'completed' ? ' ql-done' : '';
  const openClass = q.open ? ' ql-open' : '';
  const descHtml  = q.open ? '<div class="ql-desc">' + q.description + '</div>' : '';
  const action    = _questActions[q.id];
  const btnHtml   = (q.open && action)
    ? `<button class="ql-action-btn" data-quest-action="${q.id}">${action.label}</button>`
    : '';
  return '<div class="ql-item' + doneClass + openClass + (isSub ? ' ql-sub' : '') + '">'
    + '<div class="ql-row" data-quest="' + q.id + '">'
    + '<span class="ql-arrow">' + arrow + '</span>'
    + '<span class="ql-name">' + q.title + '</span>'
    + '</div>' + descHtml + btnHtml + '</div>';
}

function _showCompleteFloat(title, reward) {
  const el = document.createElement('div');
  el.className = 'quest-complete-float';
  let text = 'QUEST COMPLETE\n' + title;
  if (reward && reward.xp)   text += '\n+' + reward.xp + ' XP';
  if (reward && reward.loot) text += '\n' + reward.loot;
  el.textContent = text;
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('ql-float-in'));
  setTimeout(() => el.classList.add('ql-float-out'), 3500);
  setTimeout(() => el.remove(), 5000);
}
