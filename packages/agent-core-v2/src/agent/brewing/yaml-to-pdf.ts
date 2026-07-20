/**
 * YAML to PDF converter — converts a beer recipe YAML file to a PDF document.
 * Pure Node.js: uses js-yaml for parsing, generates HTML, converts to PDF via
 * a minimal built-in PDF writer (no external dependencies beyond js-yaml).
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const YamlToPdfInputSchema = z.object({
  input_file: z.string().describe('Path to the recipe YAML file.'),
  output_file: z.string().optional().describe('Path for the output .pdf file. Defaults to input_file with .pdf extension.'),
});

export type YamlToPdfInput = z.infer<typeof YamlToPdfInputSchema>;

// ── Minimal PDF generator (no external deps) ────────────────────────────────

interface PdfState {
  pages: string[];
  currentPage: string;
  pageHeight: number;
  currentY: number;
  pageMargin: number;
}

function createPdfWriter(margin = 50): PdfState {
  return {
    pages: [],
    currentPage: '',
    pageHeight: 842, // A4 at 72 DPI
    currentY: margin,
    pageMargin: margin,
  };
}

function emitPage(state: PdfState): void {
  state.pages.push(state.currentPage);
  state.currentPage = '';
  state.currentY = state.pageMargin;
}

function streamStart(): string {
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
}

function finishPdf(state: PdfState): string {
  // Final object builder
  const contentObjs: string[] = [];
  const contentRefs: string[] = [];
  for (let i = 0; i < state.pages.length; i++) {
    const objNum = 3 + i;
    contentObjs.push(`${objNum} 0 obj\n<< /Length ${state.pages[i].length} >>\nstream\n${state.pages[i]}\nendstream\nendobj\n`);
    contentRefs.push(`${objNum} 0 R`);
  }
  const kids = contentRefs.map((r) => `  /Contents ${r}\n  /Parent 2 0 R\n  /Type /Page\n  /MediaBox [ 0 0 595 842 ]`).join('\n');
  const pageObjs: string[] = [];
  for (let i = 0; i < state.pages.length; i++) {
    const objNum = 3 + state.pages.length + i;
    pageObjs.push(`${objNum} 0 obj\n<<${kids.split('\n')[i * 4] ?? ''} >>\nendobj\n`);
  }
  const kidsRef = state.pages.map((_, i) => `${3 + state.pages.length + i} 0 R`).join(' ');
  return [
    streamStart(),
    `2 0 obj\n<< /Type /Pages /Kids [ ${kidsRef} ] /Count ${state.pages.length} >>\nendobj\n`,
    ...contentObjs,
    ...pageObjs,
    'trailer\n<< /Size ' + (3 + state.pages.length * 2) + ' /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
}

// ── HTML to PDF stream operations ───────────────────────────────────────────

function encodePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '');
}

function writeText(state: PdfState, text: string, x: number, y: number, fontSize: number, fontName = 'F1'): void {
  state.currentPage += `BT /${fontName} ${fontSize} Tf ${x} ${state.pageHeight - y} Td (${encodePdfText(text)}) Tj ET\n`;
}

function writeMultilineText(state: PdfState, text: string, x: number, fontSize: number, maxWidth: number, fontName = 'F1'): void {
  const words = text.split(' ');
  let line = '';
  const avgCharWidth = fontSize * 0.55;
  let y = state.currentY;
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (trial.length * avgCharWidth > maxWidth && line.length > 0) {
      if (y > state.pageHeight - state.pageMargin) { emitPage(state); y = state.pageMargin; }
      writeText(state, line, x, y, fontSize, fontName);
      y += fontSize * 1.4;
      line = word;
    } else {
      line = trial;
    }
  }
  if (line.length > 0) {
    if (y > state.pageHeight - state.pageMargin) { emitPage(state); y = state.pageMargin; }
    writeText(state, line, x, y, fontSize, fontName);
    y += fontSize * 1.4;
  }
  state.currentY = y;
}

// ── Font definitions ────────────────────────────────────────────────────────

const FONT_DEFS = `3 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>
endobj
`;

// ── YAML → styled PDF ───────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function yamlToPdf(inputPath: string, outputPath: string): string {
  const fs = require('node:fs');
  const yaml = require('js-yaml');

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data: Record<string, unknown> = yaml.load(raw);

  const state = createPdfWriter(45);
  const f = { norm: 'F1', bold: 'F2', italic: 'F3' };

  // Title
  const nome = String(data['nome'] ?? 'Ricetta di Birra');
  writeText(state, nome, 45, state.currentY, 20, f.bold);
  state.currentY += 28;

  // Style
  if (data['stile']) {
    writeText(state, String(data['stile']), 45, state.currentY, 12, f.italic);
    state.currentY += 20;
  }

  // Description
  if (data['descrizione']) {
    state.currentY += 4;
    writeMultilineText(state, String(data['descrizione']), 45, 10, 500, f.norm);
    state.currentY += 8;
  }

  // Helper: section heading
  function section(title: string): void {
    if (state.currentY > 780) emitPage(state);
    writeText(state, title, 45, state.currentY, 14, f.bold);
    state.currentY += 22;
  }

  // Parameters
  const params = data['parametri'] as Record<string, unknown> | undefined;
  if (params && Object.keys(params).length > 0) {
    section('Parametri');
    for (const [k, v] of Object.entries(params)) {
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      writeText(state, `${label}: ${v ?? '-'}`, 55, state.currentY, 11, f.norm);
      state.currentY += 16;
    }
    state.currentY += 6;
  }

  // Tables
  function simpleTable(title: string, header: string[], rows: string[][]): void {
    section(title);
    const cols = header.length;
    const colW = [200, 60, 55, 185].slice(0, cols);
    let x = 45;
    for (let c = 0; c < cols; c++) {
      writeText(state, header[c]!, x, state.currentY, 10, f.bold);
      x += colW[c]!;
    }
    state.currentY += 16;
    for (const row of rows) {
      if (state.currentY > 790) emitPage(state);
      x = 45;
      for (let c = 0; c < cols; c++) {
        writeText(state, String(row[c] ?? '-'), x, state.currentY, 10, f.norm);
        x += colW[c]!;
      }
      state.currentY += 14;
    }
    state.currentY += 6;
  }

  // Grist
  const grist = data['grist'] as Array<Record<string, unknown>> | undefined;
  if (grist && grist.length > 0) {
    simpleTable('Grist', ['Malto', 'Kg', '%', 'Note'],
      grist.map((g) => [String(g['malto'] ?? ''), String(g['kg'] ?? ''), String(g['percent'] ?? ''), String(g['note'] ?? '')]));
  }

  // Hops
  const hops = data['luppolatura'] as Array<Record<string, unknown>> | undefined;
  if (hops && hops.length > 0) {
    simpleTable('Luppolatura', ['Varietà', 'g', 'Tempo', 'Uso', 'AA%', 'IBU', 'Note'],
      hops.map((h) => [
        String(h['varieta'] ?? ''), String(h['grammi'] ?? ''), String(h['tempo_min'] ?? ''),
        String(h['uso'] ?? ''), String(h['aa_percent'] ?? ''), String(h['ibu_stimati'] ?? ''),
        String(h['note'] ?? ''),
      ]));
  }

  // Key-value sections
  function kv(sectionName: string, obj: Record<string, unknown> | undefined): void {
    if (!obj || Object.keys(obj).length === 0) return;
    section(sectionName);
    for (const [k, v] of Object.entries(obj)) {
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      writeText(state, `${label}: ${v ?? '-'}`, 55, state.currentY, 11, f.norm);
      state.currentY += 16;
    }
    state.currentY += 4;
  }

  kv('Lievito', data['lievito'] as Record<string, unknown> | undefined);
  kv('Acqua', data['acqua'] as Record<string, unknown> | undefined);
  kv('Mash', data['mash'] as Record<string, unknown> | undefined);
  kv('Bollitura', data['bollitura'] as Record<string, unknown> | undefined);
  kv('Fermentazione', data['fermentazione'] as Record<string, unknown> | undefined);
  kv('Carbonazione', data['carbonazione'] as Record<string, unknown> | undefined);

  // Critical notes
  const notes = data['note_critiche'];
  if (notes) {
    section('Note Critiche');
    const items: string[] = Array.isArray(notes) ? notes : String(notes).split('\n');
    for (const n of items) {
      const trimmed = String(n).trim();
      if (!trimmed) continue;
      writeText(state, `• ${trimmed}`, 55, state.currentY, 10, f.norm);
      state.currentY += 14;
    }
    state.currentY += 4;
  }

  // Alternatives
  const alts = data['alternative'] as Array<Record<string, unknown>> | undefined;
  if (alts && alts.length > 0) {
    section('Alternative');
    for (const a of alts) {
      writeText(state, `• ${String(a['descrizione'] ?? '')}`, 55, state.currentY, 10, f.bold);
      state.currentY += 14;
      if (a['cambiamenti']) {
        writeText(state, `  Cambiamenti: ${String(a['cambiamenti'])}`, 60, state.currentY, 10, f.norm);
        state.currentY += 14;
      }
      if (a['impatto']) {
        writeText(state, `  Impatto: ${String(a['impatto'])}`, 60, state.currentY, 10, f.norm);
        state.currentY += 14;
      }
    }
  }

  // Footer
  state.currentY += 10;
  writeText(state, 'Generato da Maestra Birraia AI — Kimi Code Brewing Assistant', 45, state.currentY, 8, f.italic);

  // Build PDF
  emitPage(state);
  const content = finishPdf(state);
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n${FONT_DEFS}\n${content}`;
  fs.writeFileSync(outputPath, pdf, 'utf-8');
  return `PDF saved: ${outputPath}`;
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export class YamlToPdfTool implements BuiltinTool<YamlToPdfInput> {
  readonly name = 'yaml_to_pdf' as const;
  readonly description =
    'Convert a beer recipe YAML file to a styled PDF document. Pure Node.js — no external dependencies needed.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(YamlToPdfInputSchema);

  resolveExecution(args: YamlToPdfInput): ToolExecution {
    const inputFile = args.input_file;
    const outputFile = args.output_file ?? inputFile.replace(/\.ya?ml$/i, '') + '.pdf';

    return {
      description: `Convert ${inputFile} → PDF`,
      approvalRule: this.name,
      execute: () => {
        try {
          const fs = require('node:fs');
          if (!fs.existsSync(inputFile)) {
            return Promise.resolve({ isError: true, output: `File not found: ${inputFile}` });
          }
          const result = yamlToPdf(inputFile, outputFile);
          return Promise.resolve({ output: result });
        } catch (error) {
          return Promise.resolve({ isError: true, output: error instanceof Error ? error.message : String(error) });
        }
      },
    };
  }
}

registerTool(YamlToPdfTool);
