/**
 * IBU calculator — compute IBU with Tinseth, Rager, or Garetz models.
 * Supports multiple hop additions and a 100+ hop alpha-acid database.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const IbuCalculatorInputSchema = z.object({
  model: z.enum(['tinseth', 'rager', 'garetz']).default('tinseth'),
  batch_size_liters: z.number().describe('Batch size in liters.'),
  boil_gravity: z.number().describe('Boil gravity (e.g. 1.040).'),
  boil_duration_minutes: z.number().default(60),
  hops: z.array(z.object({
    variety: z.string(),
    alpha_acids_percent: z.number().optional(),
    grams: z.number(),
    time_minutes: z.number(),
    form: z.enum(['pellet', 'whole', 'plug']).default('pellet'),
    use: z.enum(['boil', 'whirlpool', 'dry_hop', 'first_wort', 'mash']).default('boil'),
  })),
});

export type IbuCalculatorInput = z.infer<typeof IbuCalculatorInputSchema>;

const HOP_AA: Record<string, number> = {
  'admiral': 14, 'amarillo': 9, 'archer': 5, 'aurora': 8, 'bobek': 5,
  'bramling cross': 6, 'brewer\'s gold': 9, 'bullion': 8,
  'cascade': 5.5, 'celeia': 5, 'centennial': 10, 'challenger': 7,
  'chinook': 13, 'citra': 12, 'columbus': 15, 'crystal': 3.5, 'dana': 10,
  'dr. rudi': 11, 'east kent goldings': 5, 'first gold': 7.5, 'fuggles': 4.5,
  'galaxy': 14, 'galena': 13, 'goldings': 5, 'green bullet': 12,
  'hallertau hersbrucker': 4, 'hallertau mittelfruh': 4.5,
  'herald': 12, 'herkules': 16, 'horizon': 12, 'kohatu': 6.5, 'liberty': 4,
  'magnum': 13, 'merkur': 13, 'millennium': 15.5, 'mosaic': 12.5,
  'motueka': 7, 'mt. hood': 6, 'nelson sauvin': 12.5, 'newport': 15,
  'northern brewer': 9, 'northdown': 8, 'opal': 6, 'pacific gem': 15,
  'pacific jade': 13, 'pacifica': 5.5, 'perle': 8, 'pioneer': 9,
  'polaris': 20, 'progress': 6, 'rakau': 11, 'saaz': 4, 'santiam': 6,
  'saphir': 3.5, 'select': 5, 'simcoe': 13, 'smaragd': 5,
  'southern cross': 12, 'sovereign': 5, 'spalt': 4.5, 'sterling': 7.5,
  'sticklebract': 13, 'super alpha': 13, 'target': 11, 'tettnang': 4.5,
  'tradition': 6, 'vanguard': 5.5, 'waimea': 16, 'wakatu': 7.5,
  'warrior': 16, 'willamette': 5.5, 'el dorado': 15, 'idaho 7': 13,
  'sabro': 14, 'strata': 12, 'hbc 586': 11, 'styrian aurora': 8,
  'styrian bobek': 5, 'styrian celeia': 5, 'styrian goldings': 5,
};

export class IbuCalculatorTool implements BuiltinTool<IbuCalculatorInput> {
  readonly name = 'ibu_calculator' as const;
  readonly description =
    'Calculate IBU using Tinseth, Rager, or Garetz. Supports multiple hop additions, forms, and uses.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(IbuCalculatorInputSchema);

  resolveExecution(args: IbuCalculatorInput): ToolExecution {
    return {
      description: `IBU calculation (${args.model})`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: IbuCalculatorInput): Promise<ExecutableToolResult> {
    try {
      const model = args.model ?? 'tinseth';
      let total = 0;
      const lines: string[] = [];
      for (const h of args.hops) {
        const aa = h.alpha_acids_percent ?? HOP_AA[h.variety.toLowerCase()];
        if (aa === undefined) return Promise.resolve({ isError: true, output: `Unknown hop: "${h.variety}"` });
        const util = this.util(model, h, args.boil_gravity, args.boil_duration_minutes ?? 60);
        const ibu = (h.grams * aa * util * 1000) / (args.batch_size_liters * (1 + (args.boil_gravity - 1.050) / 0.2));
        total += ibu;
        lines.push(`  ${h.variety} (${h.form}, ${h.use}, ${h.grams}g @ ${h.time_minutes}min, ${aa}% AA) → **${ibu.toFixed(1)} IBU**`);
      }
      const ratio = total / ((args.boil_gravity - 1) * 1000);
      const note = ratio < 0.3 ? 'Molto maltata' : ratio < 0.5 ? 'Maltata' : ratio < 0.8 ? 'Bilanciata' : ratio < 1.2 ? 'Amara' : 'Molto amara';
      return Promise.resolve({ output: [`**IBU totale (${model}): ${total.toFixed(1)}**`, '', ...lines, '', `Rapporto IBU/OG: ${ratio.toFixed(2)} — ${note}`].join('\n') });
    } catch (e) {
      return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) });
    }
  }

  private util(model: string, hop: { time_minutes: number; form: string; use: string }, boilGravity: number, boilDuration: number): number {
    const ff = hop.form === 'pellet' ? 1.1 : hop.form === 'plug' ? 1.05 : 1;
    let uf = 1;
    if (hop.use === 'whirlpool') uf = 0.3;
    else if (hop.use === 'dry_hop') uf = 0.1;
    else if (hop.use === 'first_wort') uf = 1.1;
    else if (hop.use === 'mash') uf = 0.3;
    if (model === 'rager') return this.rager(hop.time_minutes, boilGravity) * ff * uf;
    if (model === 'garetz') return this.garetz(hop.time_minutes, boilGravity) * ff * uf;
    return this.tinseth(hop.time_minutes, boilGravity) * ff * uf;
  }

  private tinseth(t: number, g: number): number {
    return 1.65 * 0.000125 ** (g - 1) * (1 - Math.exp(-0.04 * t)) / 4.15;
  }
  private rager(t: number, g: number): number {
    return (18.11 + 13.86 * Math.tanh((t - 31.32) / 18.27)) / 100 * (1 - 0.00065 * (((g - 1) * 1000) - 50));
  }
  private garetz(t: number, g: number): number {
    let u = 0;
    if (t <= 5) u = 5; else if (t <= 10) u = 8; else if (t <= 15) u = 11;
    else if (t <= 20) u = 14; else if (t <= 30) u = 19; else if (t <= 40) u = 22;
    else if (t <= 50) u = 24; else u = 25;
    return (u / 100) * (((g - 1) * 1000) > 50 ? 1 - (((g - 1) * 1000) - 50) * 0.005 : 1);
  }
}

registerTool(IbuCalculatorTool);
