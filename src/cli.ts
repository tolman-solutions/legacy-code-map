#!/usr/bin/env node
// legacy-code-map: map dependencies in a legacy codebase, locally, in seconds.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { LANG, EXTRACT, ext, summarize, SUPPORTED_LANGUAGES, type GraphNode, type GraphEdge } from './extract';

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'bin', 'obj', 'dist', 'build', '.next', '__pycache__', 'vendor']);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(p, out); }
    else if (ext(name) in LANG && st.size < 20 * 1024 * 1024) out.push(p);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`legacy-code-map <folder> [--json out.json] [--top N]\n\nMaps declarations and dependencies in legacy source code.\nReads: ${SUPPORTED_LANGUAGES}.\nNothing leaves your machine.`);
    process.exit(args.length ? 0 : 1);
  }
  const root = args[0];
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
  const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) || 10 : 10;
  const files: string[] = [];
  walk(root, files);
  const nodes: GraphNode[] = []; const edges: GraphEdge[] = [];
  const hashes = new Map<string, string>(); const branches = new Map<string, string[]>();
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    const parts = rel.split('/'); const branch = parts.length > 1 ? parts[0] : 'root';
    const fileId = `file_${rel.replace(/\//g, '_')}`;
    const content = readFileSync(abs, 'utf8');
    const h = createHash('sha256').update(content).digest('hex');
    const canonical = hashes.get(h);
    if (canonical) { branches.get(canonical)!.push(branch); continue; }
    hashes.set(h, fileId); branches.set(fileId, [branch]);
    const e = ext(rel); const lang = LANG[e];
    nodes.push({ id: fileId, file: rel, kind: 'file', extension: e, language: lang || 'other', size: content.length, loc: content.split('\n').length });
    const fn = lang ? EXTRACT[lang] : undefined;
    if (fn) { const r = fn(content, fileId); nodes.push(...r.nodes); edges.push(...r.edges); }
  }
  const dupes = [...branches.values()].filter((b) => b.length > 1).length;
  const all = new Set<string>(); for (const bs of branches.values()) for (const b of bs) all.add(b);
  const graph = { nodes, edges, branches_found: all.size };
  const s = summarize(graph);
  const hubs = s.top_hubs.slice(0, top).map((h) => [h.id, h.in_degree] as [string, number]);
  const ext_hubs = s.external_hubs.slice(0, Math.min(top, 5));
  const largest = nodes.filter((n) => n.kind === 'file').sort((a, b) => (b.loc || 0) - (a.loc || 0)).slice(0, top);
  const fileCount = nodes.filter((n) => n.kind === 'file').length;
  const loc = nodes.filter((n) => n.kind === 'file').reduce((t, n) => t + (n.loc || 0), 0);

  const line = (t = '') => console.log(t);
  line(`\nlegacy-code-map — ${root}`);
  line(`${fileCount.toLocaleString()} source files · ${loc.toLocaleString()} lines · ${s.total_nodes.toLocaleString()} objects · ${s.total_edges.toLocaleString()} dependencies` + (dupes ? ` · ${dupes} files duplicated across folders` : ''));
  line(`\nFiles by language`);
  const LABEL: Record<string, string> = { axxml: 'X++ (D365 XML)', xpp: 'X++', cs: 'C#', sql: 'SQL', plsql: 'PL/SQL', cobol: 'COBOL', rpg: 'RPG/CL', abap: 'ABAP', vb: 'VB', delphi: 'Delphi', java: 'Java', py: 'Python', js: 'JS/TS', php: 'PHP', progress: 'Progress', other: 'other' };
  for (const [k, v] of Object.entries(s.files_by_language).sort((a, b) => b[1] - a[1])) line(`  ${(LABEL[k] || k).padEnd(16)} ${v}`);
  line(`\nMost-referenced objects in this codebase (chokepoints)`);
  for (const [id, d] of hubs) line(`  ${String(d).padStart(5)}  ${id.split('_').slice(1).join('_') || id}  [${id.split('_')[0]}]`);
  if (ext_hubs.length) {
    line(`\nMost-used platform/external objects`);
    for (const h of ext_hubs) line(`  ${String(h.in_degree).padStart(5)}  ${h.id.split('_').slice(1).join('_') || h.id}`);
  }
  line(`\nLargest files`);
  for (const n of largest) line(`  ${String(n.loc).padStart(7)}  ${n.file}`);
  line(`\nDependency types`);
  for (const [k, v] of Object.entries(s.edge_counts_by_kind).sort((a, b) => b[1] - a[1])) line(`  ${k.padEnd(18)} ${v}`);
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ summary: s, top_hubs: hubs, graph }, null, 1)); line(`\nGraph written to ${jsonOut}`); }
  line(`\nWant the full picture? The hosted scanner adds AI-written subsystem analysis and a phased`);
  line(`migration blueprint: https://scan.tolmansolutions.com (free scan; code never stored).\n`);
}
main();
