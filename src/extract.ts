// Extractors shared with the hosted Legacy Resurrector scanner (scan.tolmansolutions.com).
export interface GraphNode {
  id: string; kind: string; file?: string; name?: string;
  extension?: string; language?: string; size?: number; loc?: number; branches?: string[];
}
export interface GraphEdge { from: string; to: string; kind: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; branches_found: number }

// File types the scanner reads. Each maps to a language extractor below; '' means
// the file is counted and sized but not dependency-parsed.
export const LANG: Record<string, string> = {
  '.xpp': 'xpp', '.xpo': 'xpp', '.cs': 'cs', '.sql': 'sql',
  '.pls': 'plsql', '.pkb': 'plsql', '.pks': 'plsql', '.plsql': 'plsql', '.prc': 'plsql', '.fnc': 'plsql', '.trg': 'plsql', '.pck': 'plsql',
  '.cbl': 'cobol', '.cob': 'cobol', '.cobol': 'cobol', '.cpy': 'cobol',
  '.rpg': 'rpg', '.rpgle': 'rpg', '.sqlrpgle': 'rpg', '.rpg4': 'rpg', '.clle': 'rpg', '.clp': 'rpg',
  '.abap': 'abap',
  '.bas': 'vb', '.cls': 'vb', '.frm': 'vb', '.vb': 'vb', '.ctl': 'vb',
  '.pas': 'delphi', '.dpr': 'delphi', '.dpk': 'delphi',
  '.java': 'java', '.py': 'py',
  '.js': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mjs': 'js',
  '.php': 'php',
  '.p': 'progress', '.w': 'progress', '.i': 'progress',
  '.xml': 'axxml',
};
export const EXTS = Object.keys(LANG);

export function ext(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function all(re: RegExp, text: string) {
  return Array.from(text.matchAll(re));
}

type Out = { nodes: GraphNode[]; edges: GraphEdge[] };
const ID = /[A-Za-z_][A-Za-z0-9_$#-]*/.source;
const SKIP = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'select', 'from', 'where', 'and', 'or', 'not', 'set', 'values', 'dual', 'the', 'a']);

function decl(o: Out, prefix: string, fileId: string, kind: string, name: string) {
  if (!name || SKIP.has(name.toLowerCase())) return;
  o.nodes.push({ id: `${prefix}_${name}`, file: fileId, kind, name });
}
function edge(o: Out, prefix: string, fileId: string, kind: string, name: string) {
  if (!name || SKIP.has(name.toLowerCase())) return;
  o.edges.push({ from: fileId, to: `${prefix}_${name}`, kind });
}
// Embedded SQL (COBOL EXEC SQL, RPG, ABAP Open SQL, VB/Java/Python query strings).
function embeddedSql(o: Out, c: string, fileId: string) {
  for (const m of all(new RegExp(String.raw`\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["\[\`]?(?:\w+\.)?(${ID})`, 'gi'), c))
    edge(o, 'sql', fileId, 'sql_reference', m[1]);
}

function extractXpp(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/(?:public|private|protected|internal)?\s*(?:static\s+)?\b(?:class|table|form|view|dataentity)\s+([A-Za-z0-9_]+)/gi, c))
    decl(o, 'xpp', fileId, 'xpp_declaration', m[1]);
  for (const m of all(/\[ExtensionOf\s*\(\s*(?:classStr|tableStr|formStr)\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*\)\s*\]/gi, c)) {
    o.nodes.push({ id: `xpp_ext_${m[1]}`, file: fileId, kind: 'xpp_extension', name: m[1] });
    edge(o, 'xpp', fileId, 'extends', m[1]);
  }
  for (const m of all(/\bclass\s+[A-Za-z0-9_]+\s+extends\s+([A-Za-z0-9_]+)/gi, c)) edge(o, 'xpp', fileId, 'extends', m[1]);
  for (const m of all(/\bselect\s+(?:(?:firstonly\d*|firstfast|forupdate|crosscompany|forceselectorder|forceplaceholders|forceliterals|forcenestedloop|nofetch|reverse|pessimisticlock|optimisticlock|repeatableread|generateonly)\s+)*(?:(?:count|sum|avg|minof|maxof)\s*\([^)]*\)\s+from\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi, c))
    if (!/^(count|sum|avg|minof|maxof|from)$/i.test(m[1])) edge(o, 'xpp', fileId, 'reads_table', m[1]);
  for (const m of all(/([A-Za-z0-9_]+)::[A-Za-z0-9_]+/g, c)) edge(o, 'xpp', fileId, 'calls_static', m[1]);
  return o;
}

// D365 F&O metadata XML (AxClass, AxTable, AxForm, ...): X++ lives in CDATA blocks.
// Non-Ax XML is counted but not parsed.
function extractAxXml(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  const t = c.match(/<(Ax[A-Za-z]+)\b/);
  if (!t) return o;
  const type = t[1];
  const name = (c.match(/<Name>([^<]+)<\/Name>/) || [])[1];
  if (name) {
    if (/Extension$/.test(type) && name.includes('.')) {
      const base = name.split('.')[0];
      o.nodes.push({ id: `xpp_ext_${name.replace('.', '_')}`, file: fileId, kind: 'xpp_extension', name });
      edge(o, 'xpp', fileId, 'extends', base);
    } else decl(o, 'xpp', fileId, `xpp_${type.slice(2).toLowerCase()}`, name);
  }
  for (const m of all(/<RelatedTable>([A-Za-z0-9_]+)<\/RelatedTable>/g, c)) edge(o, 'xpp', fileId, 'table_relation', m[1]);
  for (const m of all(/<Table>([A-Za-z0-9_]+)<\/Table>/g, c)) edge(o, 'xpp', fileId, 'reads_table', m[1]);
  for (const m of all(/<Extends>([A-Za-z0-9_]+)<\/Extends>/g, c)) edge(o, 'xpp', fileId, 'extends', m[1]);
  const code = all(/<!\[CDATA\[([\s\S]*?)\]\]>/g, c).map((m) => m[1]).join('\n');
  if (code) { const r = extractXpp(code, fileId); o.nodes.push(...r.nodes.filter((n) => n.name !== name)); o.edges.push(...r.edges); }
  return o;
}

function extractSql(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:PROCEDURE|PROC|TABLE|VIEW|FUNCTION|TRIGGER)\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    decl(o, 'sql', fileId, 'sql_declaration', m[1]);
  for (const m of all(/(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    edge(o, 'sql', fileId, 'sql_reference', m[1]);
  for (const m of all(/EXEC(?:UTE)?\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    edge(o, 'sql', fileId, 'sql_calls', m[1]);
  return o;
}

function extractPlsql(c: string, fileId: string): Out {
  const o = extractSql(c, fileId);
  for (const m of all(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+)?PACKAGE\s+(?:BODY\s+)?(?:"?\w+"?\.)?"?([A-Za-z0-9_$#]+)"?/gi, c))
    decl(o, 'sql', fileId, 'plsql_package', m[1]);
  for (const m of all(/\b([A-Za-z][A-Za-z0-9_$#]*)\.([A-Za-z][A-Za-z0-9_$#]*)\s*\(/g, c))
    if (!/^(dbms_|utl_|sys|apex_)/i.test(m[1])) edge(o, 'sql', fileId, 'sql_calls', m[1]);
  return o;
}

function extractCs(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/(?:public|private|protected|internal)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|interface|struct|record)\s+([A-Za-z0-9_]+)/g, c))
    decl(o, 'cs', fileId, 'cs_declaration', m[1]);
  for (const m of all(/new\s+([A-Za-z0-9_]+)\s*[(<]/g, c)) edge(o, 'cs', fileId, 'cs_instantiates', m[1]);
  for (const m of all(/^\s*using\s+([A-Za-z0-9_.]+)\s*;/gm, c)) edge(o, 'cs', fileId, 'imports', m[1].split('.').pop()!);
  embeddedSql(o, c, fileId);
  return o;
}

function extractCobol(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/PROGRAM-ID\.\s*['"]?([A-Za-z0-9-]+)/gi, c)) decl(o, 'cobol', fileId, 'cobol_program', m[1].toUpperCase());
  for (const m of all(/\bCALL\s+['"]([A-Za-z0-9-]+)['"]/gi, c)) edge(o, 'cobol', fileId, 'calls_program', m[1].toUpperCase());
  for (const m of all(/^[ \d]{0,7}\s*COPY\s+['"]?([A-Za-z0-9-]+)/gim, c)) edge(o, 'cobol', fileId, 'includes_copybook', m[1].toUpperCase());
  for (const m of all(/\bSELECT\s+([A-Za-z0-9-]+)\s+ASSIGN\b/gi, c)) edge(o, 'cobol', fileId, 'uses_file', m[1].toUpperCase());
  for (const m of all(/EXEC\s+SQL([\s\S]*?)END-EXEC/gi, c)) embeddedSql(o, m[1], fileId);
  for (const m of all(/EXEC\s+CICS\s+(?:LINK|XCTL)\s+PROGRAM\s*\(\s*['"]?([A-Za-z0-9-]+)/gi, c)) edge(o, 'cobol', fileId, 'calls_program', m[1].toUpperCase());
  return o;
}

function extractRpg(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/\bdcl-f\s+(\w+)/gi, c)) edge(o, 'rpg', fileId, 'uses_file', m[1].toUpperCase());
  for (const m of all(/^.{5}F(\w{1,10})\s+[IUOC]/gim, c)) edge(o, 'rpg', fileId, 'uses_file', m[1].toUpperCase());
  for (const m of all(/EXTPGM\s*\(\s*'(\w+)'/gi, c)) edge(o, 'rpg', fileId, 'calls_program', m[1].toUpperCase());
  for (const m of all(/\bCALL\s+(?:PGM\s*\(\s*)?(?:\w+\/)?'?(\w+)'?/gi, c)) edge(o, 'rpg', fileId, 'calls_program', m[1].toUpperCase());
  for (const m of all(/\bdcl-proc\s+(\w+)/gi, c)) decl(o, 'rpg', fileId, 'rpg_procedure', m[1].toUpperCase());
  for (const m of all(/\/(?:COPY|INCLUDE)\s+(?:\S+,)?(\w+)/gi, c)) edge(o, 'rpg', fileId, 'includes_copybook', m[1].toUpperCase());
  for (const m of all(/EXEC\s+SQL([\s\S]*?);/gi, c)) embeddedSql(o, m[1], fileId);
  return o;
}

function extractAbap(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/^\s*(?:REPORT|PROGRAM|FUNCTION-POOL)\s+(\w+)/gim, c)) decl(o, 'abap', fileId, 'abap_program', m[1].toUpperCase());
  for (const m of all(/^\s*CLASS\s+(\w+)\s+DEFINITION/gim, c)) decl(o, 'abap', fileId, 'abap_class', m[1].toUpperCase());
  for (const m of all(/^\s*FUNCTION\s+(\w+)\s*\./gim, c)) decl(o, 'abap', fileId, 'abap_function', m[1].toUpperCase());
  for (const m of all(/CALL\s+FUNCTION\s+'(\w+)'/gi, c)) edge(o, 'abap', fileId, 'calls_function', m[1].toUpperCase());
  for (const m of all(/\bPERFORM\s+(\w+)/gi, c)) edge(o, 'abap', fileId, 'calls_form', m[1].toUpperCase());
  for (const m of all(/^\s*INCLUDE\s+(\w+)/gim, c)) edge(o, 'abap', fileId, 'includes', m[1].toUpperCase());
  for (const m of all(/\bSUBMIT\s+(\w+)/gi, c)) edge(o, 'abap', fileId, 'calls_program', m[1].toUpperCase());
  for (const m of all(/\bSELECT\b[\s\S]{0,400}?\bFROM\s+(\w+)/gi, c)) edge(o, 'sql', fileId, 'sql_reference', m[1].toUpperCase());
  for (const m of all(/\b(?:UPDATE|MODIFY|INSERT|DELETE)\s+(?:FROM\s+)?(\w+)\s+(?:SET|FROM|VALUES)/gi, c)) edge(o, 'sql', fileId, 'sql_reference', m[1].toUpperCase());
  return o;
}

function extractVb(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/Attribute\s+VB_Name\s*=\s*"(\w+)"/gi, c)) decl(o, 'vb', fileId, 'vb_module', m[1]);
  for (const m of all(/^\s*(?:Public\s+|Friend\s+|Private\s+)?(?:Partial\s+)?(?:Class|Module|Interface)\s+(\w+)/gim, c)) decl(o, 'vb', fileId, 'vb_module', m[1]);
  for (const m of all(/\bNew\s+(\w+)/g, c)) edge(o, 'vb', fileId, 'vb_instantiates', m[1]);
  for (const m of all(/CreateObject\s*\(\s*"([\w.]+)"/gi, c)) edge(o, 'vb', fileId, 'com_dependency', m[1]);
  for (const m of all(/Declare\s+(?:PtrSafe\s+)?(?:Function|Sub)\s+\w+\s+Lib\s+"([\w.]+)"/gi, c)) edge(o, 'vb', fileId, 'native_dll', m[1]);
  for (const m of all(/^\s*Imports\s+([\w.]+)/gim, c)) edge(o, 'vb', fileId, 'imports', m[1].split('.').pop()!);
  embeddedSql(o, c, fileId);
  return o;
}

function extractDelphi(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/^\s*(?:unit|program|library)\s+([\w.]+)\s*;/gim, c)) decl(o, 'pas', fileId, 'delphi_unit', m[1]);
  for (const m of all(/\buses\s+([\s\S]*?);/gi, c))
    for (const u of m[1].split(',')) { const n = u.trim().split(/\s+/)[0]; if (n) edge(o, 'pas', fileId, 'imports', n); }
  for (const m of all(/(\w+)\s*=\s*class\s*\(\s*(\w+)/gi, c)) { decl(o, 'pas', fileId, 'delphi_class', m[1]); edge(o, 'pas', fileId, 'extends', m[2]); }
  embeddedSql(o, c, fileId);
  return o;
}

function extractJava(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|interface|enum|record)\s+([A-Za-z0-9_]+)/g, c)) decl(o, 'java', fileId, 'java_declaration', m[1]);
  for (const m of all(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm, c)) edge(o, 'java', fileId, 'imports', m[1].split('.').pop()!);
  for (const m of all(/\bextends\s+([A-Za-z0-9_]+)/g, c)) edge(o, 'java', fileId, 'extends', m[1]);
  for (const m of all(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*[(<]/g, c)) edge(o, 'java', fileId, 'instantiates', m[1]);
  embeddedSql(o, c, fileId);
  return o;
}

function extractPy(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/^class\s+(\w+)/gm, c)) decl(o, 'py', fileId, 'py_class', m[1]);
  for (const m of all(/^def\s+(\w+)/gm, c)) decl(o, 'py', fileId, 'py_function', m[1]);
  for (const m of all(/^\s*from\s+([\w.]+)\s+import/gm, c)) edge(o, 'py', fileId, 'imports', m[1].split('.').pop()!);
  for (const m of all(/^\s*import\s+([\w.]+)/gm, c)) edge(o, 'py', fileId, 'imports', m[1].split('.').pop()!);
  embeddedSql(o, c, fileId);
  return o;
}

function extractJs(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|function)\s+([A-Za-z0-9_$]+)/g, c)) decl(o, 'js', fileId, 'js_declaration', m[1]);
  for (const m of all(/(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g, c)) {
    const mod = m[1].split('/').pop()!.replace(/\.(m?js|jsx?|tsx?)$/, '');
    if (mod) edge(o, 'js', fileId, 'imports', mod);
  }
  return o;
}

function extractPhp(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|interface|trait)\s+([A-Za-z0-9_]+)/g, c)) decl(o, 'php', fileId, 'php_declaration', m[1]);
  for (const m of all(/\bnew\s+\\?([A-Za-z0-9_\\]+)/g, c)) edge(o, 'php', fileId, 'instantiates', m[1].split('\\').pop()!);
  for (const m of all(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g, c)) edge(o, 'php', fileId, 'includes', m[1].split('/').pop()!.replace(/\.php$/, ''));
  for (const m of all(/^\s*use\s+([\w\\]+)/gm, c)) edge(o, 'php', fileId, 'imports', m[1].split('\\').pop()!);
  embeddedSql(o, c, fileId);
  return o;
}

function extractProgress(c: string, fileId: string): Out {
  const o: Out = { nodes: [], edges: [] };
  for (const m of all(/\bRUN\s+([\w/.-]+\.[pw])\b/gi, c)) edge(o, 'abl', fileId, 'calls_program', m[1].split('/').pop()!);
  for (const m of all(/\{([\w/.-]+\.i)\b/gi, c)) edge(o, 'abl', fileId, 'includes', m[1].split('/').pop()!);
  for (const m of all(/\b(?:FOR\s+(?:EACH|FIRST|LAST)|FIND\s+(?:FIRST|LAST|NEXT)?|CAN-FIND\s*\(\s*(?:FIRST\s+)?)\s*(\w+)/gi, c))
    edge(o, 'sql', fileId, 'sql_reference', m[1]);
  for (const m of all(/^\s*(?:PROCEDURE|FUNCTION)\s+([\w-]+)/gim, c)) decl(o, 'abl', fileId, 'abl_procedure', m[1]);
  return o;
}

export const EXTRACT: Record<string, (c: string, f: string) => Out> = {
  xpp: extractXpp, axxml: extractAxXml, sql: extractSql, plsql: extractPlsql, cs: extractCs, cobol: extractCobol, rpg: extractRpg,
  abap: extractAbap, vb: extractVb, delphi: extractDelphi, java: extractJava, py: extractPy, js: extractJs,
  php: extractPhp, progress: extractProgress,
};

export const SUPPORTED_LANGUAGES = 'X++ (AX 2012 XPO and D365 metadata XML), T-SQL, PL/SQL, COBOL, RPG, ABAP, VB6/VB.NET, Delphi, Progress ABL, C#, Java, Python, JavaScript/TypeScript and PHP';

export function summarize(graph: Graph) {
  const byKind: Record<string, number> = {};
  for (const n of graph.nodes) byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  const inDeg: Record<string, number> = {};
  const edgeKinds: Record<string, number> = {};
  for (const e of graph.edges) {
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    edgeKinds[e.kind] = (edgeKinds[e.kind] || 0) + 1;
  }
  const byLang: Record<string, number> = {};
  for (const n of graph.nodes) if (n.kind === 'file') byLang[n.language || 'other'] = (byLang[n.language || 'other'] || 0) + 1;
  // Chokepoints: prefer objects declared in this codebase (custom code) over platform/kernel references.
  const declared = new Set(graph.nodes.filter((n) => n.kind !== 'file').map((n) => n.id));
  const ranked = Object.entries(inDeg).sort((a, b) => b[1] - a[1]);
  const own = ranked.filter(([id]) => declared.has(id));
  const hubs = (own.length >= 3 ? own : ranked).slice(0, 10);
  const external_hubs = ranked.filter(([id]) => !declared.has(id)).slice(0, 10).map(([id, d]) => ({ id, in_degree: d }));
  const largest = graph.nodes.filter((n) => n.kind === 'file').sort((a, b) => (b.loc || 0) - (a.loc || 0)).slice(0, 3);
  return {
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    node_counts_by_kind: byKind,
    top_hubs: hubs.map(([id, d]) => ({ id, in_degree: d })),
    edge_counts_by_kind: edgeKinds,
    largest_files: largest.map((n) => ({ file: n.file!, loc: n.loc || 0 })),
    branches_found: graph.branches_found,
    files_by_language: byLang,
    external_hubs,
  };
}
export type Summary = ReturnType<typeof summarize>;
