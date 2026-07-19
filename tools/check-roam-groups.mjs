#!/usr/bin/env node
//
// check-roam-groups.mjs — validate enemy ROAM GROUPS in zone files.
//
//   node tools/check-roam-groups.mjs                 # every zone in js/zones/
//   node tools/check-roam-groups.mjs bleakmire_woods # one zone, by id
//   node tools/check-roam-groups.mjs js/zones/zone_warrens.js
//
// Exits 1 if any problem is found, so it can gate a commit.
//
// A roam group is several enemies sharing a `roamGroup` id: the member holding the patrol
// waypoints leads and the rest hold formation on it. The two rules below MUST stay in
// step with the runtime, or this reports a roam group the game doesn't actually play:
//
//   group key  →  js/units.js      roamGroupKey()  trim + collapse spaces + lowercase
//   leader     →  js/precombat.js  _roamGroups()   first member in array order with >=2 wp
//
// What it flags:
//   FAIL  no member has waypoints          — the roam group idles in place forever
//   FAIL  two or more members have them    — the leader then depends on array order,
//                                            which a respawn reshuffles
//   FAIL  a member without roams:true      — it won't be nudged during combat
//   FAIL  a stuck roamer                   — roams:true, no waypoints, no roam group to follow
//   NOTE  ids matching only after normalising (a typo the runtime forgives)

import { pathToFileURL } from 'node:url';
import { readdir }       from 'node:fs/promises';
import path              from 'node:path';

const ZONE_DIR = 'js/zones';

const roamGroupKey = id => (id ? id.trim().replace(/\s+/g, ' ').toLowerCase() : null);
const at      = e  => `${e.type} (${e.x}, ${e.z})`;

async function zoneFiles(args) {
  if (!args.length) {
    const all = await readdir(ZONE_DIR);
    return all.filter(f => f.startsWith('zone_') && f.endsWith('.js')).map(f => path.join(ZONE_DIR, f));
  }
  return args.map(a => (a.endsWith('.js') ? a : path.join(ZONE_DIR, `zone_${a}.js`)));
}

async function checkZone(file) {
  let ZONE;
  try {
    ({ ZONE } = await import(pathToFileURL(path.resolve(file)).href));
  } catch (err) {
    console.log(`\n${file}\n   ERROR  could not import: ${err.message}`);
    return 1;
  }
  const es = ZONE?.enemies ?? [];

  const groups = new Map();
  for (const e of es) {
    const k = roamGroupKey(e.roamGroup);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const stuck = es.filter(e => e.roams && !(e.patrol?.length >= 2) && !e.roamGroup);
  if (!groups.size && !stuck.length) {
    console.log(`\n${ZONE?.id ?? file} — no roam groups`);
    return 0;
  }

  console.log(`\n${ZONE?.id ?? file} — ${es.length} entries, ${groups.size} roam group(s)`);
  let problems = 0;

  for (const mem of groups.values()) {
    const holders = mem.filter(m => m.patrol?.length >= 2);
    const leader  = holders[0];
    const raw     = [...new Set(mem.map(m => m.roamGroup))];

    console.log(`\n  ── ${raw[0]}  (${mem.length} members)`);
    if (raw.length > 1) {
      console.log(`     NOTE  ids differ in case/spacing: ${raw.map(r => JSON.stringify(r)).join(', ')} — matched anyway`);
    }

    if (!holders.length) {
      console.log(`     FAIL  no member has waypoints — roam group will idle in place`);
      problems++;
    } else if (holders.length > 1) {
      console.log(`     FAIL  ${holders.length} waypoint holders: ${holders.map(at).join(', ')}`);
      console.log(`           leader depends on array order; clear all but one`);
      problems++;
    } else {
      console.log(`     leader    ${at(leader)}  ${leader.patrol.length} wp`);
    }

    for (const m of mem) {
      if (m === leader) continue;
      const flags = [];
      if (!m.roams) { flags.push('FAIL missing roams:true — not nudged in combat'); problems++; }
      if (m.patrol?.length >= 2) flags.push('has waypoints (ignored while grouped)');
      console.log(`     follower  ${at(m)}${flags.length ? '   <-- ' + flags.join('; ') : ''}`);
    }
  }

  if (stuck.length) {
    console.log(`\n  FAIL  stuck roamers — roams:true but no waypoints and no roam group (${stuck.length}):`);
    stuck.forEach(e => console.log(`     ${at(e)}`));
    problems += stuck.length;
  }

  return problems;
}

const files = await zoneFiles(process.argv.slice(2));
let total = 0;
for (const f of files) total += await checkZone(f);

console.log(total ? `\n${total} problem(s) found.` : `\nAll roam groups well-formed.`);
process.exit(total ? 1 : 0);
