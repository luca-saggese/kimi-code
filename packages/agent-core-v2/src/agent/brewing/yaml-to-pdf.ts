/**
 * YAML to PDF converter — converts a beer recipe YAML file to a .pdf document
 * via weasyprint with Unicode support for Italian text.
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

const PYTHON_SCRIPT = `import sys, yaml, os

def css():
    return """
    @page { size: A4; margin: 2cm; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }
    h1 { font-size: 22pt; text-align: center; color: #c0392b; margin-bottom: 4pt; }
    h2 { font-size: 14pt; color: #c0392b; border-bottom: 2px solid #c0392b; padding-bottom: 4pt; margin-top: 20pt; }
    .style-line { text-align: center; font-style: italic; color: #7f8c8d; margin-bottom: 12pt; }
    .description { background: #f9f9f9; padding: 10pt; border-left: 4px solid #c0392b; margin-bottom: 16pt; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0 16pt 0; font-size: 10pt; }
    th { background: #c0392b; color: white; padding: 6pt 8pt; text-align: left; font-weight: 600; }
    td { padding: 5pt 8pt; border-bottom: 1px solid #e0e0e0; }
    tr:nth-child(even) td { background: #fafafa; }
    .param-row { display: flex; gap: 20pt; margin: 4pt 0; }
    .param-label { font-weight: 600; min-width: 120pt; color: #555; }
    .param-value { color: #1a1a1a; }
    ul { margin: 4pt 0; padding-left: 18pt; }
    li { margin: 2pt 0; }
    .footer { text-align: center; font-size: 9pt; color: #bdc3c7; margin-top: 30pt; border-top: 1px solid #eee; padding-top: 10pt; }
    """

def esc(text):
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def fmt_val(v):
    if v is None: return '-'
    return esc(str(v))

def render_params(params):
    order = ['batch_size_litri', 'og', 'fg', 'abv_percent', 'ibu', 'ebc',
             'efficienza_percent', 'impianto', 'volume_fermentatore']
    html = '<div>'
    for key in order:
        if key in params:
            html += f'<div class="param-row"><span class="param-label">{esc(key.replace("_", " ").title())}:</span><span class="param-value">{fmt_val(params[key])}</span></div>'
    for key, val in params.items():
        if key not in order:
            html += f'<div class="param-row"><span class="param-label">{esc(key.replace("_", " ").title())}:</span><span class="param-value">{fmt_val(val)}</span></div>'
    html += '</div>'
    return html

def render_table(data, headers, keys):
    if not data: return ''
    html = '<table><tr>' + ''.join(f'<th>{esc(h)}</th>' for h in headers) + '</tr>'
    for row in data:
        html += '<tr>' + ''.join(f'<td>{fmt_val(row.get(k, ""))}</td>' for k in keys) + '</tr>'
    html += '</table>'
    return html

def render_kv(data, section_title):
    if not data: return ''
    html = f'<h2>{esc(section_title)}</h2>'
    for k, v in data.items():
        html += f'<div class="param-row"><span class="param-label">{esc(k.replace("_", " ").title())}:</span><span class="param-value">{fmt_val(v)}</span></div>'
    return html

def main():
    if len(sys.argv) < 2:
        print("Usage: yaml_to_pdf.py <input.yaml> [output.pdf]")
        sys.exit(1)
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(input_path)[0] + '.pdf'

    with open(input_path, 'r') as f:
        data = yaml.safe_load(f)

    html = f'''<!DOCTYPE html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>'''
    html += f'<h1>{esc(data.get("nome", "Ricetta di Birra"))}</h1>'
    if data.get('stile'):
        html += f'<p class="style-line">{esc(data["stile"])}</p>'
    if data.get('descrizione'):
        html += f'<div class="description">{esc(data["descrizione"])}</div>'
    params = data.get('parametri', {})
    if params:
        html += '<h2>Parametri</h2>'
        html += render_params(params)
    grist = data.get('grist', [])
    if grist:
        html += '<h2>Grist</h2>'
        html += render_table(grist, ['Malto', 'Kg', '%', 'Note'], ['malto', 'kg', 'percent', 'note'])
    hops = data.get('luppolatura', [])
    if hops:
        html += '<h2>Luppolatura</h2>'
        html += render_table(hops, ['Variet\u00e0', 'g', 'Tempo', 'Uso', 'AA%', 'IBU', 'Note'],
                             ['varieta', 'grammi', 'tempo_min', 'uso', 'aa_percent', 'ibu_stimati', 'note'])
    html += render_kv(data.get('lievito', {}), 'Lievito')
    html += render_kv(data.get('acqua', {}), 'Acqua')
    html += render_kv(data.get('mash', {}), 'Mash')
    html += render_kv(data.get('bollitura', {}), 'Bollitura')
    html += render_kv(data.get('fermentazione', {}), 'Fermentazione')
    html += render_kv(data.get('carbonazione', {}), 'Carbonazione')
    notes = data.get('note_critiche', [])
    if notes:
        html += '<h2>Note Critiche</h2><ul>'
        # Può essere una lista o una stringa multilinea
        if isinstance(notes, str):
            for line in notes.strip().split('\\n'):
                line = line.strip()
                if line:
                    html += f'<li>{esc(line)}</li>'
        else:
            for n in notes:
                html += f'<li>{esc(n)}</li>'
        html += '</ul>'
    alts = data.get('alternative', [])
    if alts:
        html += '<h2>Alternative</h2><ul>'
        for a in alts:
            if isinstance(a, dict):
                html += f'<li><strong>{esc(a.get("descrizione", ""))}</strong>'
                if a.get('cambiamenti'): html += f'<br/>Cambiamenti: {esc(a["cambiamenti"])}'
                if a.get('impatto'): html += f'<br/>Impatto: {esc(a["impatto"])}'
                html += '</li>'
        html += '</ul>'
    html += '<div class="footer">Generato da Maestra Birraia AI — Kimi Code Brewing Assistant</div>'
    html += '</body></html>'

    # Write HTML to temp file, convert to PDF via weasyprint
    tmp_html = output_path.replace('.pdf', '.tmp.html')
    with open(tmp_html, 'w', encoding='utf-8') as f:
        f.write(html)
    from weasyprint import HTML
    HTML(filename=tmp_html).write_pdf(output_path)
    os.unlink(tmp_html)
    print(f"PDF saved: {output_path}")

if __name__ == '__main__':
    main()
`;

export class YamlToPdfTool implements BuiltinTool<YamlToPdfInput> {
  readonly name = 'yaml_to_pdf' as const;
  readonly description =
    'Convert a beer recipe YAML file to a styled PDF document. Handles all recipe fields with a professional layout.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(YamlToPdfInputSchema);

  resolveExecution(args: YamlToPdfInput): ToolExecution {
    const inputFile = args.input_file;
    const outputFile = args.output_file ?? inputFile.replace(/\.ya?ml$/i, '') + '.pdf';

    return {
      description: `Convert ${inputFile} → PDF`,
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

          const tmpDir = os.tmpdir();
          const scriptPath = path.join(tmpDir, 'kimi_brewing_yaml_to_pdf.py');
          fs.writeFileSync(scriptPath, PYTHON_SCRIPT, 'utf-8');

          const venvDir = path.join(tmpDir, '.venv-brewing');
          const pythonCmd = path.join(venvDir, 'bin', 'python3');
          const pipCmd = path.join(venvDir, 'bin', 'pip');

          if (!fs.existsSync(venvDir)) {
            execSync(`python3 -m venv "${venvDir}"`, { stdio: 'pipe' });
            execSync(`"${pipCmd}" install pyyaml weasyprint`, { stdio: 'pipe' });
          } else {
            // Ensure weasyprint is installed in existing venv
            try {
              execSync(`"${pythonCmd}" -c "import weasyprint"`, { stdio: 'pipe' });
            } catch {
              execSync(`"${pipCmd}" install weasyprint`, { stdio: 'pipe' });
            }
          }

          const result = execSync(
            `"${pythonCmd}" "${scriptPath}" "${inputFile}" "${outputFile}"`,
            { encoding: 'utf-8', timeout: 60000 },
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

registerTool(YamlToPdfTool);
