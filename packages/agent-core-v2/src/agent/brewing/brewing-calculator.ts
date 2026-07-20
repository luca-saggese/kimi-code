/**
 * `brewing` domain — general brewing calculator tool.
 *
 * Covers ABV, attenuation, efficiency, strike water, volumes, pitching rates,
 * gravity corrections, and dilution calculations.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

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
  og: z.number().optional().describe('Original Gravity (e.g. 1.050).'),
  fg: z.number().optional().describe('Final Gravity (e.g. 1.010).'),
  batch_size_liters: z.number().optional().describe('Batch size in liters.'),
  grain_bill_kg: z
    .array(z.object({ malt: z.string(), kg: z.number() }))
    .optional()
    .describe('Grain bill: list of malts with kg used.'),
  measured_gravity: z.number().optional().describe('Measured pre-boil or OG gravity.'),
  mash_temp_c: z.number().optional().describe('Target mash temperature in °C.'),
  grain_temp_c: z.number().optional().describe('Grain temperature in °C.'),
  mash_thickness_l_per_kg: z.number().optional().describe('Mash thickness in L/kg (default 3.0).'),
  boil_duration_minutes: z.number().optional().describe('Boil duration in minutes.'),
  boil_off_rate_l_per_h: z.number().optional().describe('Boil-off rate in L/h (default 3.0).'),
  trub_loss_liters: z.number().optional().describe('Trub loss in liters (default 1.5).'),
  fermenter_loss_liters: z.number().optional().describe('Fermenter loss in liters (default 0.5).'),
  beer_type: z.enum(['ale', 'lager', 'hybrid']).optional().describe('Beer type for pitching rate.'),
  cells_per_ml_p_required: z.number().optional().describe('Cells per ml per °P.'),
  yeast_viability_percent: z.number().optional().describe('Yeast viability percentage.'),
  volume_liters: z.number().optional().describe('Volume to dilute in liters.'),
  current_gravity: z.number().optional().describe('Current gravity.'),
  target_gravity: z.number().optional().describe('Target gravity.'),
});

export type BrewingCalculatorInput = z.infer<typeof BrewingCalculatorInputSchema>;

const GRAVITY_POINTS_PER_KG_L: Record<string, number> = {
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

export class BrewingCalculatorTool implements BuiltinTool<BrewingCalculatorInput> {
  readonly name = 'brewing_calculator' as const;
  readonly description =
    'Calculate brewing parameters: ABV, attenuation, efficiency, strike water, volumes, pitching rates, gravity corrections, and dilution.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BrewingCalculatorInputSchema);

  resolveExecution(args: BrewingCalculatorInput): ToolExecution {
    return {
      description: `Brewing calculation: ${args.calculation}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: BrewingCalculatorInput): Promise<ExecutableToolResult> {
    try {
      switch (args.calculation) {
        case 'abv': return Promise.resolve(this.calcAbv(args));
        case 'attenuation': return Promise.resolve(this.calcAttenuation(args));
        case 'efficiency': return Promise.resolve(this.calcEfficiency(args));
        case 'strike_water': return Promise.resolve(this.calcStrikeWater(args));
        case 'mash_water_volume': return Promise.resolve(this.calcMashWaterVolume(args));
        case 'sparge_water_volume': return Promise.resolve(this.calcSpargeWaterVolume(args));
        case 'pre_boil_volume': return Promise.resolve(this.calcPreBoilVolume(args));
        case 'post_boil_volume': return Promise.resolve(this.calcPostBoilVolume(args));
        case 'pitching_rate': return Promise.resolve(this.calcPitchingRate(args));
        case 'gravity_correction': return Promise.resolve(this.calcGravityCorrection(args));
        case 'dilution': return Promise.resolve(this.calcDilution(args));
        case 'boil_off': return Promise.resolve(this.calcBoilOff(args));
      }
    } catch (error) {
      return Promise.resolve({ isError: true, output: error instanceof Error ? error.message : String(error) });
    }
  }

  private calcAbv(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.req(args.og, 'og');
    const fg = this.req(args.fg, 'fg');
    if (og <= fg) return { isError: true, output: 'OG must be greater than FG.' };
    const abv = (og - fg) * 131.25;
    return { output: `ABV = (OG ${og.toFixed(3)} − FG ${fg.toFixed(3)}) × 131.25 = **${abv.toFixed(2)}% vol**` };
  }

  private calcAttenuation(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.req(args.og, 'og');
    const fg = this.req(args.fg, 'fg');
    if (og <= fg) return { isError: true, output: 'OG must be greater than FG.' };
    const apparent = ((og - fg) / (og - 1.0)) * 100;
    let note = '';
    if (apparent > 85) note = 'Attenuazione molto alta — possibile infezione o lievito molto attenuativo.';
    else if (apparent > 75) note = 'Attenuazione tipica di un lievito ale ben gestito.';
    else if (apparent > 65) note = 'Attenuazione moderata — controlla temperatura e pitching rate.';
    else note = 'Attenuazione bassa — possibile problema di lievito, ossigenazione o temperatura.';
    return { output: `Attenuazione apparente = **${apparent.toFixed(1)}%** — ${note}` };
  }

  private calcEfficiency(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const measuredGrav = this.req(args.measured_gravity, 'measured_gravity');
    const grainBill = this.req(args.grain_bill_kg, 'grain_bill_kg');
    let theoreticalOgPoints = 0;
    for (const { malt, kg } of grainBill) {
      const p = GRAVITY_POINTS_PER_KG_L[malt.toLowerCase()];
      if (p === undefined) return { isError: true, output: `Unknown malt: "${malt}".` };
      theoreticalOgPoints += kg * p * 1000;
    }
    const theoreticalOg = 1 + theoreticalOgPoints / batchLiters;
    const efficiency = ((measuredGrav - 1) / (theoreticalOg - 1)) * 100;
    return { output: `OG teorica = ${theoreticalOg.toFixed(3)} — Efficienza = **${efficiency.toFixed(1)}%**` };
  }

  private calcStrikeWater(args: BrewingCalculatorInput): ExecutableToolResult {
    const mashTemp = this.req(args.mash_temp_c, 'mash_temp_c');
    const grainTemp = this.req(args.grain_temp_c, 'grain_temp_c');
    const thickness = args.mash_thickness_l_per_kg ?? 3.0;
    const grainKg = this.sumKg(args.grain_bill_kg);
    if (grainKg <= 0) return { isError: true, output: 'grain_bill_kg required.' };
    const strikeTemp = (0.41 / thickness) * (mashTemp - grainTemp) + mashTemp;
    return { output: `Temperatura strike water = **${strikeTemp.toFixed(1)}°C** (grainKg: ${grainKg.toFixed(2)} kg, thickness: ${thickness} L/kg)` };
  }

  private calcMashWaterVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const grainKg = this.sumKg(args.grain_bill_kg);
    if (grainKg <= 0) return { isError: true, output: 'grain_bill_kg required.' };
    const thickness = args.mash_thickness_l_per_kg ?? 3.0;
    return { output: `Volume acqua di mash = **${(grainKg * thickness).toFixed(1)} L** (${thickness} L/kg)` };
  }

  private calcSpargeWaterVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const preBoil = this.preBoilLitri(args);
    const grainKg = this.sumKg(args.grain_bill_kg);
    const thickness = args.mash_thickness_l_per_kg ?? 3.0;
    const sparge = preBoil - (grainKg * thickness - grainKg * 0.8);
    return { output: `Volume acqua di sparge = **${Math.max(0, sparge).toFixed(1)} L**` };
  }

  private calcPreBoilVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const preBoil = this.preBoilLitri(args);
    return { output: `Volume pre-boil = **${preBoil.toFixed(1)} L**` };
  }

  private calcPostBoilVolume(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const trub = args.trub_loss_liters ?? 1.5;
    const ferm = args.fermenter_loss_liters ?? 0.5;
    return { output: `Volume post-boil target = **${(batchLiters + trub + ferm).toFixed(1)} L**` };
  }

  private calcPitchingRate(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const og = this.req(args.og, 'og');
    const beerType = args.beer_type ?? 'ale';
    const cells = args.cells_per_ml_p_required ?? (beerType === 'lager' ? 1.5 : 0.75);
    const plato = this.toPlato(og);
    const viability = args.yeast_viability_percent ?? 95;
    const total = batchLiters * 1000 * plato * cells;
    const viable = total / (viability / 100);
    return { output: `Pitching rate (${beerType}): **${(viable / 1e9).toFixed(1)} miliardi** di cellule vitali (${plato.toFixed(1)}°P, viabilità ${viability}%)` };
  }

  private calcGravityCorrection(args: BrewingCalculatorInput): ExecutableToolResult {
    const og = this.req(args.og, 'og');
    const fg = this.req(args.fg, 'fg');
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const targetFg = 1.010;
    const diff = ((og - targetFg) - (og - fg)) * 131.25;
    return { output: `Correzione: aggiungi **${(diff * batchLiters * 1000 / 131.25).toFixed(0)} g** di zucchero per raggiungere ABV target.` };
  }

  private calcDilution(args: BrewingCalculatorInput): ExecutableToolResult {
    const volume = this.req(args.volume_liters, 'volume_liters');
    const curr = this.req(args.current_gravity, 'current_gravity');
    const target = this.req(args.target_gravity, 'target_gravity');
    if (curr <= target) return { isError: true, output: 'Current gravity must be > target.' };
    const dilution = volume * ((curr - 1) / (target - 1) - 1);
    return { output: `Aggiungi **${dilution.toFixed(1)} L** di acqua per diluire da ${curr.toFixed(3)} a ${target.toFixed(3)}.` };
  }

  private calcBoilOff(args: BrewingCalculatorInput): ExecutableToolResult {
    const batchLiters = this.req(args.batch_size_liters, 'batch_size_liters');
    const duration = args.boil_duration_minutes ?? 60;
    const rate = args.boil_off_rate_l_per_h ?? 3.0;
    const preBoil = this.preBoilLitri(args);
    const evaporated = (rate * duration) / 60;
    return { output: `Evaporazione: **${evaporated.toFixed(1)} L** (${((evaporated / preBoil) * 100).toFixed(1)}%) a ${rate} L/h per ${duration} min` };
  }

  private preBoilLitri(args: BrewingCalculatorInput): number {
    const batch = this.req(args.batch_size_liters, 'batch_size_liters');
    const dur = args.boil_duration_minutes ?? 60;
    const rate = args.boil_off_rate_l_per_h ?? 3.0;
    return batch + (rate * dur) / 60;
  }

  private sumKg(bill: BrewingCalculatorInput['grain_bill_kg']): number {
    if (!bill) return 0;
    let t = 0;
    for (const g of bill) t += g.kg;
    return t;
  }

  private req<T>(v: T | undefined, name: string): T {
    if (v == null) throw new Error(`Missing: ${name}`);
    return v;
  }

  private toPlato(sg: number): number {
    return -616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg;
  }
}

registerTool(BrewingCalculatorTool);
