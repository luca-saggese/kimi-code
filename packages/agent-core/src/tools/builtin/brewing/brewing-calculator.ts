/**
 * Brewing calculator tool — general brewing calculations.
 *
 * Covers efficiency, volumes, density conversions, ABV, attenuation,
 * strike water temperature, and pitching rates.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const BrewingCalculatorInputSchema = z.object({
  calculation: z
    .enum([
      'abv',
      'attenuation',
      'efficiency',
      'strike_water',
      'mash_water_volume',
      'sparge_water_volume',
      'pre_boil_volume',
      'post_boil_volume',
      'pitching_rate',
      'gravity_correction',
      'dilution',
      'boil_off',
    ])
    .describe('The type of calculation to perform.'),
  // ABV / Attenuation
  og: z.number().optional().describe('Original Gravity (e.g. 1.050).'),
  fg: z.number().optional().describe('Final Gravity (e.g. 1.010).'),
  // Efficiency
  batch_size_liters: z.number().optional().describe('Batch size in liters.'),
  grain_bill_kg: z
    .array(z.object({ malt: z.string(), kg: z.number() }))
    .optional()
    .describe('Grain bill: list of malts with kg used.'),
  measured_gravity: z.number().optional().describe('Measured pre-boil or OG gravity.'),
  expected_gravity: z.number().optional().describe('Expected gravity for efficiency calc.'),
  // Strike water
  mash_temp_c: z.number().optional().describe('Target mash temperature in °C.'),
  grain_temp_c: z.number().optional().describe('Grain temperature in °C.'),
  mash_thickness_l_per_kg: z
    .number()
    .optional()
    .describe('Mash thickness in L/kg (default 3.0).'),
  // Volumes
  target_post_boil_liters: z.number().optional().describe('Target post-boil volume in liters.'),
  boil_duration_minutes: z.number().optional().describe('Boil duration in minutes.'),
  boil_off_rate_l_per_h: z
    .number()
    .optional()
    .describe('Boil-off rate in L/h (default 3.0 for 20L system).'),
  trub_loss_liters: z.number().optional().describe('Trub loss in liters (default 1.5).'),
  fermenter_loss_liters: z
    .number()
    .optional()
    .describe('Fermenter loss in liters (default 0.5).'),
  // Pitching rate
  beer_type: z
    .enum(['ale', 'lager', 'hybrid'])
    .optional()
    .describe('Beer type for pitching rate (default ale).'),
  cells_per_ml_p_required: z
    .number()
    .optional()
    .describe('Required cells per ml per °P (default 0.75 for ale, 1.5 for lager).'),
  yeast_viability_percent: z
    .number()
    .optional()
    .describe('Yeast viability percentage (default 95).'),
  // Dilution
  volume_liters: z.number().optional().describe('Volume to dilute in liters.'),
  current_gravity: z.number().optional().describe('Current gravity.'),
  target_gravity: z.number().optional().describe('Target gravity.'),
});

export const BrewingCalculatorOutputSchema = z.object({
  calculation: z.string(),
  result: z.string(),
  formula_used: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
});

export type BrewingCalculatorInput = z.infer<typeof BrewingCalculatorInputSchema>;
export type BrewingCalculatorOutput = z.infer<typeof BrewingCalculatorOutputSchema>;

// ─── Constants ───────────────────────────────────────────────────────────────

const GRAVITY_POINTS_PER_KG_L: Record<string, number> = {
  // Common base malts (potential extract in gravity points per kg per liter)
  'pilsner malt': 0.030,
  'maris otter': 0.029,
  'pale ale malt': 0.030,
  'munich malt': 0.028,
  'vienna malt': 0.029,
  'wheat malt': 0.030,
  'crystal malt 60l': 0.026,
  'crystal malt 120l': 0.025,
  'chocolate malt': 0.022,
  'black patent': 0.021,
  'roasted barley': 0.020,
  'flaked oats': 0.028,
  'flaked wheat': 0.029,
  'flaked barley': 0.028,
  'corn (flaked)': 0.030,
  'rice (flaked)': 0.030,
};

// ─── Tool implementation ─────────────────────────────────────────────────────

export class BrewingCalculatorTool implements BuiltinTool<BrewingCalculatorInput> {
  readonly name = 'brewing_calculator' as const;
  readonly description =
    'Calculate brewing parameters: ABV, attenuation, efficiency, strike water, volumes, pitching rates, gravity corrections, and dilution. Use for all general brewing math.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BrewingCalculatorInputSchema);

  resolveExecution(args: BrewingCalculatorInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Brewing calculation: ${args.calculation}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: BrewingCalculatorInput): Promise<ExecutableToolResult> {
    try {
      switch (args.calculation) {
        case 'abv':
          return Promise.resolve(this.calcAbv(args));
        case 'attenuation':
          return Promise.resolve(this.calcAttenuation(args));
        case 'efficiency':
          return Promise.resolve(this.calcEfficiency(args));
        case 'strike_water':
          return Promise.resolve(this.calcStrikeWater(args));
        case 'mash_water_volume':
          return Promise.resolve(this.calcMashWaterVolume(args));
        case 'sparge_water_volume':
          return Promise.resolve(this.calcSpargeWaterVolume(args));
        case 'pre_boil_volume':
          return Promise.resolve(this.calcPreBoilVolume(args));
        case 'post_boil_volume':
          return Promise.resolve(this.calcPostBoilVolume(args));
        case 'pitching_rate':
          return Promise.resolve(this.calcPitchingRate(args));
        case 'gravity_correction':
          return Promise.resolve(this.calcGravityCorrection(args));
        case 'dilution':
          return Promise.resolve(this.calcDilution(args));
        case 'boil_off':
          return Promise.resolve(this.calcBoilOff(args));
        default:
          return Promise.resolve({
            isError: true,
            output: `Unknown calculation: ${String(args.calculation)}`,
          });
      }
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ─── ABV ──────────────────────────────────────────────────────────────────

  private calcAbv(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.requireOg(args);
    const fg = this.requireFg(args);
    if (og <= fg) {
      return { isError: true, output: 'OG must be greater than FG for ABV calculation.' };
    }
    const abv = (og - fg) * 131.25;
    const abw = abv * 0.793;
    return {
      output: [
        `ABV = (OG ${og.toFixed(3)} − FG ${fg.toFixed(3)}) × 131.25 = **${abv.toFixed(2)}% vol**`,
        `ABW = ${abw.toFixed(2)}% peso`,
      ].join('\n'),
    };
  }

  // ─── Attenuation ──────────────────────────────────────────────────────────

  private calcAttenuation(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.requireOg(args);
    const fg = this.requireFg(args);
    if (og <= fg) {
      return { isError: true, output: 'OG must be greater than FG.' };
    }
    const apparent = ((og - fg) / (og - 1.0)) * 100;
    const real = apparent * 0.8192; // correction for alcohol density
    return {
      output: [
        `Attenuazione apparente = (OG ${og.toFixed(3)} − FG ${fg.toFixed(3)}) / (OG ${og.toFixed(3)} − 1.000) × 100 = **${apparent.toFixed(1)}%**`,
        `Attenuazione reale = ${real.toFixed(1)}% (correzione per densità alcol)`,
        this.attenuationNote(apparent),
      ].join('\n'),
    };
  }

  private attenuationNote(attenuation: number): string {
    if (attenuation > 85) return 'Attenuazione molto alta — possibile infezione o lievito molto attenuativo.';
    if (attenuation > 75) return 'Attenuazione tipica di un lievito ale ben gestito.';
    if (attenuation > 65) return 'Attenuazione moderata — controlla temperatura e pitching rate.';
    return 'Attenuazione bassa — possibile problema di lievito, ossigenazione o temperatura.';
  }

  // ─── Efficiency ───────────────────────────────────────────────────────────

  private calcEfficiency(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const measuredGrav = this.require(args.measured_gravity, 'measured_gravity');
    const grainBill = this.require(args.grain_bill_kg, 'grain_bill_kg');

    let theoreticalOgPoints = 0;
    for (const { malt, kg } of grainBill) {
      const pointsPerKgL = GRAVITY_POINTS_PER_KG_L[malt.toLowerCase()];
      if (pointsPerKgL === undefined) {
        return {
          isError: true,
          output: `Unknown malt: "${malt}". Add it to GRAVITY_POINTS_PER_KG_L or use a known malt.`,
        };
      }
      theoreticalOgPoints += kg * pointsPerKgL * 1000; // convert to gravity points
    }
    const theoreticalOg = 1 + theoreticalOgPoints / batchLiters;
    const efficiency = ((measuredGrav - 1) / (theoreticalOg - 1)) * 100;

    return {
      output: [
        `Efficienza = ((SG misurata − 1) / (OG teorica − 1)) × 100`,
        `OG teorica = ${theoreticalOg.toFixed(3)}`,
        `Efficienza = **${efficiency.toFixed(1)}%**`,
        efficiency > 85
          ? 'Efficienza molto alta — verifica la misurazione del volume.'
          : efficiency > 70
            ? 'Efficienza tipica per un sistema all-in-one ben gestito.'
            : 'Efficienza bassa — considera di macinare più fine o ridurre il mash thickness.',
      ].join('\n'),
    };
  }

  // ─── Strike Water ─────────────────────────────────────────────────────────

  private calcStrikeWater(args: BrewingCalculatorInput): ExecutableToolResult {
    const mashTemp = this.require(args.mash_temp_c, 'mash_temp_c');
    const grainTemp = this.require(args.grain_temp_c, 'grain_temp_c');
    const thickness = args.mash_thickness_l_per_kg ?? 3.0;
    const grainKg = this.sumGrainKg(args.grain_bill_kg);
    if (grainKg <= 0) {
      return { isError: true, output: 'grain_bill_kg is required and must sum to > 0 kg.' };
    }

    // Palmer formula: strike_water = (0.41 / thickness) * (mash_temp - grain_temp) + mash_temp
    const strikeTemp = (0.41 / thickness) * (mashTemp - grainTemp) + mashTemp;

    return {
      output: [
        `Temperatura strike water = **${strikeTemp.toFixed(1)}°C**`,
        ``,
        `Parametri:`,
        `  - Temperatura mash target: ${mashTemp.toFixed(1)}°C`,
        `  - Temperatura grani: ${grainTemp.toFixed(1)}°C`,
        `  - Rapporto acqua/grani: ${thickness.toFixed(1)} L/kg`,
        `  - Peso grani totale: ${grainKg.toFixed(2)} kg`,
        `  - Formula: (0.41 / ${thickness.toFixed(1)}) × (${mashTemp.toFixed(1)} − ${grainTemp.toFixed(1)}) + ${mashTemp.toFixed(1)}`,
      ].join('\n'),
    };
  }

  // ─── Mash Water Volume ────────────────────────────────────────────────────

  private calcMashWaterVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const grainKg = this.sumGrainKg(args.grain_bill_kg);
    if (grainKg <= 0) {
      return { isError: true, output: 'grain_bill_kg is required and must sum to > 0 kg.' };
    }
    const thickness = args.mash_thickness_l_per_kg ?? 3.0;
    const volume = grainKg * thickness;

    return {
      output: [
        `Volume acqua di mash = **${volume.toFixed(1)} L**`,
        `Peso grani: ${grainKg.toFixed(2)} kg`,
        `Rapporto: ${thickness.toFixed(1)} L/kg`,
        `Consiglio: per sistemi all-in-one da 20-65L, resta tra 2.5 e 3.5 L/kg.`,
      ].join('\n'),
    };
  }

  // ─── Sparge Water Volume ──────────────────────────────────────────────────

  private calcSpargeWaterVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const preBoil = this.calcPreBoilLiters(args);
    const grainKg = this.sumGrainKg(args.grain_bill_kg);
    const mashThickness = args.mash_thickness_l_per_kg ?? 3.0;
    const mashWater = grainKg * mashThickness;
    // Grain absorbs ~0.8 L/kg
    const grainAbsorption = grainKg * 0.8;
    const spargeWater = preBoil - (mashWater - grainAbsorption);

    return {
      output: [
        `Volume acqua di sparge = **${Math.max(0, spargeWater).toFixed(1)} L**`,
        ``,
        `Bilancio volumi:`,
        `  - Target pre-boil: ${preBoil.toFixed(1)} L`,
        `  - Acqua di mash: ${mashWater.toFixed(1)} L`,
        `  - Assorbimento grani (0.8 L/kg): ${grainAbsorption.toFixed(1)} L`,
        `  - Acqua di sparge: ${Math.max(0, spargeWater).toFixed(1)} L`,
      ].join('\n'),
    };
  }

  // ─── Pre-boil Volume ──────────────────────────────────────────────────────

  private calcPreBoilVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const preBoil = this.calcPreBoilLiters(args);
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const boilDuration = args.boil_duration_minutes ?? 60;
    const boilOffRate = args.boil_off_rate_l_per_h ?? 3.0;

    return {
      output: [
        `Volume pre-boil = **${preBoil.toFixed(1)} L**`,
        ``,
        `Parametri:`,
        `  - Batch size target: ${batchLiters.toFixed(1)} L`,
        `  - Durata bollitura: ${boilDuration} min`,
        `  - Tasso di evaporazione: ${boilOffRate.toFixed(1)} L/h`,
        `  - Volume evaporato: ${((boilOffRate * boilDuration) / 60).toFixed(1)} L`,
      ].join('\n'),
    };
  }

  private calcPreBoilLiters(args: BrewingCalculatorInput): number {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const boilDuration = args.boil_duration_minutes ?? 60;
    const boilOffRate = args.boil_off_rate_l_per_h ?? 3.0;
    return batchLiters + (boilOffRate * boilDuration) / 60;
  }

  // ─── Post-boil Volume ─────────────────────────────────────────────────────

  private calcPostBoilVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const trubLoss = args.trub_loss_liters ?? 1.5;
    const fermenterLoss = args.fermenter_loss_liters ?? 0.5;
    const postBoil = batchLiters + trubLoss + fermenterLoss;

    return {
      output: [
        `Volume post-boil target = **${postBoil.toFixed(1)} L**`,
        ``,
        `Bilancio:`,
        `  - Batch size (in fermentatore): ${batchLiters.toFixed(1)} L`,
        `  - Perdita trub: ${trubLoss.toFixed(1)} L`,
        `  - Perdita fermentatore: ${fermenterLoss.toFixed(1)} L`,
        `  - Totale post-boil: ${postBoil.toFixed(1)} L`,
      ].join('\n'),
    };
  }

  // ─── Pitching Rate ────────────────────────────────────────────────────────

  private calcPitchingRate(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const og = this.requireOg(args);
    const beerType = args.beer_type ?? 'ale';
    const cellsPerMlP =
      args.cells_per_ml_p_required ?? (beerType === 'lager' ? 1.5 : beerType === 'hybrid' ? 1.0 : 0.75);
    const plato = this.gravityToPlato(og);
    const viability = args.yeast_viability_percent ?? 95;
    const totalCellsNeeded = batchLiters * 1000 * plato * cellsPerMlP;
    const viableCellsNeeded = totalCellsNeeded / (viability / 100);

    return {
      output: [
        `Pitching rate per ${beerType}: **${cellsPerMlP.toFixed(2)} milioni di cellule/ml/°P**`,
        ``,
        `Calcolo:`,
        `  - Volume: ${batchLiters.toFixed(1)} L = ${(batchLiters * 1000).toFixed(0)} ml`,
        `  - Densità: ${og.toFixed(3)} = ${plato.toFixed(1)}°P`,
        `  - Cellule totali necessarie: ${(totalCellsNeeded / 1e9).toFixed(1)} miliardi`,
        `  - Con viabilità ${viability}%: ${(viableCellsNeeded / 1e9).toFixed(1)} miliardi di cellule vitali`,
        ``,
        `Consiglio: usa un starter per birre sopra 1.060 OG o sotto 65% di attenuazione attesa.`,
      ].join('\n'),
    };
  }

  // ─── Gravity Correction ───────────────────────────────────────────────────

  private calcGravityCorrection(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.requireOg(args);
    const fg = this.requireFg(args);
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const targetFg = 1.010; // typical target for most ales
    const currentAbv = (og - fg) * 131.25;
    const targetAbv = (og - targetFg) * 131.25;
    const correctionPoints = (targetAbv - currentAbv) / 131.25;

    return {
      output: [
        `Correzione gravità:`,
        `  OG: ${og.toFixed(3)}, FG attuale: ${fg.toFixed(3)}, FG target: ${targetFg.toFixed(3)}`,
        `  ABV attuale: ${currentAbv.toFixed(2)}% → ABV target: ${targetAbv.toFixed(2)}%`,
        `  Differenza: ${correctionPoints > 0 ? '+' : ''}${(correctionPoints * 1000).toFixed(0)} punti`,
        ``,
        correctionPoints > 0
          ? `Aggiungi ${(correctionPoints * batchLiters * 1000).toFixed(0)} g di zucchero fermentabile per correggere.`
          : `Diluisci con ${(Math.abs(correctionPoints) * batchLiters * 10).toFixed(0)} ml di acqua.`,
      ].join('\n'),
    };
  }

  // ─── Dilution ─────────────────────────────────────────────────────────────

  private calcDilution(args: BrewingCalculatorInput): ExecutableToolResult {
    const volume = this.require(args.volume_liters, 'volume_liters');
    const currentGrav = this.require(args.current_gravity, 'current_gravity');
    const targetGrav = this.require(args.target_gravity, 'target_gravity');
    if (currentGrav <= targetGrav) {
      return { isError: true, output: 'Current gravity must be greater than target gravity.' };
    }
    const dilutionVolume = volume * ((currentGrav - 1) / (targetGrav - 1) - 1);

    return {
      output: [
        `Per diluire da ${currentGrav.toFixed(3)} a ${targetGrav.toFixed(3)}:`,
        `  - Volume attuale: ${volume.toFixed(1)} L`,
        `  - Aggiungi: **${dilutionVolume.toFixed(1)} L di acqua**`,
        `  - Volume finale: ${(volume + dilutionVolume).toFixed(1)} L`,
      ].join('\n'),
    };
  }

  // ─── Boil Off ─────────────────────────────────────────────────────────────

  private calcBoilOff(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.require(args.batch_size_liters, 'batch_size_liters');
    const boilDuration = args.boil_duration_minutes ?? 60;
    const boilOffRate = args.boil_off_rate_l_per_h ?? 3.0;
    const preBoil = this.calcPreBoilLiters(args);
    const postBoil = preBoil - (boilOffRate * boilDuration) / 60;
    const evaporationPercent = (((preBoil - postBoil) / preBoil) * 100).toFixed(1);

    return {
      output: [
        `Evaporazione bollitura:`,
        `  - Pre-boil: ${preBoil.toFixed(1)} L`,
        `  - Post-boil: ${postBoil.toFixed(1)} L`,
        `  - Evaporato: ${(preBoil - postBoil).toFixed(1)} L (${evaporationPercent}%)`,
        `  - Tasso: ${boilOffRate.toFixed(1)} L/h`,
      ].join('\n'),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private sumGrainKg(bill: readonly { malt: string; kg: number }[] | undefined): number {
    if (!bill) return 0;
    let total = 0;
    for (const grain of bill) {
      total += grain.kg;
    }
    return total;
  }

  private requireOg(args: BrewingCalculatorInput): number {
    return this.require(args.og, 'og');
  }

  private requireFg(args: BrewingCalculatorInput): number {
    return this.require(args.fg, 'fg');
  }

  private require<T>(value: T | undefined, name: string): T {
    if (value === undefined || value === null) {
      throw new Error(`Missing required parameter: ${name}`);
    }
    return value;
  }

  private gravityToPlato(sg: number): number {
    return (-1 * 616.868) + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg;
  }
}
