#!/usr/bin/env node
/**
 * Standalone test CLI for the brewmaster recipe validator.
 *
 * Lets you test the YAML validator without Kimi Code or the MCP server:
 *
 *   node dist/test-recipe.mjs <recipe.yaml>
 *
 * Runs the deterministic validator (validateRecipe) and then a stricter
 * "brewday completeness" audit that checks the RAW YAML keys directly, so
 * it catches missing data even when the recipe uses non-standard field
 * names that the parser does not map.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

import { parseYamlRecipe, validateRecipe } from './brewing/yaml-validator';

// ── Brewday completeness audit against the RAW YAML ─────────────────────────
// These are the data points needed to follow a brew from mash-in to bottling.
// Each entry lists the YAML sections/keys that would satisfy it.

interface BrewdayRequirement {
  label: string;
  present: (d: Record<string, unknown>) => boolean;
  hint: string;
}

const BREWDAY_REQUIREMENTS: BrewdayRequirement[] = [
  {
    label: 'Agua total de cotización',
    present: d => hasNum(d, ['agua', 'acqua'], ['total_litri', 'total_agua_litri', 'agua_total_litri']),
    hint: 'agua.total_litri (o acqua.total_litri)',
  },
  {
    label: 'Agua de ammostamento (mash)',
    present: d => hasNum(d, ['agua', 'acqua'], ['mash_litri', 'mash_agua_litri']) || hasNum(d, ['mash'], ['acqua_strike_litri', 'strike_litri']),
    hint: 'agua.mash_litri o mash.acqua_strike_litri',
  },
  {
    label: 'Agua de lavado (sparge)',
    present: d => hasNum(d, ['agua', 'acqua'], ['sparge_litri', 'sparge_agua_litri']) || hasNum(d, ['sparge'], ['litri', 'volumen_litri']),
    hint: 'agua.sparge_litri (o sección sparge)',
  },
  {
    label: 'Sales de mash (gesso/CaCl₂/Epsom/NaHCO₃)',
    present: d => hasAny(d, ['sales', 'mash_salts', 'agua', 'acqua'], ['gesso_g', 'cacl2_g', 'epsom_g', 'nahco3_g', 'sales_g']) || hasAny(d, ['agua', 'acqua'], ['gesso', 'cacl2', 'epsom', 'nahco3']),
    hint: 'sales.gesso_g / sales.cacl2_g / sales.epsom_g / sales.nahco3_g',
  },
  {
    label: 'Ácido láctico',
    present: d => hasAny(d, ['sales', 'mash_salts', 'agua', 'acqua'], ['acido_lactico_ml', 'lactic_acid_ml', 'acido_lactico']) || hasAny(d, ['mash'], ['acido_lactico_ml', 'lactic_acid_ml']),
    hint: 'sales.acido_lactico_ml (o mash.acido_lactico_ml)',
  },
  {
    label: 'Temperatura de mash-in',
    present: d => hasNum(d, ['mash'], ['temperatura_in_c', 'mash_in_c', 'temperatura_strike_c', 'strike_temp_c']),
    hint: 'mash.temperatura_strike_c (o mash.temperatura_in_c)',
  },
  {
    label: 'Gravedad pre-boil',
    present: d => hasNum(d, ['bollitura'], ['og_pre_boil', 'gravedad_pre_boil', 'pre_boil_og']) || hasNum(d, ['parametri'], ['og_pre_boil', 'pre_boil_og']),
    hint: 'bollitura.og_pre_boil',
  },
  {
    label: 'Gravedad post-boil',
    present: d => hasNum(d, ['bolliura', 'bollitura'], ['og_post_boil', 'gravedad_post_boil', 'post_boil_og']) || hasNum(d, ['parametri'], ['og_post_boil', 'post_boil_og']),
    hint: 'bollitura.og_post_boil',
  },
  {
    label: 'Duración de la ebullición',
    present: d => hasNum(d, ['bollitura', 'bolliura'], ['durata_min', 'duracion_min']) || hasNum(d, ['parametri'], ['bollitura_min', 'duracion_bollitura_min']),
    hint: 'bollitura.durata_min (o parametri.bollitura_min)',
  },
  {
    label: 'Temperatura de fermentación',
    present: d => hasNum(d, ['fermentazione', 'fermentacion'], ['temperatura_c', 'temp_c']) || hasNum(d, ['lievito'], ['temperatura_fermentacion', 'temp_fermentacion_c']),
    hint: 'fermentazione.temperatura_c',
  },
  {
    label: 'Días de fermentación primaria',
    present: d => hasNum(d, ['fermentazione', 'fermentacion'], ['primaria_giorni', 'primaria_dias', 'dias_primaria']),
    hint: 'fermentazione.primaria_giorni',
  },
  {
    label: 'Carbonatación (vol CO₂)',
    present: d => hasNum(d, ['carbonazione', 'carbonatacion'], ['co2_volumi', 'co2_vol', 'volumen_co2']) || hasNum(d, ['parametri'], ['carbonazione_vol']),
    hint: 'carbonazione.co2_volumi',
  },
  {
    label: 'Volumen de envasado',
    present: d => hasNum(d, ['parametri'], ['confezionamiento_litri', 'confezionamento_litri', 'envasado_litri', 'embotellado_litri']) || hasNum(d, ['carbonazione', 'carbonatacion'], ['volumen_litri', 'botellas_litri']),
    hint: 'parametri.confezionamiento_litri (o carbonazione.volumen_litri)',
  },
  {
    label: 'Tipo de botella',
    present: d => hasStr(d, ['carbonazione', 'carbonatacion'], ['tipo_botella', 'tipo_botella', 'botella']) || hasStr(d, ['parametri'], ['tipo_botella']),
    hint: 'carbonazione.tipo_botella',
  },
];

function hasNum(d: Record<string, unknown>, sections: string[], keys: string[]): boolean {
  for (const s of sections) {
    const sec = d[s];
    if (sec && typeof sec === 'object') {
      for (const k of keys) {
        const v = (sec as Record<string, unknown>)[k];
        if (v != null && !Number.isNaN(Number(v))) return true;
      }
    }
  }
  return false;
}

function hasAny(d: Record<string, unknown>, sections: string[], keys: string[]): boolean {
  for (const s of sections) {
    const sec = d[s];
    if (sec && typeof sec === 'object') {
      for (const k of keys) {
        const v = (sec as Record<string, unknown>)[k];
        if (v != null) return true;
      }
    }
  }
  return false;
}

function hasStr(d: Record<string, unknown>, sections: string[], keys: string[]): boolean {
  for (const s of sections) {
    const sec = d[s];
    if (sec && typeof sec === 'object') {
      for (const k of keys) {
        const v = (sec as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.trim() !== '') return true;
      }
    }
  }
  return false;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = args[0];
  if (!input || !existsSync(input)) {
    console.error('Usage: node dist/test-recipe.mjs <recipe.yaml>');
    process.exit(1);
  }

  console.log(`\n=== Validación determinística (yaml_validator) ===\n`);
  try {
    const recipe = parseYamlRecipe(input);
    const v = validateRecipe(recipe);
    console.log(`Receta: ${recipe.recipe_name}`);
    console.log(`Estilo: ${recipe.beer_style}`);
    console.log(`ABV: ${v.abv.toFixed(1)}% | IBU/OG: ${v.ibuRatio.toFixed(2)}`);
    console.log('');
    console.log(v.issues.length ? '❌ Errores críticos:' : '✅ Sin errores críticos');
    v.issues.forEach(i => console.log(`  ❌ ${i}`));
    if (v.warnings.length) {
      console.log('\n⚠️ Avisos:');
      v.warnings.forEach(w => console.log(`  ⚠️ ${w}`));
    }
    if (v.volumeIssues.length) {
      console.log('\n📐 Problemas de volumen:');
      v.volumeIssues.forEach(i => console.log(`  📐 ${i}`));
    }
    if (v.carbonationIssues.length) {
      console.log('\n🫧 Problemas de carbonatación:');
      v.carbonationIssues.forEach(i => console.log(`  🫧 ${i}`));
    }
  } catch (e) {
    console.error(`❌ Error al validar: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(`\n\n🔍 Auditoría de completitud de cotización (brewday) ===\n`);
  const raw = readFileSync(input, 'utf-8');
  const data = yaml.load(raw) as Record<string, unknown>;
  const missing: string[] = [];
  for (const req of BREWDAY_REQUIREMENTS) {
    const ok = req.present(data);
    console.log(`${ok ? '✅' : '❌'} ${req.label}${ok ? '' : `  ← falta: ${req.hint}`}`);
    if (!ok) missing.push(req.label);
  }
  console.log(`\n${missing.length === 0 ? '✅ Todos los datos de cotización presentes.' : `❌ Faltan ${missing.length} datos de cotización.`}`);
}

main();