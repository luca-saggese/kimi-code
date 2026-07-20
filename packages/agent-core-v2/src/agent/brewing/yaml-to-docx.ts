/**
 * YAML to DOCX converter — converts a beer recipe YAML file to a .docx document.
 * Uses a built-in Python script (python-docx) via Bash.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const YamlToDocxInputSchema = z.object({
  input_file: z.string().describe('Path to the recipe YAML file.'),
  output_file: z.string().optional().describe('Path for the output .docx file. Defaults to input_file with .docx extension.'),
});

export type YamlToDocxInput = z.infer<typeof YamlToDocxInputSchema>;

const PYTHON_SCRIPT = `import sys, yaml, os
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

def add_heading(doc, text, level=1):
    h = doc.add_heading(text, level=level)
    return h

def add_key_value(doc, key, value, bold_key=True):
    p = doc.add_paragraph()
    if bold_key:
        run = p.add_run(f"{key}: ")
        run.bold = True
    p.add_run(str(value) if value is not None else '-')
    return p

def add_table(doc, headers, rows):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Light Grid Accent 1'
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = str(h)
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            table.rows[ri + 1].cells[ci].text = str(val) if val is not None else '-'
    doc.add_paragraph()
    return table

def main():
    if len(sys.argv) < 2:
        print("Usage: yaml_to_docx.py <input.yaml> [output.docx]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(input_path)[0] + '.docx'

    with open(input_path, 'r') as f:
        data = yaml.safe_load(f)

    doc = Document()

    # Title
    title = doc.add_heading(data.get('nome', 'Ricetta di Birra'), level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    if data.get('stile'):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f"Stile: {data['stile']}")
        run.italic = True

    if data.get('descrizione'):
        doc.add_paragraph(data['descrizione'])

    doc.add_paragraph()

    # Parameters
    params = data.get('parametri', {})
    if params:
        add_heading(doc, 'Parametri', level=1)
        param_order = ['batch_size_litri', 'og', 'fg', 'abv_percent', 'ibu', 'ebc',
                       'efficienza_percent', 'impianto', 'volume_fermentatore']
        for key in param_order:
            if key in params:
                add_key_value(doc, key.replace('_', ' ').title(), params[key])
        for key, val in params.items():
            if key not in param_order:
                add_key_value(doc, key.replace('_', ' ').title(), val)

    # Grist
    grist = data.get('grist', [])
    if grist:
        add_heading(doc, 'Grist', level=1)
        headers = ['Malto', 'Kg', '%', 'Note']
        rows = [[g.get('malto', ''), g.get('kg', ''), g.get('percent', ''), g.get('note', '')] for g in grist]
        add_table(doc, headers, rows)

    # Hops
    hops = data.get('luppolatura', [])
    if hops:
        add_heading(doc, 'Luppolatura', level=1)
        headers = ['Variet\u00e0', 'Grammi', 'Tempo (min)', 'Uso', 'AA%', 'IBU stimati', 'Note']
        rows = [[h.get('varieta', ''), h.get('grammi', ''), h.get('tempo_min', ''),
                 h.get('uso', ''), h.get('aa_percent', ''), h.get('ibu_stimati', ''),
                 h.get('note', '')] for h in hops]
        add_table(doc, headers, rows)

    # Yeast
    yeast = data.get('lievito', {})
    if yeast:
        add_heading(doc, 'Lievito', level=1)
        for key, val in yeast.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Water
    water = data.get('acqua', {})
    if water:
        add_heading(doc, 'Acqua', level=1)
        for key, val in water.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Mash
    mash = data.get('mash', {})
    if mash:
        add_heading(doc, 'Mash', level=1)
        for key, val in mash.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Boil
    boil = data.get('bollitura', {})
    if boil:
        add_heading(doc, 'Bollitura', level=1)
        for key, val in boil.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Fermentation
    ferm = data.get('fermentazione', {})
    if ferm:
        add_heading(doc, 'Fermentazione', level=1)
        for key, val in ferm.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Carbonation
    carb = data.get('carbonazione', {})
    if carb:
        add_heading(doc, 'Carbonazione', level=1)
        for key, val in carb.items():
            add_key_value(doc, key.replace('_', ' ').title(), val)

    # Critical notes
    notes = data.get('note_critiche', [])
    if notes:
        add_heading(doc, 'Note Critiche', level=1)
        for note in notes:
            doc.add_paragraph(note, style='List Bullet')

    # Alternatives
    alts = data.get('alternative', [])
    if alts:
        add_heading(doc, 'Alternative', level=1)
        for alt in alts:
            if isinstance(alt, dict):
                doc.add_paragraph(alt.get('descrizione', ''), style='List Bullet')
                if alt.get('cambiamenti'):
                    doc.add_paragraph(f"Cambiamenti: {alt['cambiamenti']}")
                if alt.get('impatto'):
                    doc.add_paragraph(f"Impatto: {alt['impatto']}")

    doc.save(output_path)
    print(f"DOCX saved: {output_path}")

if __name__ == '__main__':
    main()
`;

const VENV_SETUP = `
import subprocess, sys, os, venv

VENV_DIR = os.path.join(os.path.dirname(__file__), '.venv-brewing')
PIP = os.path.join(VENV_DIR, 'bin', 'pip') if os.name != 'nt' else os.path.join(VENV_DIR, 'Scripts', 'pip.exe')

if not os.path.exists(VENV_DIR):
    venv.create(VENV_DIR, with_pip=True)
    subprocess.check_call([PIP, 'install', 'pyyaml', 'python-docx'])
`;

export class YamlToDocxTool implements BuiltinTool<YamlToDocxInput> {
  readonly name = 'yaml_to_docx' as const;
  readonly description =
    'Convert a beer recipe YAML file to a .docx (Word) document. Handles all standard recipe fields (parameters, grist, hops, yeast, water, mash, boil, fermentation, carbonation, notes, alternatives) and any extra custom fields.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(YamlToDocxInputSchema);

  resolveExecution(args: YamlToDocxInput): ToolExecution {
    const inputFile = args.input_file;
    const outputFile = args.output_file ?? inputFile.replace(/\.ya?ml$/i, '') + '.docx';

    return {
      description: `Convert ${inputFile} → DOCX`,
      approvalRule: this.name,
      execute: async () => {
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const os = await import('node:os');
          const { execSync } = await import('node:child_process');

          if (!fs.existsSync(inputFile)) {
            return { isError: true, output: `File not found: ${inputFile}` };
          }

          // Write the Python script to a temp location
          const tmpDir = os.tmpdir();
          const scriptPath = path.join(tmpDir, 'kimi_brewing_yaml_to_docx.py');
          fs.writeFileSync(scriptPath, PYTHON_SCRIPT, 'utf-8');

          // Ensure venv with python-docx + pyyaml
          const venvDir = path.join(tmpDir, '.venv-brewing');
          const pythonCmd = path.join(venvDir, 'bin', 'python3');
          const pipCmd = path.join(venvDir, 'bin', 'pip');

          if (!fs.existsSync(venvDir)) {
            execSync(`python3 -m venv "${venvDir}"`, { stdio: 'pipe' });
            execSync(`"${pipCmd}" install pyyaml python-docx`, { stdio: 'pipe' });
          }

          // Execute
          const result = execSync(
            `"${pythonCmd}" "${scriptPath}" "${inputFile}" "${outputFile}"`,
            { encoding: 'utf-8', timeout: 30000 },
          );

          return { output: result.trim() };
        } catch (error) {
          return {
            isError: true,
            output: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }
}

registerTool(YamlToDocxTool);
