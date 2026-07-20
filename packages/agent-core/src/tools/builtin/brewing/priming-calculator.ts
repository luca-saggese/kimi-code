/**
 * Priming calculator — calculate sugar dosage for natural carbonation in bottle or keg.
 *
 * Supports sucrose, dextrose, DME, honey, and maple syrup. Accounts for
 * residual CO2 from fermentation temperature and desired carbonation level by style.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const PrimingCalculatorInputSchema = z.object({
  batch_size_liters: z.number().describe('Batch size in liters.'),
  beer_temperature_c: z
    .number()
    .describe('Beer temperature at bottling in °C (affects residual CO2).'),
  target_co2_volumes: z
    .number()
    .optional()
    .describe('Target CO2 volumes (e.g. 2.4). Overrides style-based default.'),
  beer_style: z
    .string()
    .optional()
    .describe('Beer style for default carbonation level (e.g. "american_ipa", "weissbier").'),
  sugar_type: z
    .enum(['sucrose', 'dextrose', 'dme', 'honey', 'maple_syrup'])
    .default('sucrose')
    .describe('Priming sugar type (default: sucrose/table sugar).'),
  packaging: z
    .enum(['bottle', 'keg'])
    .default('bottle')
    .describe('Packaging method (default: bottle).'),
});

export const PrimingCalculatorOutputSchema = z.object({
  sugar_grams: z.number(),
  sugar_type: z.string(),
  co2_volumes: z.number(),
  residual_co2: z.number(),
  sugar_per_liter: z.number(),
  notes: z.array(z.string()).optional(),
});

export type PrimingCalculatorInput = z.infer<typeof PrimingCalculatorInputSchema>;
export type PrimingCalculatorOutput = z.infer<typeof PrimingCalculatorOutputSchema>;

// ─── Carbonation by style ─────────────────────────────────────────────────────

const CARBONATION_LEVELS: Record<string, number> = {
  'british_ale': 1.8,
  'mild': 1.8,
  'bitter': 1.8,
  'esb': 2.0,
  'porter': 2.0,
  'stout': 2.0,
  'brown_ale': 2.2,
  'scotch_ale': 2.2,
  'old_ale': 2.2,
  'barleywine': 2.2,
  'english_ipa': 2.2,
  'ordinary_bitter': 1.8,
  'best_bitter': 1.8,
  'strong_bitter': 2.0,
  'brown_porter': 2.0,
  'robust_porter': 2.0,
  'dry_stout': 2.0,
  'oatmeal_stout': 2.0,
  'milk_stout': 2.2,
  'foreign_extra_stout': 2.2,
  'imperial_stout': 2.2,
  'imperial_stout_ris': 2.2,
  'american_pale': 2.4,
  'american_ipa': 2.4,
  'double_ipa': 2.4,
  'session_ipa': 2.4,
  'american_stout': 2.2,
  'american_porter': 2.2,
  'amber_ale': 2.4,
  'red_ale': 2.4,
  'irish_red': 2.2,
  'blonde_ale': 2.4,
  'cream_ale': 2.4,
  'california_common': 2.4,
  'american_lager': 2.5,
  'light_lager': 2.5,
  'premium_lager': 2.5,
  'amber_lager': 2.4,
  'dark_lager': 2.4,
  'pilsner': 2.4,
  'helles': 2.4,
  'dortmunder': 2.4,
  'vienna': 2.4,
  'marzen': 2.4,
  'bock': 2.4,
  'doppelbock': 2.4,
  'dunkel': 2.4,
  'schwarzbier': 2.4,
  'kolsch': 2.4,
  'altbier': 2.4,
  'weissbier': 3.0,
  'dunkelweizen': 3.0,
  'weizenbock': 3.0,
  'berliner_weisse': 3.0,
  'gose': 3.0,
  'lambic': 3.0,
  'gueuze': 3.0,
  'saison': 3.0,
  'belgian_pale': 2.4,
  'belgian_dubbel': 2.6,
  'belgian_tripel': 2.8,
  'belgian_golden_strong': 2.8,
  'belgian_dark_strong': 2.6,
  'witbier': 2.6,
  'biere_de_garde': 2.6,
  'neipa': 2.4,
  'new_england_ipa': 2.4,
  'brut_ipa': 2.4,
  'wheat_ipa': 2.6,
  'black_ipa': 2.4,
  'red_ipa': 2.4,
  'white_ipa': 2.6,
  'belgian_ipa': 2.6,
  'kveik_ale': 2.4,
  'sour_ale': 2.6,
  'brett_beer': 2.6,
  'mixed_fermentation': 2.6,
  'flanders_red': 2.6,
  'flanders_brown': 2.6,
  'oud_bruin': 2.6,
  'rauchbier': 2.4,
  'roggenbier': 2.4,
  'dampfbier': 2.4,
  'fruit_beer': 2.4,
  'spice_beer': 2.4,
  'wood_aged': 2.2,
  'baltic_porter': 2.4,
  'pre_prohibition_lager': 2.5,
  'pre_prohibition_porter': 2.2,
  'kentucky_common': 2.4,
  'lichtenhainer': 2.4,
  'piwo_grodziskie': 2.4,
  'sahti': 2.4,
  'gotlandsdricke': 2.4,
  'kodilo': 2.4,
  'vossaol': 2.4,
  'malt_liquor': 2.5,
  'ice_beer': 2.5,
  'eisbock': 2.4,
  'wheatwine': 2.4,
  'rye_wine': 2.4,
  'wheat_doppelbock': 2.4,
  'helles_bock': 2.4,
  'maibock': 2.4,
  'eisbock_weizen': 2.4,
  'baltic_porter_imperial': 2.4,
  'english_barleywine': 2.2,
  'american_barleywine': 2.2,
  'wheat_barleywine': 2.2,
  'rye_barleywine': 2.2,
  'old_ale_stock': 2.2,
  'vintage_ale': 2.2,
  'strong_scotch_ale': 2.2,
  'imperial_red': 2.4,
  'imperial_brown': 2.4,
  'imperial_porter': 2.4,
  'american_wild_ale': 2.6,
  'brett_pale': 2.4,
  'brett_saison': 2.6,
  'brett_ipa': 2.4,
  'brett_stout': 2.2,
  'brett_porter': 2.2,
  'brett_barleywine': 2.2,
  'lambic_kriek': 3.0,
  'lambic_framboise': 3.0,
  'lambic_cassis': 3.0,
  'lambic_peche': 3.0,
  'lambic_faro': 3.0,
  'lambic_mars': 3.0,
  'lambic_oude': 3.0,
  'lambic_vieille': 3.0,
};

// ─── Sugar properties ─────────────────────────────────────────────────────────

const SUGAR_PROPERTIES: Record<string, { co2_per_gram: number; name: string; notes: string }> = {
  sucrose: {
    co2_per_gram: 0.46,
    name: 'Saccarosio (zucchero bianco)',
    notes: 'Standard, economico, fermentazione completa.',
  },
  dextrose: {
    co2_per_gram: 0.51,
    name: 'Destrosio (glucosio)',
    notes: 'Fermentazione più rapida, leggermente più efficiente del saccarosio.',
  },
  dme: {
    co2_per_gram: 0.37,
    name: 'Estratto secco di malto (DME)',
    notes: 'Aggiunge corpo e sapore maltato. Usa DME light per non alterare il colore.',
  },
  honey: {
    co2_per_gram: 0.40,
    name: 'Miele',
    notes: 'Aggiunge aroma floreale. Fermentazione più lenta, carbonazione meno prevedibile.',
  },
  maple_syrup: {
    co2_per_gram: 0.38,
    name: 'Sciroppo d\'acero',
    notes: 'Aggiunge aroma caratteristico. Usa sciroppo d\'acero puro.',
  },
};

// ─── Tool implementation ─────────────────────────────────────────────────────

export class PrimingCalculatorTool implements BuiltinTool<PrimingCalculatorInput> {
  readonly name = 'priming_calculator' as const;
  readonly description =
    'Calculate priming sugar dosage for natural carbonation in bottle or keg. Supports sucrose, dextrose, DME, honey, and maple syrup. Accounts for residual CO2 from fermentation temperature and style-based carbonation targets.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(PrimingCalculatorInputSchema);

  resolveExecution(args: PrimingCalculatorInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Priming calculation (${args.packaging})`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: PrimingCalculatorInput): Promise<ExecutableToolResult> {
    try {
      const batchLiters = args.batch_size_liters;
      const tempC = args.beer_temperature_c;
      const packaging = args.packaging ?? 'bottle';

      // Determine target CO2
      let targetCo2 = args.target_co2_volumes;
      if (targetCo2 === undefined && args.beer_style !== undefined) {
        targetCo2 = CARBONATION_LEVELS[args.beer_style];
        if (targetCo2 === undefined) {
          return Promise.resolve({
            isError: true,
            output: `Unknown beer style: "${args.beer_style}". Provide target_co2_volumes explicitly.`,
          });
        }
      }
      if (targetCo2 === undefined) {
        targetCo2 = 2.4; // default
      }

      // Keg carbonation is typically slightly lower (serving pressure)
      if (packaging === 'keg') {
        targetCo2 = Math.max(1.8, targetCo2 - 0.2);
      }

      // Residual CO2 from fermentation temperature (Henry's law approximation)
      // CO2 in solution at temp C: ~0.27 * (1 - (temp - 4) * 0.02)
      const residualCo2 = Math.max(0, 0.27 * (1 - (tempC - 4) * 0.02));

      // CO2 to add
      const co2ToAdd = targetCo2 - residualCo2;
      if (co2ToAdd <= 0) {
        return Promise.resolve({
          output: [
            'La birra ha già abbastanza CO2 residua per la carbonazione target.',
            `CO2 residua a ${tempC}°C: ${residualCo2.toFixed(2)} vol`,
            `Target: ${targetCo2.toFixed(2)} vol`,
            'Non aggiungere zucchero — imbottiglia direttamente.',
          ].join('\n'),
        });
      }

      // Sugar calculation
      const sugarType = args.sugar_type ?? 'sucrose';
      const sugar = SUGAR_PROPERTIES[sugarType];
      if (sugar === undefined) {
        return Promise.resolve({
          isError: true,
          output: `Unknown sugar type: "${sugarType}". Available: ${Object.keys(SUGAR_PROPERTIES).join(', ')}`,
        });
      }

      // Formula: grams = (CO2_to_add * batch_liters * 2.0) / sugar.co2_per_gram
      // Simplified: 1 g/L of sucrose produces ~0.46 vol CO2
      const sugarGramsPerLiter = co2ToAdd / sugar.co2_per_gram;
      const totalSugarGrams = sugarGramsPerLiter * batchLiters;

      const notes: string[] = [
        `Usa ${sugar.name}`,
        sugar.notes,
        `Carbonazione target: ${targetCo2.toFixed(1)} vol CO2 (${args.beer_style ?? 'custom'})`,
        `CO2 residua a ${tempC}°C: ${residualCo2.toFixed(2)} vol`,
        `CO2 da aggiungere: ${co2ToAdd.toFixed(2)} vol`,
      ];

      if (packaging === 'keg') {
        notes.push('Per fusti: riduci leggermente il dosaggio rispetto alle bottiglie.');
        notes.push('Considera carbonazione forzata con CO2 in bombola per risultati più rapidi e prevedibili.');
      }

      if (sugarType === 'dme') {
        notes.push('DME: sciogli in poca acqua bollente e raffredda prima di aggiungere.');
      }

      if (sugarType === 'honey' || sugarType === 'maple_syrup') {
        notes.push('Miele/sciroppo: diluisci in acqua tiepida (non bollente) per preservare gli aromi.');
      }

      return Promise.resolve({
        output: [
          `**Zucchero per priming: ${totalSugarGrams.toFixed(1)} g di ${sugar.name}**`,
          '',
          `  Dosaggio: ${sugarGramsPerLiter.toFixed(1)} g/L`,
          `  Volume: ${batchLiters.toFixed(1)} L`,
          `  Confezionamento: ${packaging === 'bottle' ? 'Bottiglia' : 'Fusto'}`,
          '',
          ...notes.map((n) => `  • ${n}`),
        ].join('\n'),
      });
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
