import { defineConfig } from 'vite';
import fs   from 'node:fs';
import path from 'node:path';

function saveZonePropsPlugin() {
  return {
    name: 'save-zone-props',
    configureServer(server) {
      server.middlewares.use('/__save_zone_props', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }

        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { zoneId, props, biome } = JSON.parse(body);
            if (!zoneId) throw new Error('missing zoneId');

            const filePath = path.resolve(`js/zones/zone_${zoneId}.js`);
            if (!fs.existsSync(filePath))
              throw new Error(`Zone file not found: zone_${zoneId}.js`);

            let src = fs.readFileSync(filePath, 'utf-8');

            if (biome) {
              src = src.replace(/biome:\s*'[^']*'/, `biome: '${biome}'`);
            }

            // Build the props block in the zone file's own style (no JSON quoting on keys)
            const itemLines = props.map(p => {
              let s = `    { model: '${p.model}', x: ${p.x}, z: ${p.z}`;
              if (p.y  != null)              s += `, y: ${p.y}`;
              if (p.yOff != null && p.yOff !== 0) s += `, yOff: ${p.yOff}`;
              s += `, rotY: ${p.rotY}`;
              if (p.rotX != null && p.rotX !== 0) s += `, rotX: ${p.rotX}`;
              s += `, scale: ${p.scale} },`;
              return s;
            });
            const propsBlock = props.length
              ? `  props: [\n${itemLines.join('\n')}\n  ],`
              : `  props: [],`;

            if (/[ \t]*props\s*:/.test(src)) {
              // Replace existing props field (handles multi-line array)
              src = src.replace(/[ \t]*props\s*:[\s\S]*?\],?/, propsBlock);
            } else {
              // Insert before the closing };
              src = src.replace(/^(\};)/m, `${propsBlock}\n$1`);
            }

            fs.writeFileSync(filePath, src, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function saveZoneEnemiesPlugin() {
  return {
    name: 'save-zone-enemies',
    configureServer(server) {
      server.middlewares.use('/__save_zone_enemies', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }

        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { zoneId, enemies, biome } = JSON.parse(body);
            if (!zoneId) throw new Error('missing zoneId');

            const filePath = path.resolve(`js/zones/zone_${zoneId}.js`);
            if (!fs.existsSync(filePath))
              throw new Error(`Zone file not found: zone_${zoneId}.js`);

            let src = fs.readFileSync(filePath, 'utf-8');

            if (biome) {
              src = src.replace(/biome:\s*'[^']*'/, `biome: '${biome}'`);
            }

            const itemLines = enemies.map(e => {
              let s = `    { type: '${e.type}', x: ${e.x}, z: ${e.z}`;
              if (e.yOff  != null && e.yOff  !== 0)  s += `, yOff: ${e.yOff}`;
              if (e.scale != null && e.scale !== 1)   s += `, scale: ${e.scale}`;
              if (e.detectRange != null)              s += `, detectRange: ${e.detectRange}`;
              if (e.roams)                            s += `, roams: true`;
              if (e.roamMode)                         s += `, roamMode: '${e.roamMode}'`;
              if (e.wanderRadius != null)             s += `, wanderRadius: ${e.wanderRadius}`;
              if (e.patrol?.length) {
                const pts = e.patrol.map(p => `{x:${p.x},z:${p.z}}`).join(', ');
                s += `, patrol: [${pts}]`;
              }
              if (e.stealthed)                        s += `, stealthed: true`;
              if (e.attackPref)                       s += `, attackPref: '${e.attackPref}'`;
              if (e.animOverrides && Object.keys(e.animOverrides).length) {
                const ovStr = Object.entries(e.animOverrides)
                  .map(([role, idx]) => `${role}:${idx}`)
                  .join(',');
                s += `, animOverrides: {${ovStr}}`;
              }
              return s + ' },';
            });
            const enemiesBlock = enemies.length
              ? `  enemies: [\n${itemLines.join('\n')}\n  ],`
              : `  enemies: [],`;

            if (/[ \t]*enemies\s*:/.test(src)) {
              // Use bracket-counting to find the true end of the enemies array,
              // so nested arrays (e.g. patrol:[...]) don't fool the regex.
              const startIdx = src.search(/[ \t]*enemies\s*:/);
              const arrStart = src.indexOf('[', startIdx);
              let depth = 0, arrEnd = -1;
              for (let i = arrStart; i < src.length; i++) {
                if (src[i] === '[') depth++;
                else if (src[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
              }
              // consume optional trailing comma
              const afterArr = arrEnd + 1;
              const trailingComma = src[afterArr] === ',' ? 1 : 0;
              src = src.slice(0, startIdx) + enemiesBlock + src.slice(afterArr + trailingComma);
            } else {
              src = src.replace(/^(\};)/m, `${enemiesBlock}\n$1`);
            }

            fs.writeFileSync(filePath, src, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function saveZoneSpawnsPlugin() {
  return {
    name: 'save-zone-spawns',
    configureServer(server) {
      server.middlewares.use('/__save_zone_spawns', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { zoneId, spawns } = JSON.parse(body);
            if (!zoneId) throw new Error('missing zoneId');

            const filePath = path.resolve(`js/zones/zone_${zoneId}.js`);
            if (!fs.existsSync(filePath))
              throw new Error(`Zone file not found: zone_${zoneId}.js`);

            let src = fs.readFileSync(filePath, 'utf-8');

            const itemLines = spawns.map(s => {
              let str = `    { type: '${s.type}', x: ${s.x}, z: ${s.z}, round: ${s.round}`;
              if (s.every > 0)             str += `, every: ${s.every}`;
              if (s.roams)                 str += `, roams: true`;
              if (s.roamMode)              str += `, roamMode: '${s.roamMode}'`;
              if (s.patrol?.length >= 2) {
                const pts = s.patrol.map(p => `{x:${p.x},z:${p.z}}`).join(', ');
                str += `, patrol: [${pts}]`;
              }
              return str + ' },';
            });
            const spawnsBlock = spawns.length
              ? `  spawns: [\n${itemLines.join('\n')}\n  ],`
              : `  spawns: [],`;

            if (/[ \t]*spawns\s*:/.test(src)) {
              // Bracket-count to find true array end (handles nested patrol:[...])
              const startIdx = src.search(/[ \t]*spawns\s*:/);
              const arrStart = src.indexOf('[', startIdx);
              let depth = 0, arrEnd = -1;
              for (let i = arrStart; i < src.length; i++) {
                if (src[i] === '[') depth++;
                else if (src[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
              }
              const afterArr = arrEnd + 1;
              const trailingComma = src[afterArr] === ',' ? 1 : 0;
              src = src.slice(0, startIdx) + spawnsBlock + src.slice(afterArr + trailingComma);
            } else {
              src = src.replace(/^(\};)/m, `${spawnsBlock}\n$1`);
            }

            fs.writeFileSync(filePath, src, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function saveZoneTerrainPlugin() {
  return {
    name: 'save-zone-terrain',
    configureServer(server) {
      server.middlewares.use('/__save_zone_terrain', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }

        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { zoneId, terrain, terrainSeed, biome } = JSON.parse(body);
            if (!zoneId) throw new Error('missing zoneId');

            const filePath = path.resolve(`js/zones/zone_${zoneId}.js`);
            if (!fs.existsSync(filePath))
              throw new Error(`Zone file not found: zone_${zoneId}.js`);

            let src = fs.readFileSync(filePath, 'utf-8');

            if (biome) {
              src = src.replace(/biome:\s*'[^']*'/, `biome: '${biome}'`);
            }

            // Write terrain control points
            const itemLines = terrain.map(p => {
              let s = `    { x: ${p.x}, z: ${p.z}, h: ${p.h}, r: ${p.r}`;
              if (p.pr) s += `, pr: ${p.pr}`;
              return s + ` },`;
            });
            const terrainBlock = terrain.length
              ? `  terrain: [\n${itemLines.join('\n')}\n  ],`
              : `  terrain: [],`;

            if (/[ \t]*terrain\s*:/.test(src)) {
              src = src.replace(/[ \t]*terrain\s*:[\s\S]*?\],?/, terrainBlock);
            } else {
              src = src.replace(/^(\};)/m, `${terrainBlock}\n$1`);
            }

            // Write terrain seed so the noise is reproducible on reload
            if (terrainSeed) {
              const r = (n) => Math.round(n * 1e6) / 1e6;
              const phStr = terrainSeed.ph.map(r).join(',');
              const fxStr = terrainSeed.fx.map(r).join(',');
              const fzStr = terrainSeed.fz.map(r).join(',');
              const seedBlock = `  terrainSeed: { ph: [${phStr}], fx: [${fxStr}], fz: [${fzStr}], sharpExp: ${r(terrainSeed.sharpExp)}, scale: ${r(terrainSeed.scale)} },`;
              if (/[ \t]*terrainSeed\s*:/.test(src)) {
                src = src.replace(/[ \t]*terrainSeed\s*:[^\n]+/, seedBlock);
              } else {
                src = src.replace(/^(\};)/m, `${seedBlock}\n$1`);
              }
            }

            fs.writeFileSync(filePath, src, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function _zoneConstName(id) {
  return 'ZONE_' + id.toUpperCase();
}

function _addZoneToLoader(id, name) {
  const loaderPath = path.resolve('js/zoneLoader.js');
  let src = fs.readFileSync(loaderPath, 'utf-8');
  const constName = _zoneConstName(id);

  // Insert import after the last zone import block
  src = src.replace(
    /((?:import \{ ZONE as \w+ \} from '\.\/zones\/zone_\w+\.js';\n)+)/,
    `$1import { ZONE as ${constName} } from './zones/zone_${id}.js';\n`
  );

  // Append to ZONE_ORDER array (single-line)
  src = src.replace(
    /const ZONE_ORDER = \[([^\]]+)\];/,
    (_, inner) => `const ZONE_ORDER = [${inner.trimEnd()}, ${constName}];`
  );

  fs.writeFileSync(loaderPath, src, 'utf-8');
}

function _removeZoneFromLoader(id) {
  const loaderPath = path.resolve('js/zoneLoader.js');
  let src = fs.readFileSync(loaderPath, 'utf-8');
  const constName = _zoneConstName(id);

  // Remove import line (regex handles alignment padding between } and from)
  src = src.replace(
    new RegExp(`import \\{ ZONE as ${constName} \\}\\s+from '\\.\/zones\/zone_${id}\\.js';\\n`),
    ''
  );

  // Remove from ZONE_ORDER
  src = src.replace(
    /const ZONE_ORDER = \[([^\]]+)\];/,
    (_, inner) => {
      const items = inner.split(',').map(s => s.trim()).filter(s => s && s !== constName);
      return `const ZONE_ORDER = [${items.join(', ')}];`;
    }
  );

  fs.writeFileSync(loaderPath, src, 'utf-8');
}

function createZonePlugin() {
  return {
    name: 'create-zone',
    configureServer(server) {
      server.middlewares.use('/__create_zone', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { name, id } = JSON.parse(body);
            if (!id || !name) throw new Error('missing name or id');
            const filePath = path.resolve(`js/zones/zone_${id}.js`);
            if (fs.existsSync(filePath)) throw new Error(`Zone already exists: zone_${id}.js`);
            const src =
`export const ZONE = {
  id: '${id}',
  name: '${name}',
  biome: 'dungeon',
  heroEntry: [
    { x: -1, z: 29, type: 'dwarf' },
    { x:  1, z: 29, type: 'human' },
    { x: -1, z: 31, type: 'elf' },
    { x:  1, z: 31, type: 'halfling' },
  ],
  enemies: [],
  exits: [],
};\n`;
            fs.writeFileSync(filePath, src, 'utf-8');
            _addZoneToLoader(id, name);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

function deleteZonePlugin() {
  return {
    name: 'delete-zone',
    configureServer(server) {
      server.middlewares.use('/__delete_zone', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { id } = JSON.parse(body);
            if (!id) throw new Error('missing id');
            const filePath = path.resolve(`js/zones/zone_${id}.js`);
            if (!fs.existsSync(filePath)) throw new Error(`Zone file not found: zone_${id}.js`);
            fs.unlinkSync(filePath);
            _removeZoneFromLoader(id);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveZonePropsPlugin(), saveZoneEnemiesPlugin(), saveZoneSpawnsPlugin(), saveZoneTerrainPlugin(), createZonePlugin(), deleteZonePlugin()],
});
