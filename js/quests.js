import { awardXP } from './progression.js';
import { addLog }  from './combat.js';

const _STORAGE_KEY = 'dnd-quests';

// ── Quest state ───────────────────────────────────────────────────────────────
const _quests = [];
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

export function addQuest(id, title, description, reward = null) {
  if (_quests.find(q => q.id === id)) return;
  _quests.push({ id, title, description, reward, status: 'active', open: false });
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

// Call this on a "new run" to wipe quest progress
export function resetQuests() {
  _quests.length = 0;
  try { localStorage.removeItem(_STORAGE_KEY); } catch {}
  _render();
}

// ── Persistence ───────────────────────────────────────────────────────────────

function _save() {
  try {
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(
      _quests.map(q => ({ id: q.id, title: q.title, description: q.description,
                          reward: q.reward, status: q.status }))
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
  html += active.map(_questHtml).join('');
  if (done.length) {
    html += '<div class="ql-section-done">COMPLETED</div>';
    html += done.map(_questHtml).join('');
  }
  _panelEl.innerHTML = html;

  _panelEl.querySelectorAll('.ql-row').forEach(row => {
    row.addEventListener('click', () => {
      const q = _quests.find(q => q.id === row.dataset.quest);
      if (q) { q.open = !q.open; _render(); }
    });
  });
}

function _questHtml(q) {
  const arrow     = q.open ? '&#9660;' : '&#9658;';
  const doneClass = q.status === 'completed' ? ' ql-done' : '';
  const openClass = q.open ? ' ql-open' : '';
  const descHtml  = q.open ? '<div class="ql-desc">' + q.description + '</div>' : '';
  return '<div class="ql-item' + doneClass + openClass + '">'
    + '<div class="ql-row" data-quest="' + q.id + '">'
    + '<span class="ql-arrow">' + arrow + '</span>'
    + '<span class="ql-name">' + q.title + '</span>'
    + '</div>' + descHtml + '</div>';
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
