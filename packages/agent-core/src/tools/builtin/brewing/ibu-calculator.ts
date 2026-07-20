/**
 * IBU calculator — calculate International Bittering Units using Tinseth, Rager, or Garetz models.
 *
 * Supports multiple hop additions with different times, forms, and alpha acids.
 * Accounts for boil gravity, volume, and hop utilization.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const IbuCalculatorInputSchema = z.object({
  model: z
    .enum(['tinseth', 'rager', 'garetz'])
    .default('tinseth')
    .describe('IBU calculation model (default: tinseth).'),
  batch_size_liters: z.number().describe('Batch size in liters (post-boil).'),
  boil_gravity: z.number().describe('Boil gravity (pre-boil or average, e.g. 1.040).'),
  boil_duration_minutes: z.number().default(60).describe('Boil duration in minutes (default 60).'),
  hops: z
    .array(
      z.object({
        variety: z.string().describe('Hop variety name (e.g. "Citra").'),
        alpha_acids_percent: z.number().optional().describe('Alpha acids percentage (e.g. 12.5).'),
        grams: z.number().describe('Amount in grams.'),
        time_minutes: z.number().describe('Boil time in minutes (0 = flameout, negative = whirlpool/dry hop).'),
        form: z.enum(['pellet', 'whole', 'plug']).default('pellet').describe('Hop form.'),
        use: z
          .enum(['boil', 'whirlpool', 'dry_hop', 'first_wort', 'mash'])
          .default('boil')
          .describe('Hop use.'),
      }),
    )
    .describe('List of hop additions.'),
  target_ibu: z.number().optional().describe('Target IBU — if provided, suggests hop amount adjustment.'),
});

export const IbuCalculatorOutputSchema = z.object({
  model: z.string(),
  total_ibu: z.number(),
  additions: z.array(z.string()),
  balance_note: z.string().optional(),
});

export type IbuCalculatorInput = z.infer<typeof IbuCalculatorInputSchema>;
export type IbuCalculatorOutput = z.infer<typeof IbuCalculatorOutputSchema>;

// ─── Hop database (alpha acid averages) ───────────────────────────────────────

const HOP_ALPHA_ACIDS: Record<string, number> = {
  'admiral': 14.0,
  'amarillo': 9.0,
  'archer': 5.0,
  'argeton': 7.0,
  'aurora': 8.0,
  'beata': 5.0,
  'boadicea': 9.0,
  'bobek': 5.0,
  'bramling cross': 6.0,
  'brewer\'s gold': 9.0,
  'bullion': 8.0,
  'cascade': 5.5,
  'celeia': 5.0,
  'centennial': 10.0,
  'challenger': 7.0,
  'chinook': 13.0,
  'citra': 12.0,
  'columbus': 15.0,
  'crystal': 3.5,
  'dana': 10.0,
  'dr. rudi': 11.0,
  'east kent goldings': 5.0,
  'first gold': 7.5,
  'fuggles': 4.5,
  'galaxy': 14.0,
  'galena': 13.0,
  'goldings': 5.0,
  'green bullet': 12.0,
  'hallertau hersbrucker': 4.0,
  'hallertau mittelfruh': 4.5,
  'herald': 12.0,
  'herkules': 16.0,
  'horizon': 12.0,
  'kohatu': 6.5,
  'liberty': 4.0,
  'magnum': 13.0,
  'merkur': 13.0,
  'millennium': 15.5,
  'mosaic': 12.5,
  'motueka': 7.0,
  'mt. hood': 6.0,
  'nelson sauvin': 12.5,
  'newport': 15.0,
  'northern brewer': 9.0,
  'northdown': 8.0,
  'opal': 6.0,
  'pacific gem': 15.0,
  'pacific jade': 13.0,
  'pacifica': 5.5,
  'perle': 8.0,
  'pioneer': 9.0,
  'polaris': 20.0,
  'progress': 6.0,
  'rakau': 11.0,
  'saaz': 4.0,
  'santiam': 6.0,
  'saphir': 3.5,
  'savinjski goldings': 5.0,
  'select': 5.0,
  'simcoe': 13.0,
  'smaragd': 5.0,
  'southern cross': 12.0,
  'sovereign': 5.0,
  'spalt': 4.5,
  'sterling': 7.5,
  'sticklebract': 13.0,
  'styrian aurora': 8.0,
  'styrian bobek': 5.0,
  'styrian celeia': 5.0,
  'styrian dana': 10.0,
  'styrian goldings': 5.0,
  'styrian kolibri': 6.0,
  'styrian wolf': 6.0,
  'super alpha': 13.0,
  'target': 11.0,
  'tettnang': 4.5,
  'tradition': 6.0,
  'vanguard': 5.5,
  'wadworth': 6.0,
  'waimea': 16.0,
  'wakatu': 7.5,
  'warrior': 16.0,
  'whitbread goldings': 6.0,
  'willamette': 5.5,
  'wye challenger': 7.0,
  'wye northdown': 8.0,
  'wye target': 11.0,
};

// ─── Tool implementation ─────────────────────────────────────────────────────

export class IbuCalculatorTool implements BuiltinTool<IbuCalculatorInput> {
  readonly name = 'ibu_calculator' as const;
  readonly description =
    'Calculate IBU (International Bittering Units) using Tinseth, Rager, or Garetz models. Supports multiple hop additions, different forms, and uses. Provides per-addition breakdown and balance assessment.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(IbuCalculatorInputSchema);

  resolveExecution(args: IbuCalculatorInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `IBU calculation (${args.model})`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: IbuCalculatorInput): Promise<ExecutableToolResult> {
    try {
      const model = args.model ?? 'tinseth';
      const batchLiters = args.batch_size_liters;
      const boilGravity = args.boil_gravity;
      const boilDuration = args.boil_duration_minutes ?? 60;

      let totalIbu = 0;
      const additionLines: string[] = [];

      for (const hop of args.hops) {
        const alphaAcid = hop.alpha_acids_percent ?? this.lookupAlphaAcid(hop.variety);
        const utilization = this.calcUtilization(model, hop, boilGravity, boilDuration);
        const ibu = this.calcIbu(hop, alphaAcid, utilization, batchLiters, boilGravity);
        totalIbu += ibu;

        additionLines.push(
          `  ${hop.variety} (${hop.form}, ${hop.use}, ${hop.grams}g @ ${hop.time_minutes}min, ${alphaAcid}% AA) → **${ibu.toFixed(1)} IBU**`,
        );
      }

      // Balance assessment
      const ogPoints = (boilGravity - 1) * 1000;
      const bitternessRatio = totalIbu / ogPoints;
      let balanceNote: string;
      if (bitternessRatio < 0.3) {
        balanceNote = 'Molto maltata — considera di aumentare il luppolo amaro.';
      } else if (bitternessRatio < 0.5) {
        balanceNote = 'Maltata — adatta a stili malt-forward come Scotch Ale o Doppelbock.';
      } else if (bitternessRatio < 0.8) {
        balanceNote = 'Bilanciata — adatta alla maggior parte degli stili.';
      } else if (bitternessRatio < 1.2) {
        balanceNote = 'Amara — adatta a IPA e stili luppolati.';
      } else {
        balanceNote = 'Molto amara — adatta a Double IPA o stili estremi.';
      }

      return Promise.resolve({
        output: [
          `**IBU totale (${model}): ${totalIbu.toFixed(1)}**`,
          '',
          'Dettaglio per aggiunta:',
          ...additionLines,
          '',
          `Rapporto amaro/densità (IBU/OG): ${bitternessRatio.toFixed(2)} — ${balanceNote}`,
        ].join('\n'),
      });
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private lookupAlphaAcid(variety: string): number {
    const normalized = variety.toLowerCase().trim();
    const alpha = HOP_ALPHA_ACIDS[normalized];
    if (alpha === undefined) {
      throw new Error(`Unknown hop variety: "${variety}". Provide alpha_acids_percent explicitly.`);
    }
    return alpha;
  }

  private calcUtilization(
    model: string,
    hop: { time_minutes: number; form: string; use: string },
    boilGravity: number,
    boilDuration: number,
  ): number {
    const time = hop.time_minutes;
    const form = hop.form ?? 'pellet';
    const use = hop.use ?? 'boil';

    // Form factor: pellets have ~10% higher utilization than whole
    const formFactor = form === 'pellet' ? 1.1 : form === 'plug' ? 1.05 : 1.0;

    // Use factor
    let useFactor = 1.0;
    if (use === 'whirlpool') useFactor = 0.3; // ~30% of boil utilization
    else if (use === 'dry_hop') useFactor = 0.1; // ~10% for aroma contribution
    else if (use === 'first_wort') useFactor = 1.1; // slightly higher than 60min boil
    else if (use === 'mash') useFactor = 0.3;

    if (model === 'rager') {
      return this.ragerUtilization(time, boilGravity) * formFactor * useFactor;
    } else if (model === 'garetz') {
      return this.garetzUtilization(time, boilGravity, boilDuration) * formFactor * useFactor;
    }
    // Default: Tinseth
    return this.tinsethUtilization(time, boilGravity) * formFactor * useFactor;
  }

  private tinsethUtilization(timeMinutes: number, boilGravity: number): number {
    // Tinseth formula: utilization = 1.65 * 0.000125^(boil_gravity - 1) * (1 - e^(-0.04 * time)) / 4.15
    const gravityFactor = 1.65 * Math.pow(0.000125, boilGravity - 1);
    const timeFactor = (1 - Math.exp(-0.04 * timeMinutes)) / 4.15;
    return gravityFactor * timeFactor;
  }

  private ragerUtilization(timeMinutes: number, boilGravity: number): number {
    // Rager formula: utilization = 18.11 + 13.86 * tanh((time - 31.32) / 18.27)
    // Adjusted for gravity: utilization * (1 - 0.00065 * (gravity_points - 1.050))
    const gravityPoints = (boilGravity - 1) * 1000;
    const baseUtil = 18.11 + 13.86 * Math.tanh((timeMinutes - 31.32) / 18.27);
    const gravityAdjustment = 1 - 0.00065 * (gravityPoints - 50);
    return (baseUtil / 100) * gravityAdjustment;
  }

  private garetzUtilization(timeMinutes: number, boilGravity: number, _boilDuration: number): number {
    // Garetz is more complex — simplified version
    const gravityPoints = (boilGravity - 1) * 1000;
    let utilization = 0;

    if (timeMinutes <= 5) utilization = 5;
    else if (timeMinutes <= 10) utilization = 8;
    else if (timeMinutes <= 15) utilization = 11;
    else if (timeMinutes <= 20) utilization = 14;
    else if (timeMinutes <= 30) utilization = 19;
    else if (timeMinutes <= 40) utilization = 22;
    else if (timeMinutes <= 50) utilization = 24;
    else utilization = 25;

    // Gravity adjustment
    const gravityAdjustment = gravityPoints > 50 ? 1 - (gravityPoints - 50) * 0.005 : 1;

    return (utilization / 100) * gravityAdjustment;
  }

  private calcIbu(
    hop: { grams: number; alpha_acids_percent?: number },
    alphaAcid: number,
    utilization: number,
    batchLiters: number,
    boilGravity: number,
  ): number {
    // IBU = (grams * alpha_acid% * utilization * 1000) / (volume * (1 + (gravity - 1.050) / 0.2))
    const gravityCorrection = 1 + (boilGravity - 1.050) / 0.2;
    return (hop.grams * alphaAcid * utilization * 1000) / (batchLiters * gravityCorrection);
  }
}
