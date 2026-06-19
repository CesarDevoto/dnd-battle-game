export function initXPTable() {
  const overlay  = document.getElementById('xp-table-overlay');
  const closeBtn = document.getElementById('xp-table-close');
  const openBtn  = document.getElementById('xp-table-btn');

  openBtn.addEventListener('click', () => overlay.classList.add('show'));
  closeBtn.addEventListener('click', () => overlay.classList.remove('show'));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') overlay.classList.remove('show');
  });
}
