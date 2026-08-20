#!/usr/bin/env node
/**
 * Standalone test CLI for the brewmaster YAML → PDF / DOCX converters.
 *
 * Lets you test the converters without Kimi Code or the MCP server:
 *
 *   node dist/test-convert.mjs <recipe.yaml> [output-dir]
 *
 * Generates `<recipe>.pdf` and `<recipe>.docx` next to the input (or in the
 * given output directory) and prints the paths.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

import { yamlToPdf } from './brewing/yaml-to-pdf';
import { yamlToDocx } from './brewing/yaml-to-docx';

function main(): void {
  const args = process.argv.slice(2);
  const input = args[0];
  if (!input || !existsSync(input)) {
    console.error('Usage: node dist/test-convert.mjs <recipe.yaml> [output-dir]');
    process.exit(1);
  }

  const outDir = args[1] ?? dirname(input);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const base = basename(input).replace(/\.ya?ml$/i, '');
  const pdfPath = join(outDir, `${base}.pdf`);
  const docxPath = join(outDir, `${base}.docx`);

  const pdfResult = yamlToPdf(input, pdfPath);
  console.log(pdfResult);

  const docxResult = yamlToDocx(input, docxPath);
  console.log(docxResult);
}

main();