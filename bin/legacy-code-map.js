#!/usr/bin/env node

// src/cli.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");

// src/extract.ts
var LANG = {
  ".xpp": "xpp",
  ".xpo": "xpp",
  ".cs": "cs",
  ".sql": "sql",
  ".pls": "plsql",
  ".pkb": "plsql",
  ".pks": "plsql",
  ".plsql": "plsql",
  ".prc": "plsql",
  ".fnc": "plsql",
  ".trg": "plsql",
  ".pck": "plsql",
  ".cbl": "cobol",
  ".cob": "cobol",
  ".cobol": "cobol",
  ".cpy": "cobol",
  ".rpg": "rpg",
  ".rpgle": "rpg",
  ".sqlrpgle": "rpg",
  ".rpg4": "rpg",
  ".clle": "rpg",
  ".clp": "rpg",
  ".abap": "abap",
  ".bas": "vb",
  ".cls": "vb",
  ".frm": "vb",
  ".vb": "vb",
  ".ctl": "vb",
  ".pas": "delphi",
  ".dpr": "delphi",
  ".dpk": "delphi",
  ".java": "java",
  ".py": "py",
  ".js": "js",
  ".jsx": "js",
  ".ts": "js",
  ".tsx": "js",
  ".mjs": "js",
  ".php": "php",
  ".p": "progress",
  ".w": "progress",
  ".i": "progress",
  ".xml": "axxml"
};
var EXTS = Object.keys(LANG);
function ext(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}
function all(re, text) {
  return Array.from(text.matchAll(re));
}
var ID = /[A-Za-z_][A-Za-z0-9_$#-]*/.source;
var SKIP = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "return", "new", "select", "from", "where", "and", "or", "not", "set", "values", "dual", "the", "a"]);
function decl(o, prefix, fileId, kind, name) {
  if (!name || SKIP.has(name.toLowerCase())) return;
  o.nodes.push({ id: `${prefix}_${name}`, file: fileId, kind, name });
}
function edge(o, prefix, fileId, kind, name) {
  if (!name || SKIP.has(name.toLowerCase())) return;
  o.edges.push({ from: fileId, to: `${prefix}_${name}`, kind });
}
function embeddedSql(o, c, fileId) {
  for (const m of all(new RegExp(String.raw`\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["\[\`]?(?:\w+\.)?(${ID})`, "gi"), c))
    edge(o, "sql", fileId, "sql_reference", m[1]);
}
function extractXpp(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/(?:public|private|protected|internal)?\s*(?:static\s+)?\b(?:class|table|form|view|dataentity)\s+([A-Za-z0-9_]+)/gi, c))
    decl(o, "xpp", fileId, "xpp_declaration", m[1]);
  for (const m of all(/\[ExtensionOf\s*\(\s*(?:classStr|tableStr|formStr)\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*\)\s*\]/gi, c)) {
    o.nodes.push({ id: `xpp_ext_${m[1]}`, file: fileId, kind: "xpp_extension", name: m[1] });
    edge(o, "xpp", fileId, "extends", m[1]);
  }
  for (const m of all(/\bclass\s+[A-Za-z0-9_]+\s+extends\s+([A-Za-z0-9_]+)/gi, c)) edge(o, "xpp", fileId, "extends", m[1]);
  for (const m of all(/\bselect\s+(?:(?:firstonly\d*|firstfast|forupdate|crosscompany|forceselectorder|forceplaceholders|forceliterals|forcenestedloop|nofetch|reverse|pessimisticlock|optimisticlock|repeatableread|generateonly)\s+)*(?:(?:count|sum|avg|minof|maxof)\s*\([^)]*\)\s+from\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi, c))
    if (!/^(count|sum|avg|minof|maxof|from)$/i.test(m[1])) edge(o, "xpp", fileId, "reads_table", m[1]);
  for (const m of all(/([A-Za-z0-9_]+)::[A-Za-z0-9_]+/g, c)) edge(o, "xpp", fileId, "calls_static", m[1]);
  return o;
}
function extractAxXml(c, fileId) {
  const o = { nodes: [], edges: [] };
  const t = c.match(/<(Ax[A-Za-z]+)\b/);
  if (!t) return o;
  const type = t[1];
  const name = (c.match(/<Name>([^<]+)<\/Name>/) || [])[1];
  if (name) {
    if (/Extension$/.test(type) && name.includes(".")) {
      const base = name.split(".")[0];
      o.nodes.push({ id: `xpp_ext_${name.replace(".", "_")}`, file: fileId, kind: "xpp_extension", name });
      edge(o, "xpp", fileId, "extends", base);
    } else decl(o, "xpp", fileId, `xpp_${type.slice(2).toLowerCase()}`, name);
  }
  for (const m of all(/<RelatedTable>([A-Za-z0-9_]+)<\/RelatedTable>/g, c)) edge(o, "xpp", fileId, "table_relation", m[1]);
  for (const m of all(/<Table>([A-Za-z0-9_]+)<\/Table>/g, c)) edge(o, "xpp", fileId, "reads_table", m[1]);
  for (const m of all(/<Extends>([A-Za-z0-9_]+)<\/Extends>/g, c)) edge(o, "xpp", fileId, "extends", m[1]);
  const code = all(/<!\[CDATA\[([\s\S]*?)\]\]>/g, c).map((m) => m[1]).join("\n");
  if (code) {
    const r = extractXpp(code, fileId);
    o.nodes.push(...r.nodes.filter((n) => n.name !== name));
    o.edges.push(...r.edges);
  }
  return o;
}
function extractSql(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:PROCEDURE|PROC|TABLE|VIEW|FUNCTION|TRIGGER)\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    decl(o, "sql", fileId, "sql_declaration", m[1]);
  for (const m of all(/(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    edge(o, "sql", fileId, "sql_reference", m[1]);
  for (const m of all(/EXEC(?:UTE)?\s+\[?(?:\w+\]?\.\[?)?([A-Za-z0-9_]+)\]?/gi, c))
    edge(o, "sql", fileId, "sql_calls", m[1]);
  return o;
}
function extractPlsql(c, fileId) {
  const o = extractSql(c, fileId);
  for (const m of all(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+)?PACKAGE\s+(?:BODY\s+)?(?:"?\w+"?\.)?"?([A-Za-z0-9_$#]+)"?/gi, c))
    decl(o, "sql", fileId, "plsql_package", m[1]);
  for (const m of all(/\b([A-Za-z][A-Za-z0-9_$#]*)\.([A-Za-z][A-Za-z0-9_$#]*)\s*\(/g, c))
    if (!/^(dbms_|utl_|sys|apex_)/i.test(m[1])) edge(o, "sql", fileId, "sql_calls", m[1]);
  return o;
}
function extractCs(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/(?:public|private|protected|internal)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|interface|struct|record)\s+([A-Za-z0-9_]+)/g, c))
    decl(o, "cs", fileId, "cs_declaration", m[1]);
  for (const m of all(/new\s+([A-Za-z0-9_]+)\s*[(<]/g, c)) edge(o, "cs", fileId, "cs_instantiates", m[1]);
  for (const m of all(/^\s*using\s+([A-Za-z0-9_.]+)\s*;/gm, c)) edge(o, "cs", fileId, "imports", m[1].split(".").pop());
  embeddedSql(o, c, fileId);
  return o;
}
function extractCobol(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/PROGRAM-ID\.\s*['"]?([A-Za-z0-9-]+)/gi, c)) decl(o, "cobol", fileId, "cobol_program", m[1].toUpperCase());
  for (const m of all(/\bCALL\s+['"]([A-Za-z0-9-]+)['"]/gi, c)) edge(o, "cobol", fileId, "calls_program", m[1].toUpperCase());
  for (const m of all(/^[ \d]{0,7}\s*COPY\s+['"]?([A-Za-z0-9-]+)/gim, c)) edge(o, "cobol", fileId, "includes_copybook", m[1].toUpperCase());
  for (const m of all(/\bSELECT\s+([A-Za-z0-9-]+)\s+ASSIGN\b/gi, c)) edge(o, "cobol", fileId, "uses_file", m[1].toUpperCase());
  for (const m of all(/EXEC\s+SQL([\s\S]*?)END-EXEC/gi, c)) embeddedSql(o, m[1], fileId);
  for (const m of all(/EXEC\s+CICS\s+(?:LINK|XCTL)\s+PROGRAM\s*\(\s*['"]?([A-Za-z0-9-]+)/gi, c)) edge(o, "cobol", fileId, "calls_program", m[1].toUpperCase());
  return o;
}
function extractRpg(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/\bdcl-f\s+(\w+)/gi, c)) edge(o, "rpg", fileId, "uses_file", m[1].toUpperCase());
  for (const m of all(/^.{5}F(\w{1,10})\s+[IUOC]/gim, c)) edge(o, "rpg", fileId, "uses_file", m[1].toUpperCase());
  for (const m of all(/EXTPGM\s*\(\s*'(\w+)'/gi, c)) edge(o, "rpg", fileId, "calls_program", m[1].toUpperCase());
  for (const m of all(/\bCALL\s+(?:PGM\s*\(\s*)?(?:\w+\/)?'?(\w+)'?/gi, c)) edge(o, "rpg", fileId, "calls_program", m[1].toUpperCase());
  for (const m of all(/\bdcl-proc\s+(\w+)/gi, c)) decl(o, "rpg", fileId, "rpg_procedure", m[1].toUpperCase());
  for (const m of all(/\/(?:COPY|INCLUDE)\s+(?:\S+,)?(\w+)/gi, c)) edge(o, "rpg", fileId, "includes_copybook", m[1].toUpperCase());
  for (const m of all(/EXEC\s+SQL([\s\S]*?);/gi, c)) embeddedSql(o, m[1], fileId);
  return o;
}
function extractAbap(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/^\s*(?:REPORT|PROGRAM|FUNCTION-POOL)\s+(\w+)/gim, c)) decl(o, "abap", fileId, "abap_program", m[1].toUpperCase());
  for (const m of all(/^\s*CLASS\s+(\w+)\s+DEFINITION/gim, c)) decl(o, "abap", fileId, "abap_class", m[1].toUpperCase());
  for (const m of all(/^\s*FUNCTION\s+(\w+)\s*\./gim, c)) decl(o, "abap", fileId, "abap_function", m[1].toUpperCase());
  for (const m of all(/CALL\s+FUNCTION\s+'(\w+)'/gi, c)) edge(o, "abap", fileId, "calls_function", m[1].toUpperCase());
  for (const m of all(/\bPERFORM\s+(\w+)/gi, c)) edge(o, "abap", fileId, "calls_form", m[1].toUpperCase());
  for (const m of all(/^\s*INCLUDE\s+(\w+)/gim, c)) edge(o, "abap", fileId, "includes", m[1].toUpperCase());
  for (const m of all(/\bSUBMIT\s+(\w+)/gi, c)) edge(o, "abap", fileId, "calls_program", m[1].toUpperCase());
  for (const m of all(/\bSELECT\b[\s\S]{0,400}?\bFROM\s+(\w+)/gi, c)) edge(o, "sql", fileId, "sql_reference", m[1].toUpperCase());
  for (const m of all(/\b(?:UPDATE|MODIFY|INSERT|DELETE)\s+(?:FROM\s+)?(\w+)\s+(?:SET|FROM|VALUES)/gi, c)) edge(o, "sql", fileId, "sql_reference", m[1].toUpperCase());
  return o;
}
function extractVb(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/Attribute\s+VB_Name\s*=\s*"(\w+)"/gi, c)) decl(o, "vb", fileId, "vb_module", m[1]);
  for (const m of all(/^\s*(?:Public\s+|Friend\s+|Private\s+)?(?:Partial\s+)?(?:Class|Module|Interface)\s+(\w+)/gim, c)) decl(o, "vb", fileId, "vb_module", m[1]);
  for (const m of all(/\bNew\s+(\w+)/g, c)) edge(o, "vb", fileId, "vb_instantiates", m[1]);
  for (const m of all(/CreateObject\s*\(\s*"([\w.]+)"/gi, c)) edge(o, "vb", fileId, "com_dependency", m[1]);
  for (const m of all(/Declare\s+(?:PtrSafe\s+)?(?:Function|Sub)\s+\w+\s+Lib\s+"([\w.]+)"/gi, c)) edge(o, "vb", fileId, "native_dll", m[1]);
  for (const m of all(/^\s*Imports\s+([\w.]+)/gim, c)) edge(o, "vb", fileId, "imports", m[1].split(".").pop());
  embeddedSql(o, c, fileId);
  return o;
}
function extractDelphi(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/^\s*(?:unit|program|library)\s+([\w.]+)\s*;/gim, c)) decl(o, "pas", fileId, "delphi_unit", m[1]);
  for (const m of all(/\buses\s+([\s\S]*?);/gi, c))
    for (const u of m[1].split(",")) {
      const n = u.trim().split(/\s+/)[0];
      if (n) edge(o, "pas", fileId, "imports", n);
    }
  for (const m of all(/(\w+)\s*=\s*class\s*\(\s*(\w+)/gi, c)) {
    decl(o, "pas", fileId, "delphi_class", m[1]);
    edge(o, "pas", fileId, "extends", m[2]);
  }
  embeddedSql(o, c, fileId);
  return o;
}
function extractJava(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|interface|enum|record)\s+([A-Za-z0-9_]+)/g, c)) decl(o, "java", fileId, "java_declaration", m[1]);
  for (const m of all(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm, c)) edge(o, "java", fileId, "imports", m[1].split(".").pop());
  for (const m of all(/\bextends\s+([A-Za-z0-9_]+)/g, c)) edge(o, "java", fileId, "extends", m[1]);
  for (const m of all(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*[(<]/g, c)) edge(o, "java", fileId, "instantiates", m[1]);
  embeddedSql(o, c, fileId);
  return o;
}
function extractPy(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/^class\s+(\w+)/gm, c)) decl(o, "py", fileId, "py_class", m[1]);
  for (const m of all(/^def\s+(\w+)/gm, c)) decl(o, "py", fileId, "py_function", m[1]);
  for (const m of all(/^\s*from\s+([\w.]+)\s+import/gm, c)) edge(o, "py", fileId, "imports", m[1].split(".").pop());
  for (const m of all(/^\s*import\s+([\w.]+)/gm, c)) edge(o, "py", fileId, "imports", m[1].split(".").pop());
  embeddedSql(o, c, fileId);
  return o;
}
function extractJs(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|function)\s+([A-Za-z0-9_$]+)/g, c)) decl(o, "js", fileId, "js_declaration", m[1]);
  for (const m of all(/(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g, c)) {
    const mod = m[1].split("/").pop().replace(/\.(m?js|jsx?|tsx?)$/, "");
    if (mod) edge(o, "js", fileId, "imports", mod);
  }
  return o;
}
function extractPhp(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/\b(?:class|interface|trait)\s+([A-Za-z0-9_]+)/g, c)) decl(o, "php", fileId, "php_declaration", m[1]);
  for (const m of all(/\bnew\s+\\?([A-Za-z0-9_\\]+)/g, c)) edge(o, "php", fileId, "instantiates", m[1].split("\\").pop());
  for (const m of all(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g, c)) edge(o, "php", fileId, "includes", m[1].split("/").pop().replace(/\.php$/, ""));
  for (const m of all(/^\s*use\s+([\w\\]+)/gm, c)) edge(o, "php", fileId, "imports", m[1].split("\\").pop());
  embeddedSql(o, c, fileId);
  return o;
}
function extractProgress(c, fileId) {
  const o = { nodes: [], edges: [] };
  for (const m of all(/\bRUN\s+([\w/.-]+\.[pw])\b/gi, c)) edge(o, "abl", fileId, "calls_program", m[1].split("/").pop());
  for (const m of all(/\{([\w/.-]+\.i)\b/gi, c)) edge(o, "abl", fileId, "includes", m[1].split("/").pop());
  for (const m of all(/\b(?:FOR\s+(?:EACH|FIRST|LAST)|FIND\s+(?:FIRST|LAST|NEXT)?|CAN-FIND\s*\(\s*(?:FIRST\s+)?)\s*(\w+)/gi, c))
    edge(o, "sql", fileId, "sql_reference", m[1]);
  for (const m of all(/^\s*(?:PROCEDURE|FUNCTION)\s+([\w-]+)/gim, c)) decl(o, "abl", fileId, "abl_procedure", m[1]);
  return o;
}
var EXTRACT = {
  xpp: extractXpp,
  axxml: extractAxXml,
  sql: extractSql,
  plsql: extractPlsql,
  cs: extractCs,
  cobol: extractCobol,
  rpg: extractRpg,
  abap: extractAbap,
  vb: extractVb,
  delphi: extractDelphi,
  java: extractJava,
  py: extractPy,
  js: extractJs,
  php: extractPhp,
  progress: extractProgress
};
var SUPPORTED_LANGUAGES = "X++ (AX 2012 XPO and D365 metadata XML), T-SQL, PL/SQL, COBOL, RPG, ABAP, VB6/VB.NET, Delphi, Progress ABL, C#, Java, Python, JavaScript/TypeScript and PHP";
function summarize(graph) {
  const byKind = {};
  for (const n of graph.nodes) byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  const inDeg = {};
  const edgeKinds = {};
  for (const e of graph.edges) {
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    edgeKinds[e.kind] = (edgeKinds[e.kind] || 0) + 1;
  }
  const byLang = {};
  for (const n of graph.nodes) if (n.kind === "file") byLang[n.language || "other"] = (byLang[n.language || "other"] || 0) + 1;
  const declared = new Set(graph.nodes.filter((n) => n.kind !== "file").map((n) => n.id));
  const ranked = Object.entries(inDeg).sort((a, b) => b[1] - a[1]);
  const own = ranked.filter(([id]) => declared.has(id));
  const hubs = (own.length >= 3 ? own : ranked).slice(0, 10);
  const external_hubs = ranked.filter(([id]) => !declared.has(id)).slice(0, 10).map(([id, d]) => ({ id, in_degree: d }));
  const largest = graph.nodes.filter((n) => n.kind === "file").sort((a, b) => (b.loc || 0) - (a.loc || 0)).slice(0, 3);
  return {
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    node_counts_by_kind: byKind,
    top_hubs: hubs.map(([id, d]) => ({ id, in_degree: d })),
    edge_counts_by_kind: edgeKinds,
    largest_files: largest.map((n) => ({ file: n.file, loc: n.loc || 0 })),
    branches_found: graph.branches_found,
    files_by_language: byLang,
    external_hubs
  };
}

// src/cli.ts
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", ".svn", "bin", "obj", "dist", "build", ".next", "__pycache__", "vendor"]);
function walk(dir, out) {
  for (const name of (0, import_node_fs.readdirSync)(dir)) {
    const p = (0, import_node_path.join)(dir, name);
    let st;
    try {
      st = (0, import_node_fs.statSync)(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(p, out);
    } else if (ext(name) in LANG && st.size < 20 * 1024 * 1024) out.push(p);
  }
}
function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    console.log(`legacy-code-map <folder> [--json out.json] [--top N]

Maps declarations and dependencies in legacy source code.
Reads: ${SUPPORTED_LANGUAGES}.
Nothing leaves your machine.`);
    process.exit(args.length ? 0 : 1);
  }
  const root = args[0];
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : "";
  const top = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) || 10 : 10;
  const files = [];
  walk(root, files);
  const nodes = [];
  const edges = [];
  const hashes = /* @__PURE__ */ new Map();
  const branches = /* @__PURE__ */ new Map();
  for (const abs of files) {
    const rel = (0, import_node_path.relative)(root, abs).split(import_node_path.sep).join("/");
    const parts = rel.split("/");
    const branch = parts.length > 1 ? parts[0] : "root";
    const fileId = `file_${rel.replace(/\//g, "_")}`;
    const content = (0, import_node_fs.readFileSync)(abs, "utf8");
    const h = (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
    const canonical = hashes.get(h);
    if (canonical) {
      branches.get(canonical).push(branch);
      continue;
    }
    hashes.set(h, fileId);
    branches.set(fileId, [branch]);
    const e = ext(rel);
    const lang = LANG[e];
    nodes.push({ id: fileId, file: rel, kind: "file", extension: e, language: lang || "other", size: content.length, loc: content.split("\n").length });
    const fn = lang ? EXTRACT[lang] : void 0;
    if (fn) {
      const r = fn(content, fileId);
      nodes.push(...r.nodes);
      edges.push(...r.edges);
    }
  }
  const dupes = [...branches.values()].filter((b) => b.length > 1).length;
  const all2 = /* @__PURE__ */ new Set();
  for (const bs of branches.values()) for (const b of bs) all2.add(b);
  const graph = { nodes, edges, branches_found: all2.size };
  const s = summarize(graph);
  const hubs = s.top_hubs.slice(0, top).map((h) => [h.id, h.in_degree]);
  const ext_hubs = s.external_hubs.slice(0, Math.min(top, 5));
  const largest = nodes.filter((n) => n.kind === "file").sort((a, b) => (b.loc || 0) - (a.loc || 0)).slice(0, top);
  const fileCount = nodes.filter((n) => n.kind === "file").length;
  const loc = nodes.filter((n) => n.kind === "file").reduce((t, n) => t + (n.loc || 0), 0);
  const line = (t = "") => console.log(t);
  line(`
legacy-code-map \u2014 ${root}`);
  line(`${fileCount.toLocaleString()} source files \xB7 ${loc.toLocaleString()} lines \xB7 ${s.total_nodes.toLocaleString()} objects \xB7 ${s.total_edges.toLocaleString()} dependencies` + (dupes ? ` \xB7 ${dupes} files duplicated across folders` : ""));
  line(`
Files by language`);
  const LABEL = { axxml: "X++ (D365 XML)", xpp: "X++", cs: "C#", sql: "SQL", plsql: "PL/SQL", cobol: "COBOL", rpg: "RPG/CL", abap: "ABAP", vb: "VB", delphi: "Delphi", java: "Java", py: "Python", js: "JS/TS", php: "PHP", progress: "Progress", other: "other" };
  for (const [k, v] of Object.entries(s.files_by_language).sort((a, b) => b[1] - a[1])) line(`  ${(LABEL[k] || k).padEnd(16)} ${v}`);
  line(`
Most-referenced objects in this codebase (chokepoints)`);
  for (const [id, d] of hubs) line(`  ${String(d).padStart(5)}  ${id.split("_").slice(1).join("_") || id}  [${id.split("_")[0]}]`);
  if (ext_hubs.length) {
    line(`
Most-used platform/external objects`);
    for (const h of ext_hubs) line(`  ${String(h.in_degree).padStart(5)}  ${h.id.split("_").slice(1).join("_") || h.id}`);
  }
  line(`
Largest files`);
  for (const n of largest) line(`  ${String(n.loc).padStart(7)}  ${n.file}`);
  line(`
Dependency types`);
  for (const [k, v] of Object.entries(s.edge_counts_by_kind).sort((a, b) => b[1] - a[1])) line(`  ${k.padEnd(18)} ${v}`);
  if (jsonOut) {
    (0, import_node_fs.writeFileSync)(jsonOut, JSON.stringify({ summary: s, top_hubs: hubs, graph }, null, 1));
    line(`
Graph written to ${jsonOut}`);
  }
  line(`
Want the full picture? The hosted scanner adds AI-written subsystem analysis and a phased`);
  line(`migration blueprint: https://scan.tolmansolutions.com (free scan; code never stored).
`);
}
main();
