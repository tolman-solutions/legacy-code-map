# legacy-code-map

Map the dependencies and migration chokepoints in a legacy codebase — locally, in seconds, with no install beyond Node.js.

Point it at a folder of source code and it tells you:

- how many source files, lines, objects and dependencies you have, by language
- **the most-referenced objects declared in your code** — the chokepoints where one change ripples everywhere
- the platform/kernel objects your code leans on most
- the largest files
- what kinds of dependencies hold it together (static calls, table reads, extensions, program calls, copybooks, embedded SQL…)
- files duplicated across folders or branches

Nothing leaves your machine.

## Languages

| Language | What is mapped |
|---|---|
| **X++** — AX 2012 `.xpo`, D365 F&O metadata `.xml` (AxClass, AxTable, AxForm…), `.xpp` | classes, tables, forms, extensions (`ExtensionOf`, `*Extension` objects), `extends`, static calls, selects, table relations |
| **T-SQL / SQL** | procedures, tables, views, functions; table references; `EXEC` calls |
| **PL/SQL** (`.pks .pkb .pls .prc .fnc .trg`) | packages, procedures; `package.proc()` calls; table references |
| **COBOL** (`.cbl .cob .cpy`) | `PROGRAM-ID`, `CALL`, CICS `LINK/XCTL`, `COPY` copybooks, `SELECT … ASSIGN` files, `EXEC SQL` tables |
| **RPG / CL** (`.rpgle .sqlrpgle .rpg .clle`) | `dcl-f` and F-spec files, `EXTPGM`/`CALL`, `/COPY`, embedded SQL |
| **ABAP** | reports, classes, function modules; `CALL FUNCTION`, `PERFORM`, `SUBMIT`, `INCLUDE`; Open SQL tables |
| **VB6 / VB.NET** | modules and classes; `New`, `CreateObject` COM dependencies, `Declare … Lib` DLLs, embedded SQL |
| **Delphi** | units, `uses`, class inheritance, embedded SQL |
| **Progress ABL** | `RUN` programs, includes, `FOR EACH`/`FIND` tables |
| **C#, Java, Python, JS/TS, PHP** | classes, imports, instantiation, embedded SQL |

Parsing is regex-based and fast. It is built for a first, honest picture of a large estate — not a compiler-grade cross-reference.

## Usage

```bash
# no install
npx github:tolman-solutions/legacy-code-map ./path/to/source

# options
npx github:tolman-solutions/legacy-code-map ./src --top 20 --json graph.json
```

`--json` writes the full graph (nodes and edges) for your own analysis or visualization.

## Example: an open-source D365 F&O codebase

Run against [TrudAX/XppTools](https://github.com/TrudAX/XppTools) (MIT), a well-known collection of open-source D365 Finance & Operations tools:

```
611 source files · 119,813 lines · 1,364 objects · 3,300 dependencies · 3 files duplicated across folders

Most-referenced objects in this codebase (chokepoints)
    112  DEV
     65  DEVTutorialArcadeJson
     46  DEVIntegConnectionTypeResource
     43  DEVIntegMessageTable
     38  DEVDimensionHelper

Most-used platform/external objects
    181  Types
    128  DateTimeUtil
```

The `DEV` utility class is referenced 112 times — exactly the kind of shared object to migrate and regression-test first.

## Want the full blueprint?

The hosted [Legacy Resurrector](https://scan.tolmansolutions.com) runs the same mapping on an uploaded ZIP, then uses AI agents to write a subsystem-by-subsystem analysis and a phased migration blueprint (AX 2012 → D365, ECC → S/4HANA, COBOL/RPG → cloud, VB6 → .NET and more). The scan is free; code is analyzed in memory and never stored.

Migration guides: <https://scan.tolmansolutions.com/guides>

## Build from source

```bash
npm install
npm run build   # bundles src/ into bin/legacy-code-map.js
```

## License

MIT © Tolman Solutions LLC
