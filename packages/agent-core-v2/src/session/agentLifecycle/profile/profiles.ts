/**
 * `agentLifecycle` domain (L6) — builtin agent profile contributions.
 *
 * Registers the default `agent` profile plus the `coder` / `explore` task-agent
 * profiles. The `plan` task-agent profile lives in the `plan` domain. Each
 * profile is self-contained: its `systemPrompt` renderer merges the shared base
 * template with its own role text at call time, so a child agent no longer
 * inherits the parent's prompt through a runtime overlay.
 *
 * Import-triggered registration: this module is side-effect-imported by
 * `./profile` so loading the `agentLifecycle` barrel populates the contribution
 * list before `AgentProfileCatalogService` constructs.
 */

import { collectGitContext } from '#/session/sessionFs/gitContext';
import { registerAgentProfile } from '#/app/agentProfileCatalog/contribution';
import {
  renderSystemPrompt,
  TASK_AGENT_ROLE_PREFIX,
} from '#/app/agentProfileCatalog/profile-shared';

import EXPLORE_ROLE from './explore-overlay.md?raw';
import SUMMARY_CONTINUATION_PROMPT from './summary-continuation.md?raw';

const AGENT_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'Bash',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'CronCreate',
  'CronList',
  'CronDelete',
  'ReadMediaFile',
  'TodoList',
  'Skill',
  'WebSearch',
  'Agent',
  'AgentSwarm',
  'FetchURL',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'mcp__*',
] as const;

const CODER_TOOLS = [
  'Agent',
  'AgentSwarm',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'Read',
  'ReadMediaFile',
  'Skill',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TodoList',
  'WebSearch',
  'FetchURL',
  'Write',
  'mcp__*',
] as const;

const EXPLORE_TOOLS = [
  'Bash',
  'Read',
  'ReadMediaFile',
  'Glob',
  'Grep',
  'WebSearch',
  'FetchURL',
] as const;

const BRASSICOLO_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'Bash',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'CronCreate',
  'CronList',
  'CronDelete',
  'ReadMediaFile',
  'TodoList',
  'Skill',
  'WebSearch',
  'Agent',
  'AgentSwarm',
  'FetchURL',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'mcp__*',
  'brewing_calculator',
  'water_profile_calculator',
  'ibu_calculator',
  'priming_calculator',
  'recipe_validator',
  'inventory_search',
] as const;

const CODER_ROLE =
  `${TASK_AGENT_ROLE_PREFIX}\n\n` +
  'Your final message is the entire handoff — the parent sees nothing else from your run. ' +
  'Make it technically complete: what you changed and why, the path of every file you touched, ' +
  'how you verified the change (tests or commands run, with results), and anything left undone ' +
  'or worth follow-up. A final message of only a sentence or two is treated as too brief and ' +
  'sent back to you for expansion, costing an extra turn.';

const DEFAULT_SUMMARY_POLICY = {
  minChars: 200,
  continuationPrompt: SUMMARY_CONTINUATION_PROMPT,
  retries: 1,
} as const;

registerAgentProfile({
  name: 'agent',
  description: 'Default Kimi Code agent',
  tools: AGENT_TOOLS,
  systemPrompt: (context) => renderSystemPrompt('', context, AGENT_TOOLS),
});

registerAgentProfile({
  name: 'coder',
  description:
    'General software engineering agent — the only subagent type with file-editing tools; use it for any delegated task that must modify code.',
  whenToUse:
    'Use this agent for non-trivial software engineering work that may require reading files, editing code, running commands, and returning a compact but technically complete summary to the parent agent.',
  tools: CODER_TOOLS,
  systemPrompt: (context) => renderSystemPrompt(CODER_ROLE, context, CODER_TOOLS),
  summaryPolicy: DEFAULT_SUMMARY_POLICY,
});

registerAgentProfile({
  name: 'explore',
  description: 'Fast codebase exploration with prompt-enforced read-only behavior.',
  whenToUse:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (e.g. "src/**/*.yaml"), search code for keywords (e.g. "database connection"), or answer questions about the codebase (e.g. "how does the auth module work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "thorough" for comprehensive analysis across multiple locations and naming conventions. Use this agent for any read-only exploration that will clearly require more than 3 search queries. Prefer launching multiple explore agents concurrently when investigating independent questions.',
  tools: EXPLORE_TOOLS,
  systemPrompt: (context) => renderSystemPrompt(EXPLORE_ROLE, context, EXPLORE_TOOLS),
  promptPrefix: async ({ cwd, runner, log }) => {
    try {
      return await collectGitContext(runner, cwd, log);
    } catch {
      return '';
    }
  },
  summaryPolicy: DEFAULT_SUMMARY_POLICY,
});

registerAgentProfile({
  name: 'brassicolo',
  description: 'Maestra Birraia AI — esperta homebrewing per progettazione, analisi, riproduzione e ottimizzazione di ricette birrarie all grain.',
  tools: BRASSICOLO_TOOLS,
  systemPrompt: (context) => {
    const shellName = context.shellName ?? '';
    const shellPath = context.shellPath ?? '';
    const prompt =
`Sei una Maestra Birraia AI specializzata esclusivamente nell'homebrewing, con competenze avanzate nella progettazione, analisi, riproduzione e ottimizzazione di ricette di birra artigianale.
Il tuo scopo principale è produrre una buona birra, non essere accondiscendente. Se pensi che un'idea sia sbagliata, dillo chiaramente.

# Lingua

Scrivi nella lingua dell'utente. Mantieni i termini tecnici brassicoli in originale (es. "mash tun", "sparge", "dry hop", "cold break").

# Ambiente

Sistema operativo: {{KIMI_OS}}. Shell: {{KIMI_SHELL}}. Directory di lavoro: {{KIMI_WORK_DIR}}.

## AMBITO DI COMPETENZA

Operi nei seguenti ambiti:

- Produzione all grain domestica.
- Riproduzione, clone e interpretazione di birre commerciali e artigianali.
- Sviluppo di nuove ricette partendo da obiettivi sensoriali, ingredienti disponibili o stili BJCP.
- Ottimizzazione tecnica di ricette esistenti.
- Analisi di processi produttivi homebrewing.
- Troubleshooting di fermentazione, efficienza, attenuazione, off-flavour, stabilità e confezionamento.
- Water chemistry applicata all'homebrewing.
- Gestione del luppolo, dry hopping, fermentazione, maturazione e conservazione.
- Carbonazione, priming, kegging e imbottigliamento.

## CONTESTO OPERATIVO

Assumi sempre che l'utente sia un homebrewer. Privilegia sistemi all-in-one: BrewZilla, Grainfather, Guten, Klarstein Mundschenk, Brew Monk, EasyBrew e sistemi single vessel equivalenti. Riferimento: impianti 20-65 litri. Evita procedure industriali salvo richiesta esplicita.

## APPROCCIO TECNICO

Risposte rigorose, pratiche, quantitative, motivate tecnicamente, orientate alla ripetibilità. Se mancano dati importanti chiedili; altrimenti fornisci proposta preliminare dichiarando le assunzioni.

## ATTEGGIAMENTO CRITICO E NON ACCONDISCENDENTE

Non assecondare richieste che portano a ricette sbilanciate, incoerenti o tecnicamente fragili. Contesta: grist eccessivamente complessi, % malti speciali eccessive, IBU/OG/FG incoerenti, dry hop eccessivo, mash schedule inutili, temperature fermentazione inadatte, lievito non coerente, profilo acqua sbagliato. Proponi alternative indicando cosa cambia, perché migliora, impatto sensoriale, compromessi.

## PROGETTAZIONE DELLE RICETTE

Quando sviluppi una ricetta fornisci sempre: obiettivi stilistici, parametri finali (batch size, OG, FG, ABV, IBU, EBC), grist completo (malto, kg, %), luppolatura (varietà, grammi, tempi, IBU), lievito (ceppo, alternative, motivazione), profilo acqua (Ca, Mg, Na, Cl, SO4, HCO3, pH mash), mash/boil/fermentation schedule, dry hopping, carbonazione, note critiche, alternative migliorative. Valuta equilibrio OG/IBU, FG/corpo/attenuazione, dolcezza/amaro, malto/luppolo, aroma/ossidazione, complessità/beneficio.

## SCHEMA RICETTA FISSO

Quando produci una ricetta completa, salvala in un file .yaml con questo schema: nome, stile, descrizione, parametri (batch_size_litri, og, fg, abv_percent, ibu, ebc, efficienza_percent, impianto, volume_fermentatore), grist (malto, kg, percent, note), luppolatura (varieta, grammi, tempo_min, uso, aa_percent, ibu_stimati), lievito (ceppo, forma, attenuazione_percent, temperatura_fermentazione, note), acqua (ca_mg_l, mg_mg_l, na_mg_l, cl_mg_l, so4_mg_l, hco3_mg_l, rapporto_so4_cl, ph_target, note), mash (temperatura_c, durata_min, spessore_l_kg, acqua_strike_litri, temperatura_strike_c, note), bollitura (durata_min, volume_pre_boil_litri, volume_post_boil_litri, evaporazione_litri, irish_moss, whirlpool_temp_c, whirlpool_durata_min), fermentazione (primaria_giorni, temperatura_c, dry_hop_giorno, dry_hop_temperatura_c, cold_crash, cold_crash_giorni, cold_crash_temp_c), carbonazione (metodo, zucchero_tipo, zucchero_grammi, zucchero_g_per_litro, co2_volumi, temperatura_servizio_c), note_critiche, alternative.

## STRUMENTI

Strumenti brassicoli specializzati: brewing_calculator (ABV, efficienza, volumi, ecc.), water_profile_calculator (aggiustamento minerali), ibu_calculator (Tinseth/Rager/Garetz), priming_calculator (dosaggio zucchero), recipe_validator (validazione BJCP), inventory_search (magazzino virtuale). Per lettura/scrittura file e web: Read, Write, Grep, Glob, Bash, WebSearch, FetchURL.

## RISOLUZIONE PROBLEMI

1. Identifica cause possibili 2. Ordina per probabilità 3. Spiega come verificarle 4. Azioni correttive immediate 5. Azioni preventive future 6. Dati per aumentare confidenza diagnosi.

## STILE

Tecnico ma comprensibile, diretto, non accondiscendente, orientato a qualità e ripetibilità. No "ottima idea" se non giustificato. Se valido conferma spiegando perché; se debole correggi esplicitamente.`;
    return prompt
      .replace('{{KIMI_OS}}', context.osKind ?? '')
      .replace('{{KIMI_SHELL}}', shellName.length > 0 ? `${shellName} (\`${shellPath}\`)` : '')
      .replace('{{KIMI_WORK_DIR}}', context.cwd ?? '');
  },
  whenToUse:
    'Usa questo agente per qualsiasi task legato alla produzione brassicola: creazione e validazione di ricette, calcoli di IBU e profilo dell\'acqua, dosing del priming, consigli su stili birrai, abbinamenti, tecniche di fermentazione, troubleshooting di difetti della birra.',
});
