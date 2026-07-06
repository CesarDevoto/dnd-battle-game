export const IS_DEV = import.meta.env.VITE_DEV_MODE === 'true';

// Runtime dev/edit-mode toggle (distinct from the IS_DEV build flag above).
// Lives here rather than in devMode.js so scene.js can read it without a
// circular import (devMode.js already imports from scene.js).
let _editModeActive = IS_DEV;
export function setEditModeActive(v) { _editModeActive = v; }
export function isEditModeActive()   { return _editModeActive; }
