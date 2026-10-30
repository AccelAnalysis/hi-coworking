#!/usr/bin/env node
/**
 * Fails if any exported client chunk uses JavaScript syntax that Safari 15 / iPadOS 15 cannot parse.
 *
 * Safari 15.6 (the newest Safari on iPadOS 15.8) parses ES2022 class fields and private members,
 * but not class static blocks (`static { ... }`) or RegExp lookbehind (`(?<=` / `(?<!`), both added
 * in Safari 16.4. One unparseable shared chunk stops every page from hydrating, so the front-desk
 * kiosk iPad sits on its loading screen. apps/web/package.json "browserslist" keeps Next/SWC
 * lowering this syntax; this check proves the build output still honors it.
 *
 * Usage: node scripts/check-legacy-safari-syntax.mjs [apps/web/out/_next]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as acorn from "acorn";

const dir = path.resolve(process.argv[2] ?? "apps/web/out/_next");
const files = [];
(function walkDir(d) {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    if (statSync(p).isDirectory()) walkDir(p);
    else if (p.endsWith(".js")) files.push(p);
  }
})(dir);

const problems = [];
const snippet = (src, at) => src.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ");
const hasLookbehind = (pattern) => /\(\?<[=!]/.test(pattern);

function visit(node, onNode) {
  if (!node || typeof node.type !== "string") return;
  onNode(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => visit(child, onNode));
    else if (value && typeof value.type === "string") visit(value, onNode);
  }
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(dir, file);
  let ast;
  try {
    // ES2022 is the newest syntax level Safari 15.6 fully parses, minus the checks below.
    ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script" });
  } catch (error) {
    problems.push(`${rel}: not parseable as ES2022 (${error.message})`);
    continue;
  }
  visit(ast, (node) => {
    if (node.type === "StaticBlock") {
      problems.push(`${rel}: class static block: ${snippet(src, node.start)}`);
    } else if (node.type === "Literal" && node.regex) {
      if (hasLookbehind(node.regex.pattern)) problems.push(`${rel}: RegExp lookbehind: ${snippet(src, node.start)}`);
      if (node.regex.flags.includes("v")) problems.push(`${rel}: RegExp v flag: ${snippet(src, node.start)}`);
    } else if (
      (node.type === "NewExpression" || node.type === "CallExpression") &&
      node.callee?.name === "RegExp" &&
      node.arguments[0]?.type === "Literal" &&
      typeof node.arguments[0].value === "string" &&
      hasLookbehind(node.arguments[0].value)
    ) {
      problems.push(`${rel}: RegExp lookbehind: ${snippet(src, node.start)}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Safari 15 syntax check failed (${problems.length} problem(s) in ${files.length} chunks):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Safari 15 syntax check passed: ${files.length} chunks parse without static blocks or lookbehind.`);
