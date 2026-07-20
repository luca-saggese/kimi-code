/**
 * Recipe validator — validate a beer recipe against BJCP style guidelines.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const RecipeValidatorInputSchema = z.object({
  recipe_name: z.string(),
  beer_style: z.string().describe('BJCP style code or name.'),
  batch_size_liters: z.number(),
  og: z.number(),
  fg: z.number(),
  ibu: z.number(),
  ebc: z.number().optional(),
  grain_bill: z.array(z.object({ malt: z.string(), kg: z.number(), percent: z.number().optional() })),
  hop_schedule: z.array(z.object({ variety: z.string(), grams: z.number(), time_minutes: z.number(), use: z.enum(['boil', 'whirlpool', 'dry_hop', 'first_wort', 'mash']) })),
  yeast: z.object({ strain: z.string(), attenuation_percent: z.number().optional() }),
  mash_temp_c: z.number().optional(),
  fermentation_temp_c: z.number().optional(),
  water_profile: z.object({ ca: z.number(), mg: z.number(), na: z.number(), cl: z.number(), so4: z.number(), hco3: z.number() }).optional(),
});

export type RecipeValidatorInput = z.infer<typeof RecipeValidatorInputSchema>;

interface BjcpStyle { code: string; name: string; og_min: number; og_max: number; fg_min: number; fg_max: number; abv_min: number; abv_max: number; ibu_min: number; ibu_max: number; ebc_min: number; ebc_max: number }

const BJCP: Record<string, BjcpStyle> = {
  '21A': { code: '21A', name: 'American IPA', og_min: 1.056, og_max: 1.070, fg_min: 1.008, fg_max: 1.014, abv_min: 5.5, abv_max: 7.5, ibu_min: 40, ibu_max: 70, ebc_min: 12, ebc_max: 28 },
  '21B1': { code: '21B1', name: 'New England IPA', og_min: 1.060, og_max: 1.085, fg_min: 1.010, fg_max: 1.020, abv_min: 6.0, abv_max: 9.0, ibu_min: 25, ibu_max: 60, ebc_min: 6, ebc_max: 16 },
  '22A': { code: '22A', name: 'Double IPA', og_min: 1.065, og_max: 1.085, fg_min: 1.010, fg_max: 1.020, abv_min: 7.5, abv_max: 10.0, ibu_min: 60, ibu_max: 120, ebc_min: 12, ebc_max: 30 },
  '13C': { code: '13C', name: 'English Porter', og_min: 1.040, og_max: 1.052, fg_min: 1.008, fg_max: 1.014, abv_min: 4.0, abv_max: 5.4, ibu_min: 18, ibu_max: 35, ebc_min: 40, ebc_max: 60 },
  '20C': { code: '20C', name: 'Imperial Stout', og_min: 1.075, og_max: 1.115, fg_min: 1.018, fg_max: 1.030, abv_min: 8.0, abv_max: 12.0, ibu_min: 50, ibu_max: 90, ebc_min: 60, ebc_max: 100 },
  '5B': { code: '5B', name: 'Kölsch', og_min: 1.044, og_max: 1.050, fg_min: 1.007, fg_max: 1.011, abv_min: 4.4, abv_max: 5.2, ibu_min: 18, ibu_max: 30, ebc_min: 7, ebc_max: 10 },
  '5D': { code: '5D', name: 'German Pils', og_min: 1.044, og_max: 1.050, fg_min: 1.008, fg_max: 1.013, abv_min: 4.4, abv_max: 5.2, ibu_min: 22, ibu_max: 40, ebc_min: 4, ebc_max: 8 },
  '10A': { code: '10A', name: 'Weissbier', og_min: 1.044, og_max: 1.052, fg_min: 1.010, fg_max: 1.014, abv_min: 4.3, abv_max: 5.6, ibu_min: 8, ibu_max: 15, ebc_min: 4, ebc_max: 14 },
  '25B': { code: '25B', name: 'Saison', og_min: 1.048, og_max: 1.065, fg_min: 1.002, fg_max: 1.008, abv_min: 5.0, abv_max: 7.0, ibu_min: 20, ibu_max: 35, ebc_min: 10, ebc_max: 20 },
  '26C': { code: '26C', name: 'Belgian Tripel', og_min: 1.075, og_max: 1.085, fg_min: 1.008, fg_max: 1.014, abv_min: 7.5, abv_max: 9.5, ibu_min: 20, ibu_max: 40, ebc_min: 8, ebc_max: 14 },
  '6A': { code: '6A', name: 'Märzen', og_min: 1.054, og_max: 1.060, fg_min: 1.010, fg_max: 1.014, abv_min: 5.8, abv_max: 6.3, ibu_min: 18, ibu_max: 24, ebc_min: 16, ebc_max: 30 },
  '9A': { code: '9A', name: 'Doppelbock', og_min: 1.072, og_max: 1.112, fg_min: 1.016, fg_max: 1.024, abv_min: 7.0, abv_max: 10.0, ibu_min: 16, ibu_max: 26, ebc_min: 24, ebc_max: 45 },
  '15B': { code: '15B', name: 'Irish Stout', og_min: 1.036, og_max: 1.044, fg_min: 1.007, fg_max: 1.011, abv_min: 4.0, abv_max: 4.5, ibu_min: 25, ibu_max: 45, ebc_min: 50, ebc_max: 80 },
  '18B': { code: '18B', name: 'American Pale Ale', og_min: 1.045, og_max: 1.060, fg_min: 1.010, fg_max: 1.015, abv_min: 4.5, abv_max: 6.2, ibu_min: 30, ibu_max: 50, ebc_min: 10, ebc_max: 20 },
  '23G': { code: '23G', name: 'Gose', og_min: 1.036, og_max: 1.056, fg_min: 1.006, fg_max: 1.010, abv_min: 4.2, abv_max: 4.8, ibu_min: 5, ibu_max: 12, ebc_min: 6, ebc_max: 12 },
  '24A': { code: '24A', name: 'Witbier', og_min: 1.044, og_max: 1.052, fg_min: 1.008, fg_max: 1.012, abv_min: 4.5, abv_max: 5.5, ibu_min: 10, ibu_max: 20, ebc_min: 4, ebc_max: 8 },
  '26D': { code: '26D', name: 'Belgian Dark Strong', og_min: 1.075, og_max: 1.110, fg_min: 1.010, fg_max: 1.024, abv_min: 8.0, abv_max: 12.0, ibu_min: 20, ibu_max: 35, ebc_min: 24, ebc_max: 45 },
  '11C': { code: '11C', name: 'Strong Bitter', og_min: 1.048, og_max: 1.060, fg_min: 1.010, fg_max: 1.016, abv_min: 4.6, abv_max: 6.2, ibu_min: 30, ibu_max: 50, ebc_min: 18, ebc_max: 40 },
  '4A': { code: '4A', name: 'Munich Helles', og_min: 1.044, og_max: 1.048, fg_min: 1.006, fg_max: 1.012, abv_min: 4.7, abv_max: 5.4, ibu_min: 16, ibu_max: 22, ebc_min: 6, ebc_max: 10 },
  '12C': { code: '12C', name: 'English IPA', og_min: 1.050, og_max: 1.075, fg_min: 1.010, fg_max: 1.018, abv_min: 5.0, abv_max: 7.5, ibu_min: 40, ibu_max: 60, ebc_min: 12, ebc_max: 30 },
  '17C': { code: '17C', name: 'Wee Heavy', og_min: 1.070, og_max: 1.130, fg_min: 1.018, fg_max: 1.040, abv_min: 6.5, abv_max: 10.0, ibu_min: 17, ibu_max: 35, ebc_min: 28, ebc_max: 60 },
};

export class RecipeValidatorTool implements BuiltinTool<RecipeValidatorInput> {
  readonly name = 'recipe_validator' as const;
  readonly description =
    'Validate a beer recipe against BJCP style guidelines. Checks OG, FG, ABV, IBU, color, ingredient balance, and more.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RecipeValidatorInputSchema);

  resolveExecution(args: RecipeValidatorInput): ToolExecution {
    return {
      description: `Validate recipe: ${args.recipe_name}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: RecipeValidatorInput): Promise<ExecutableToolResult> {
    try {
      const style = this.findStyle(args.beer_style);
      const issues: string[] = [];
      const warnings: string[] = [];
      const abv = (args.og - args.fg) * 131.25;

      if (style) {
        if (args.og < style.og_min || args.og > style.og_max) issues.push(`OG ${args.og.toFixed(3)} fuori range (${style.og_min.toFixed(3)}–${style.og_max.toFixed(3)})`);
        if (args.fg < style.fg_min || args.fg > style.fg_max) warnings.push(`FG ${args.fg.toFixed(3)} fuori range (${style.fg_min.toFixed(3)}–${style.fg_max.toFixed(3)})`);
        if (args.ibu < style.ibu_min || args.ibu > style.ibu_max) issues.push(`IBU ${args.ibu} fuori range (${style.ibu_min}–${style.ibu_max})`);
        if (abv < style.abv_min || abv > style.abv_max) issues.push(`ABV ${abv.toFixed(1)}% fuori range (${style.abv_min}–${style.abv_max}%)`);
        if (args.ebc !== undefined && (args.ebc < style.ebc_min || args.ebc > style.ebc_max)) warnings.push(`EBC ${args.ebc} fuori range (${style.ebc_min}–${style.ebc_max})`);
      }

      const ibuRatio = args.ibu / ((args.og - 1) * 1000);
      if (ibuRatio < 0.2) issues.push('Rapporto IBU/OG molto basso — sbilanciata verso il malto.');
      else if (ibuRatio > 1.5) issues.push('Rapporto IBU/OG molto alto — amaro eccessivo.');
      else if (ibuRatio > 1.0) warnings.push('Rapporto IBU/OG alto — verifica lo stile.');

      const totalKg = args.grain_bill.reduce((s: number, g) => s + g.kg, 0);
      let specPct = 0, basePct = 0;
      for (const g of args.grain_bill) {
        const pct = g.percent ?? (g.kg / totalKg) * 100;
        const n = g.malt.toLowerCase();
        if (n.includes('pilsner') || n.includes('pale') || n.includes('maris otter') || n.includes('munich') || n.includes('vienna') || n.includes('wheat') || n.includes('base')) basePct += pct;
        if (n.includes('crystal') || n.includes('caramel') || n.includes('chocolate') || n.includes('black') || n.includes('roast') || n.includes('special') || n.includes('cara')) specPct += pct;
        if (pct > 20 && !n.includes('base') && !n.includes('pilsner') && !n.includes('pale')) warnings.push(`Malto "${g.malt}" al ${pct.toFixed(0)}% — percentuale alta.`);
      }
      if (specPct > 25) issues.push(`Malti speciali al ${specPct.toFixed(0)}% — rischio dolcezza/astringenza.`);
      else if (specPct > 15) warnings.push(`Malti speciali al ${specPct.toFixed(0)}%.`);
      if (basePct < 60 && totalKg > 0) warnings.push(`Malto base al ${basePct.toFixed(0)}% — basso.`);

      const dryHopG = args.hop_schedule.filter(h => h.use === 'dry_hop').reduce((s: number, h) => s + h.grams, 0);
      if (dryHopG > 20 * args.batch_size_liters) warnings.push(`Dry hop molto alto (${dryHopG}g in ${args.batch_size_liters}L) — rischio astringenza/ossidazione.`);

      if (args.mash_temp_c !== undefined) {
        if (args.mash_temp_c < 60) issues.push('Temperatura mash <60°C.');
        else if (args.mash_temp_c > 72) warnings.push('Temperatura mash >72°C.');
      }

      const valid = issues.length === 0;
      return Promise.resolve({
        output: [
          `**Validazione ricetta: ${args.recipe_name}**`,
          style ? `Stile: ${style.code} — ${style.name}` : 'Stile non trovato nel database BJCP.',
          '',
          valid ? '✅ Valida — nessun errore critico.' : '❌ Errori critici:',
          ...issues.map(i => `  ❌ ${i}`),
          ...(warnings.length ? ['', '⚠️ Avvisi:', ...warnings.map(w => `  ⚠️ ${w}`)] : []),
          '', `IBU/OG ratio: ${ibuRatio.toFixed(2)} | ABV: ${abv.toFixed(1)}% | Malti speciali: ${specPct.toFixed(1)}%`,
        ].join('\n'),
      });
    } catch (e) {
      return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) });
    }
  }

  private findStyle(q: string): BjcpStyle | undefined {
    if (BJCP[q]) return BJCP[q];
    const lq = q.toLowerCase();
    for (const s of Object.values(BJCP)) if (s.name.toLowerCase().includes(lq)) return s;
    return undefined;
  }
}

registerTool(RecipeValidatorTool);
