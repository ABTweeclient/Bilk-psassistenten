/**
 * Driftkontroll för promptarna.
 *
 *   bun scripts/check-report-prompt.ts
 *
 * Varje prompt finns i två exemplar: en markdown-fil i prompts/ (för människor)
 * och en mall i src/lib/reportPrompt.ts (för Convex-bundlern, som inte kan läsa
 * markdown vid körning). Det här skriptet säger till när de två glider ifrån
 * varandra i något av de två stegen. Exitkod 1 vid drift.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reportPromptVersion,
  reportSearchPromptTemplate,
  reportSystemPromptTemplate,
} from "../src/lib/reportPrompt";

const pairs = [
  { file: "report-search-prompt.md", name: "söksteget", template: reportSearchPromptTemplate },
  { file: "report-system-prompt.md", name: "skrivsteget", template: reportSystemPromptTemplate },
] as const;

let drift = false;

for (const pair of pairs) {
  const markdownPath = join(import.meta.dir, "..", "prompts", pair.file);
  const fromMarkdown = readFileSync(markdownPath, "utf8").trim();
  const fromModule = pair.template.trim();

  if (fromMarkdown === fromModule) continue;

  drift = true;
  console.error(`AVVIKELSE: prompts/${pair.file} och mallen för ${pair.name} skiljer sig åt.`);

  const limit = Math.min(fromMarkdown.length, fromModule.length);
  let index = 0;
  while (index < limit && fromMarkdown[index] === fromModule[index]) index += 1;

  console.error(`Första skillnaden vid tecken ${index}:`);
  console.error(`  markdown: ${JSON.stringify(fromMarkdown.slice(index, index + 80))}`);
  console.error(`  modul:    ${JSON.stringify(fromModule.slice(index, index + 80))}`);
  console.error(`Längd: markdown ${fromMarkdown.length} tecken, modul ${fromModule.length} tecken.`);
}

if (drift) process.exit(1);

console.log(
  `OK: båda promptarna är identiska i markdown och modul (prompt_version ${reportPromptVersion}, ` +
    `${pairs.map((pair) => `${pair.name} ${pair.template.trim().length}`).join(", ")} tecken).`,
);
