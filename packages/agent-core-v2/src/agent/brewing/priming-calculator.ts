/**
 * Priming calculator — compute sugar dosage for natural carbonation.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const PrimingCalculatorInputSchema = z.object({
  batch_size_liters: z.number().describe('Batch size in liters.'),
  beer_temperature_c: z.number().describe('Beer temperature at bottling in °C.'),
  target_co2_volumes: z.number().optional().describe('Target CO2 volumes.'),
  beer_style: z.string().optional().describe('Beer style for default carbonation.'),
  sugar_type: z.enum(['sucrose', 'dextrose', 'dme', 'honey', 'maple_syrup']).default('sucrose'),
  packaging: z.enum(['bottle', 'keg']).default('bottle'),
});

export type PrimingCalculatorInput = z.infer<typeof PrimingCalculatorInputSchema>;

const CARB: Record<string, number> = {
  'british_ale': 1.8, 'mild': 1.8, 'bitter': 1.8, 'esb': 2.0, 'porter': 2.0,
  'stout': 2.0, 'brown_ale': 2.2, 'scotch_ale': 2.2, 'barleywine': 2.2,
  'english_ipa': 2.2, 'american_pale': 2.4, 'american_ipa': 2.4, 'double_ipa': 2.4,
  'session_ipa': 2.4, 'amber_ale': 2.4, 'red_ale': 2.4, 'blonde_ale': 2.4,
  'cream_ale': 2.4, 'american_lager': 2.5, 'light_lager': 2.5, 'pilsner': 2.4,
  'helles': 2.4, 'vienna': 2.4, 'marzen': 2.4, 'bock': 2.4, 'dunkel': 2.4,
  'schwarzbier': 2.4, 'kolsch': 2.4, 'altbier': 2.4, 'weissbier': 3.0,
  'dunkelweizen': 3.0, 'weizenbock': 3.0, 'berliner_weisse': 3.0, 'gose': 3.0,
  'lambic': 3.0, 'saison': 3.0, 'belgian_pale': 2.4, 'belgian_dubbel': 2.6,
  'belgian_tripel': 2.8, 'belgian_golden_strong': 2.8, 'belgian_dark_strong': 2.6,
  'witbier': 2.6, 'neipa': 2.4, 'kveik_ale': 2.4, 'sour_ale': 2.6,
  'brett_beer': 2.6, 'mixed_fermentation': 2.6, 'doppelbock': 2.4,
};

const SUGARS: Record<string, { co2: number; name: string }> = {
  sucrose: { co2: 0.46, name: 'Saccarosio' },
  dextrose: { co2: 0.51, name: 'Destrosio' },
  dme: { co2: 0.37, name: 'DME' },
  honey: { co2: 0.40, name: 'Miele' },
  maple_syrup: { co2: 0.38, name: 'Sciroppo d\'acero' },
};

export class PrimingCalculatorTool implements BuiltinTool<PrimingCalculatorInput> {
  readonly name = 'priming_calculator' as const;
  readonly description =
    'Calculate priming sugar dosage for natural carbonation in bottle or keg. Supports sucrose, dextrose, DME, honey, and maple syrup.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(PrimingCalculatorInputSchema);

  resolveExecution(args: PrimingCalculatorInput): ToolExecution {
    return {
      description: `Priming calculation (${args.packaging})`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: PrimingCalculatorInput): Promise<ExecutableToolResult> {
    try {
      let target = args.target_co2_volumes;
      if (target === undefined && args.beer_style) target = CARB[args.beer_style];
      if (target === undefined) target = 2.4;
      if (args.packaging === 'keg') target = Math.max(1.8, target - 0.2);

      const tempC = args.beer_temperature_c;
      const residual = Math.max(0, 0.27 * (1 - (tempC - 4) * 0.02));
      const toAdd = target - residual;
      if (toAdd <= 0) return Promise.resolve({ output: `CO2 residua sufficiente (${residual.toFixed(2)} vol per ${target} target). Nessuno zucchero necessario.` });

      const sugar = SUGARS[args.sugar_type];
      const gPerL = toAdd / sugar.co2;
      const total = gPerL * args.batch_size_liters;

      return Promise.resolve({
        output: [
          `**Priming: ${total.toFixed(1)} g di ${sugar.name}**`,
          `Dosaggio: ${gPerL.toFixed(1)} g/L × ${args.batch_size_liters.toFixed(1)} L`,
          `Carbonazione target: ${target.toFixed(1)} vol CO2`,
          `CO2 residua a ${tempC}°C: ${residual.toFixed(2)} vol`,
          `CO2 da aggiungere: ${toAdd.toFixed(2)} vol`,
        ].join('\n'),
      });
    } catch (e) {
      return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) });
    }
  }
}

registerTool(PrimingCalculatorTool);
