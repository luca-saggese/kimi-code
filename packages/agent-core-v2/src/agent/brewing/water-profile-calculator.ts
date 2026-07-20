/**
 * Water profile calculator — adjust mineral additions for any beer style.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const WaterProfileCalculatorInputSchema = z.object({
  source_water: z.object({
    ca: z.number(), mg: z.number(), na: z.number(), cl: z.number(), so4: z.number(), hco3: z.number(),
  }),
  target_profile: z.enum([
    'pilsner', 'helles', 'dortmunder', 'vienna', 'marzen', 'bock', 'doppelbock',
    'dunkel', 'schwarzbier', 'kolsch', 'altbier', 'weissbier', 'dunkelweizen',
    'berliner_weisse', 'gose', 'lambic', 'saison', 'belgian_pale', 'belgian_dubbel',
    'belgian_tripel', 'belgian_golden_strong', 'belgian_dark_strong', 'witbier',
    'biere_de_garde', 'british_pale', 'british_ipa', 'british_stout', 'porter', 'mild',
    'bitter', 'esb', 'barleywine', 'old_ale', 'scotch_ale', 'american_pale',
    'american_ipa', 'double_ipa', 'american_stout', 'imperial_stout', 'neipa',
    'cream_ale', 'blonde_ale', 'california_common', 'american_lager', 'light_lager',
    'premium_lager', 'amber_lager', 'dark_lager', 'baltic_porter', 'rauchbier',
    'roggenbier', 'dampfbier', 'fruit_beer', 'spice_beer', 'wood_aged', 'sour_ale',
    'brett_beer', 'mixed_fermentation', 'kveik_ale', 'brut_ipa', 'session_ipa',
    'wheat_ipa', 'black_ipa', 'red_ipa', 'white_ipa', 'belgian_ipa', 'new_england_ipa',
    'milk_stout', 'oatmeal_stout', 'dry_stout', 'foreign_extra_stout', 'american_porter',
    'brown_ale', 'amber_ale', 'red_ale', 'irish_red', 'scottish_light', 'scottish_heavy',
    'scottish_export', 'wee_heavy', 'english_ipa', 'strong_bitter', 'brown_porter',
    'robust_porter', 'imperial_stout_ris', 'flanders_red', 'flanders_brown',
    'oud_bruin', 'lambic_gueuze', 'lambic_kriek', 'lambic_framboise',
  ]),
  batch_size_liters: z.number(),
  mash_water_liters: z.number().optional(),
  sparge_water_liters: z.number().optional(),
  target_ph: z.number().optional(),
});

export type WaterProfileCalculatorInput = z.infer<typeof WaterProfileCalculatorInputSchema>;

interface WaterTarget { ca: number; mg: number; na: number; cl: number; so4: number; hco3: number; desc: string }

const WATER: Record<string, WaterTarget> = {
  pilsner: { ca: 10, mg: 2, na: 2, cl: 5, so4: 5, hco3: 15, desc: 'Pilsen — very soft' },
  helles: { ca: 50, mg: 10, na: 5, cl: 60, so4: 15, hco3: 50, desc: 'Munich Helles' },
  dortmunder: { ca: 250, mg: 25, na: 70, cl: 100, so4: 300, hco3: 550, desc: 'Dortmund' },
  vienna: { ca: 200, mg: 60, na: 8, cl: 12, so4: 125, hco3: 120, desc: 'Vienna' },
  marzen: { ca: 150, mg: 40, na: 10, cl: 60, so4: 80, hco3: 200, desc: 'Märzen' },
  bock: { ca: 100, mg: 30, na: 15, cl: 80, so4: 40, hco3: 250, desc: 'Bock' },
  doppelbock: { ca: 80, mg: 25, na: 10, cl: 70, so4: 30, hco3: 200, desc: 'Doppelbock' },
  dunkel: { ca: 120, mg: 35, na: 12, cl: 90, so4: 50, hco3: 300, desc: 'Dunkel' },
  schwarzbier: { ca: 100, mg: 30, na: 10, cl: 70, so4: 40, hco3: 250, desc: 'Schwarzbier' },
  kolsch: { ca: 80, mg: 15, na: 20, cl: 60, so4: 40, hco3: 150, desc: 'Kölsch' },
  altbier: { ca: 150, mg: 30, na: 25, cl: 80, so4: 100, hco3: 200, desc: 'Altbier' },
  weissbier: { ca: 50, mg: 15, na: 10, cl: 40, so4: 20, hco3: 100, desc: 'Weissbier' },
  dunkelweizen: { ca: 60, mg: 20, na: 12, cl: 50, so4: 25, hco3: 150, desc: 'Dunkelweizen' },
  berliner_weisse: { ca: 50, mg: 10, na: 10, cl: 40, so4: 20, hco3: 100, desc: 'Berliner Weisse' },
  gose: { ca: 80, mg: 20, na: 50, cl: 100, so4: 40, hco3: 150, desc: 'Gose' },
  lambic: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200, desc: 'Lambic' },
  saison: { ca: 100, mg: 20, na: 15, cl: 50, so4: 80, hco3: 100, desc: 'Saison' },
  belgian_pale: { ca: 80, mg: 20, na: 15, cl: 60, so4: 50, hco3: 150, desc: 'Belgian Pale' },
  belgian_dubbel: { ca: 60, mg: 20, na: 15, cl: 70, so4: 30, hco3: 200, desc: 'Belgian Dubbel' },
  belgian_tripel: { ca: 80, mg: 25, na: 15, cl: 60, so4: 40, hco3: 150, desc: 'Belgian Tripel' },
  belgian_golden_strong: { ca: 70, mg: 20, na: 12, cl: 55, so4: 35, hco3: 120, desc: 'Belgian Golden Strong' },
  belgian_dark_strong: { ca: 60, mg: 20, na: 15, cl: 65, so4: 30, hco3: 200, desc: 'Belgian Dark Strong' },
  witbier: { ca: 50, mg: 15, na: 10, cl: 40, so4: 20, hco3: 100, desc: 'Witbier' },
  biere_de_garde: { ca: 100, mg: 25, na: 15, cl: 60, so4: 50, hco3: 150, desc: 'Bière de Garde' },
  british_pale: { ca: 100, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100, desc: 'British Pale Ale' },
  british_ipa: { ca: 150, mg: 25, na: 20, cl: 60, so4: 200, hco3: 100, desc: 'British IPA' },
  british_stout: { ca: 100, mg: 25, na: 30, cl: 80, so4: 40, hco3: 250, desc: 'British Stout' },
  porter: { ca: 100, mg: 25, na: 25, cl: 80, so4: 50, hco3: 200, desc: 'Porter' },
  mild: { ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 200, desc: 'Mild' },
  bitter: { ca: 100, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100, desc: 'Bitter' },
  esb: { ca: 120, mg: 25, na: 20, cl: 70, so4: 100, hco3: 150, desc: 'ESB' },
  barleywine: { ca: 80, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200, desc: 'Barleywine' },
  old_ale: { ca: 80, mg: 25, na: 25, cl: 75, so4: 45, hco3: 250, desc: 'Old Ale' },
  scotch_ale: { ca: 60, mg: 20, na: 15, cl: 60, so4: 30, hco3: 200, desc: 'Scotch Ale' },
  american_pale: { ca: 100, mg: 20, na: 15, cl: 60, so4: 100, hco3: 100, desc: 'American Pale Ale' },
  american_ipa: { ca: 120, mg: 25, na: 20, cl: 60, so4: 200, hco3: 100, desc: 'American IPA' },
  double_ipa: { ca: 150, mg: 30, na: 20, cl: 70, so4: 250, hco3: 100, desc: 'Double IPA' },
  american_stout: { ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250, desc: 'American Stout' },
  imperial_stout: { ca: 100, mg: 30, na: 35, cl: 90, so4: 60, hco3: 300, desc: 'Imperial Stout' },
  neipa: { ca: 100, mg: 20, na: 30, cl: 150, so4: 50, hco3: 150, desc: 'NEIPA — high chloride' },
  cream_ale: { ca: 50, mg: 10, na: 10, cl: 40, so4: 20, hco3: 100, desc: 'Cream Ale' },
  blonde_ale: { ca: 60, mg: 15, na: 12, cl: 50, so4: 30, hco3: 100, desc: 'Blonde Ale' },
  california_common: { ca: 100, mg: 20, na: 20, cl: 60, so4: 80, hco3: 150, desc: 'California Common' },
  american_lager: { ca: 30, mg: 8, na: 10, cl: 30, so4: 15, hco3: 50, desc: 'American Lager' },
  light_lager: { ca: 20, mg: 5, na: 8, cl: 20, so4: 10, hco3: 30, desc: 'Light Lager' },
  premium_lager: { ca: 40, mg: 10, na: 10, cl: 35, so4: 20, hco3: 60, desc: 'Premium Lager' },
  amber_lager: { ca: 80, mg: 20, na: 15, cl: 60, so4: 40, hco3: 150, desc: 'Amber Lager' },
  dark_lager: { ca: 100, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200, desc: 'Dark Lager' },
  baltic_porter: { ca: 100, mg: 30, na: 25, cl: 80, so4: 60, hco3: 250, desc: 'Baltic Porter' },
  rauchbier: { ca: 100, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200, desc: 'Rauchbier' },
  roggenbier: { ca: 80, mg: 20, na: 15, cl: 60, so4: 30, hco3: 150, desc: 'Roggenbier' },
  dampfbier: { ca: 60, mg: 15, na: 12, cl: 50, so4: 25, hco3: 100, desc: 'Dampfbier' },
  sour_ale: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100, desc: 'Sour Ale' },
  brett_beer: { ca: 70, mg: 18, na: 15, cl: 55, so4: 40, hco3: 120, desc: 'Brett Beer' },
  mixed_fermentation: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100, desc: 'Mixed Fermentation' },
  kveik_ale: { ca: 80, mg: 20, na: 15, cl: 60, so4: 40, hco3: 100, desc: 'Kveik Ale' },
  brut_ipa: { ca: 100, mg: 25, na: 15, cl: 50, so4: 150, hco3: 50, desc: 'Brut IPA' },
  session_ipa: { ca: 80, mg: 20, na: 15, cl: 60, so4: 100, hco3: 100, desc: 'Session IPA' },
  wheat_ipa: { ca: 80, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100, desc: 'Wheat IPA' },
  black_ipa: { ca: 100, mg: 25, na: 25, cl: 70, so4: 100, hco3: 150, desc: 'Black IPA' },
  red_ipa: { ca: 100, mg: 25, na: 20, cl: 70, so4: 100, hco3: 150, desc: 'Red IPA' },
  white_ipa: { ca: 70, mg: 18, na: 15, cl: 60, so4: 60, hco3: 100, desc: 'White IPA' },
  belgian_ipa: { ca: 90, mg: 22, na: 18, cl: 60, so4: 80, hco3: 100, desc: 'Belgian IPA' },
  new_england_ipa: { ca: 100, mg: 20, na: 30, cl: 150, so4: 50, hco3: 150, desc: 'NEIPA' },
  milk_stout: { ca: 80, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200, desc: 'Milk Stout' },
  oatmeal_stout: { ca: 80, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200, desc: 'Oatmeal Stout' },
  dry_stout: { ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250, desc: 'Dry Stout' },
  foreign_extra_stout: { ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250, desc: 'Foreign Extra Stout' },
  american_porter: { ca: 100, mg: 25, na: 25, cl: 80, so4: 50, hco3: 200, desc: 'American Porter' },
  brown_ale: { ca: 80, mg: 20, na: 20, cl: 70, so4: 50, hco3: 150, desc: 'Brown Ale' },
  amber_ale: { ca: 80, mg: 20, na: 20, cl: 70, so4: 60, hco3: 150, desc: 'Amber Ale' },
  red_ale: { ca: 80, mg: 20, na: 20, cl: 70, so4: 60, hco3: 150, desc: 'Red Ale' },
  irish_red: { ca: 80, mg: 20, na: 20, cl: 70, so4: 50, hco3: 150, desc: 'Irish Red' },
  scottish_light: { ca: 60, mg: 15, na: 15, cl: 60, so4: 30, hco3: 150, desc: 'Scottish Light' },
  scottish_heavy: { ca: 70, mg: 18, na: 15, cl: 65, so4: 35, hco3: 180, desc: 'Scottish Heavy' },
  scottish_export: { ca: 80, mg: 20, na: 15, cl: 70, so4: 40, hco3: 200, desc: 'Scottish Export' },
  wee_heavy: { ca: 80, mg: 25, na: 20, cl: 70, so4: 40, hco3: 250, desc: 'Wee Heavy' },
  english_ipa: { ca: 120, mg: 25, na: 20, cl: 60, so4: 150, hco3: 100, desc: 'English IPA' },
  strong_bitter: { ca: 120, mg: 22, na: 18, cl: 65, so4: 100, hco3: 120, desc: 'Strong Bitter' },
  brown_porter: { ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 180, desc: 'Brown Porter' },
  robust_porter: { ca: 100, mg: 22, na: 22, cl: 75, so4: 50, hco3: 200, desc: 'Robust Porter' },
  imperial_stout_ris: { ca: 100, mg: 30, na: 35, cl: 90, so4: 60, hco3: 300, desc: 'Imperial Stout RIS' },
  flanders_red: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100, desc: 'Flanders Red' },
  flanders_brown: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100, desc: 'Flanders Brown' },
  oud_bruin: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100, desc: 'Oud Bruin' },
  lambic_gueuze: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200, desc: 'Gueuze' },
  lambic_kriek: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200, desc: 'Kriek' },
  lambic_framboise: { ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200, desc: 'Framboise' },
};

export class WaterProfileCalculatorTool implements BuiltinTool<WaterProfileCalculatorInput> {
  readonly name = 'water_profile_calculator' as const;
  readonly description =
    'Calculate water mineral additions (gypsum, CaCl2, Epsom, baking soda, chalk, lactic acid) to hit a target water profile for any beer style.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WaterProfileCalculatorInputSchema);

  resolveExecution(args: WaterProfileCalculatorInput): ToolExecution {
    return {
      description: `Water profile: ${args.target_profile}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: WaterProfileCalculatorInput): Promise<ExecutableToolResult> {
    try {
      const t = WATER[args.target_profile];
      if (!t) return Promise.resolve({ isError: true, output: `Unknown: "${args.target_profile}"` });
      const s = args.source_water;
      const lines: string[] = [
        `Profilo acqua per **${args.target_profile}** (${t.desc})`,
        '',
        'Acqua sorgente vs target:',
        `  Ca:  ${s.ca} → ${t.ca} mg/L`,
        `  Mg:  ${s.mg} → ${t.mg} mg/L`,
        `  Na:  ${s.na} → ${t.na} mg/L`,
        `  Cl:  ${s.cl} → ${t.cl} mg/L`,
        `  SO4: ${s.so4} → ${t.so4} mg/L`,
        `  HCO3: ${s.hco3} → ${t.hco3} mg/L`,
        '',
        'Aggiunte consigliate:',
      ];
      const caDiff = t.ca - s.ca;
      if (caDiff > 0) lines.push(`  • Gesso (CaSO4): ~${(caDiff * 4.0 * args.batch_size_liters / 1000).toFixed(1)} g`);
      const so4Diff = t.so4 - s.so4;
      if (so4Diff > 0) lines.push(`  • Gesso per solfati: ~${(so4Diff * 4.3 * args.batch_size_liters / 1000).toFixed(1)} g`);
      const clDiff = t.cl - s.cl;
      if (clDiff > 0) lines.push(`  • CaCl2: ~${(clDiff * 2.1 * args.batch_size_liters / 1000).toFixed(1)} g`);
      const mgDiff = t.mg - s.mg;
      if (mgDiff > 0) lines.push(`  • Epsom (MgSO4): ~${(mgDiff * 10.1 * args.batch_size_liters / 1000).toFixed(1)} g`);
      const hco3Diff = t.hco3 - s.hco3;
      if (hco3Diff > 0) lines.push(`  • NaHCO3: ~${(hco3Diff * 1.4 * args.batch_size_liters / 1000).toFixed(1)} g`);
      else if (hco3Diff < -50) lines.push(`  • Acido lattico 88%: ~${(Math.abs(hco3Diff) * args.batch_size_liters * 0.01).toFixed(1)} ml`);
      if (lines.length <= 7) lines.push('  • Nessuna aggiunta necessaria.');
      return Promise.resolve({ output: lines.join('\n') });
    } catch (e) {
      return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) });
    }
  }
}

registerTool(WaterProfileCalculatorTool);
