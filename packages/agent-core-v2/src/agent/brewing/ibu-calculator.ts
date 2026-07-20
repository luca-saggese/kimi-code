/**
 * IBU calculator — compute IBU with Tinseth or Rager models.
 * Supports multiple hop additions and a 100+ hop alpha-acid database.
 * Whirlpool IBU is an empirical temperature-based estimate.
 */

import { z } from 'zod';

import type { BuiltinTool, ExecutableToolResult, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '#/tool/input-schema';

export const IbuCalculatorInputSchema = z.object({
  model: z.enum(['tinseth', 'rager']).default('tinseth'),

  batch_size_liters: z
    .number()
    .positive()
    .describe('Final wort or beer volume used for the IBU calculation, in liters.'),

  boil_gravity: z
    .number()
    .min(1)
    .max(1.300)
    .describe('Average boil gravity, e.g. 1.040.'),

  original_gravity: z
    .number()
    .min(1)
    .max(1.300)
    .optional()
    .describe('Original gravity used only for the BU:GU ratio, e.g. 1.050.'),

  boil_duration_minutes: z
    .number()
    .int()
    .positive()
    .default(60),

  hops: z.array(
    z.object({
      variety: z.string().min(1),

      alpha_acids_percent: z
        .number()
        .min(0)
        .max(30)
        .optional(),

      grams: z
        .number()
        .nonnegative(),

      time_minutes: z
        .number()
        .nonnegative()
        .describe(
          'For boil additions: minutes remaining in the boil. ' +
          'For whirlpool additions: duration of the hop stand.'
        ),

      form: z
        .enum(['pellet', 'whole', 'plug'])
        .default('pellet'),

      use: z
        .enum(['boil', 'whirlpool', 'dry_hop', 'first_wort', 'mash'])
        .default('boil'),

      whirlpool_temperature_c: z
        .number()
        .min(50)
        .max(100)
        .optional(),
    })
  ),
}).superRefine((data, ctx) => {
  data.hops.forEach((hop, index) => {
    if (
      hop.use === 'boil' &&
      hop.time_minutes > data.boil_duration_minutes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hops', index, 'time_minutes'],
        message:
          'Boil hop time cannot exceed the total boil duration.',
      });
    }

    if (
      hop.use === 'whirlpool' &&
      hop.whirlpool_temperature_c === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hops', index, 'whirlpool_temperature_c'],
        message:
          'Whirlpool temperature is required for whirlpool additions.',
      });
    }
  });
});

export type IbuCalculatorInput = z.infer<typeof IbuCalculatorInputSchema>;

type HopAddition = IbuCalculatorInput['hops'][number];

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
    'Calculate IBU using Tinseth or Rager. ' +
    'Supports boil, first-wort and empirical whirlpool estimates.';

  readonly parameters: Record<string, unknown> = toInputJsonSchema(IbuCalculatorInputSchema);

  resolveExecution(args: IbuCalculatorInput): ToolExecution {
    return {
      description: `IBU calculation (${args.model})`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(
    args: IbuCalculatorInput
  ): Promise<ExecutableToolResult> {
    try {
      const model = args.model ?? 'tinseth';
      let totalIbu = 0;

      const lines: string[] = [];
      const warnings: string[] = [];

      for (const hop of args.hops) {
        const normalizedVariety = hop.variety
          .trim()
          .toLowerCase();

        const databaseAa = HOP_AA[normalizedVariety];

        const aa =
          hop.alpha_acids_percent ??
          databaseAa;

        if (aa === undefined) {
          return Promise.resolve({
            isError: true,
            output:
              `Unknown hop: "${hop.variety}". ` +
              'Provide alpha_acids_percent explicitly.',
          });
        }

        const aaSource =
          hop.alpha_acids_percent === undefined
            ? 'database average'
            : 'user supplied';

        const ibu = this.calculateHopIbu(
          model,
          hop,
          aa,
          args
        );

        totalIbu += ibu;

        if (
          hop.alpha_acids_percent === undefined
        ) {
          warnings.push(
            `${hop.variety}: AA% taken from the internal database ` +
            `(${aa.toFixed(1)}%). Use the package value for better accuracy.`
          );
        }

        if (hop.use === 'dry_hop') {
          warnings.push(
            `${hop.variety}: dry hopping is reported as 0 calculated IBU. ` +
            'It may still affect measured and perceived bitterness.'
          );
        }

        if (hop.use === 'mash') {
          warnings.push(
            `${hop.variety}: mash hopping is reported as 0 calculated IBU.`
          );
        }

        const detailParts = [
          `${hop.variety}`,
          `${hop.form}`,
          `${hop.use}`,
          `${hop.grams}g`,
        ];

        if (hop.use === 'first_wort') {
          detailParts.push(
            `${args.boil_duration_minutes} min effective boil`
          );
        } else {
          detailParts.push(
            `${hop.time_minutes} min`
          );
        }

        if (
          hop.use === 'whirlpool' &&
          hop.whirlpool_temperature_c !== undefined
        ) {
          detailParts.push(
            `${hop.whirlpool_temperature_c}°C`
          );
        }

        detailParts.push(
          `${aa}% AA`,
          aaSource
        );

        lines.push(
          `  ${detailParts.join(', ')} → ` +
          `**${ibu.toFixed(1)} IBU**`
        );
      }

      const output: string[] = [
        `**IBU totale (${model}): ${totalIbu.toFixed(1)}**`,
        '',
        ...lines,
      ];

      if (args.original_gravity !== undefined) {
        const gravityUnits =
          (args.original_gravity - 1) * 1000;

        if (gravityUnits > 0) {
          const buGu = totalIbu / gravityUnits;

          output.push(
            '',
            `Rapporto BU:GU: ${buGu.toFixed(2)}`
          );
        }
      }

      const uniqueWarnings = [...new Set(warnings)];

      if (uniqueWarnings.length > 0) {
        output.push(
          '',
          '**Note:**',
          ...uniqueWarnings.map(
            warning => `- ${warning}`
          )
        );
      }

      return Promise.resolve({
        output: output.join('\n'),
      });
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  private calculateHopIbu(
    model: 'tinseth' | 'rager',
    hop: HopAddition,
    aaPercent: number,
    args: IbuCalculatorInput
  ): number {
    if (
      hop.grams === 0 ||
      aaPercent === 0
    ) {
      return 0;
    }

    switch (hop.use) {
      case 'boil':
        return this.calculateBoilIbu(
          model,
          hop.grams,
          aaPercent,
          hop.time_minutes,
          args.boil_gravity,
          args.batch_size_liters,
          hop.form
        );

      case 'first_wort': {
        const baseIbu = this.calculateBoilIbu(
          model,
          hop.grams,
          aaPercent,
          args.boil_duration_minutes,
          args.boil_gravity,
          args.batch_size_liters,
          hop.form
        );

        /*
         * Conventional approximation:
         * FWH is treated as a full-boil addition with a 10% increase.
         */
        return baseIbu * 1.10;
      }

      case 'whirlpool':
        return this.calculateWhirlpoolIbu(
          model,
          hop,
          aaPercent,
          args.boil_gravity,
          args.batch_size_liters
        );

      case 'dry_hop':
      case 'mash':
        return 0;

      default:
        return 0;
    }
  }

  private calculateBoilIbu(
    model: 'tinseth' | 'rager',
    grams: number,
    aaPercent: number,
    timeMinutes: number,
    gravity: number,
    volumeLiters: number,
    form: HopAddition['form']
  ): number {
    const formFactor =
      this.getHopFormFactor(form);

    if (model === 'rager') {
      const utilization =
        this.ragerUtilization(timeMinutes) *
        formFactor;

      const gravityAdjustment =
        this.ragerGravityAdjustment(gravity);

      return (
        grams *
        aaPercent *
        utilization *
        10
      ) / (
        volumeLiters *
        (1 + gravityAdjustment)
      );
    }

    const utilization =
      this.tinsethUtilization(
        timeMinutes,
        gravity
      ) * formFactor;

    return (
      grams *
      aaPercent *
      utilization *
      10
    ) / volumeLiters;
  }

  private calculateWhirlpoolIbu(
    model: 'tinseth' | 'rager',
    hop: HopAddition,
    aaPercent: number,
    gravity: number,
    volumeLiters: number
  ): number {
    const temperature =
      hop.whirlpool_temperature_c;

    if (temperature === undefined) {
      return 0;
    }

    const temperatureFactor =
      this.whirlpoolTemperatureFactor(
        temperature
      );

    if (temperatureFactor <= 0) {
      return 0;
    }

    /*
     * Empirical whirlpool estimate: compute the theoretical IBU at time=0
     * (which yields ~5 % utilization under Rager, and 0 % under Tinseth)
     * and scale it by a temperature-dependent factor.
     *
     * This intentionally under-reports Tinseth whirlpool IBU — the model
     * has no time component at 0 minutes — and is deliberately conservative.
     * Real whirlpool isomerisation depends on the cooling curve, which no
     * simple calculator can model accurately.
     */
    const baseIbu = this.calculateBoilIbu(
      model,
      hop.grams,
      aaPercent,
      0,
      gravity,
      volumeLiters,
      hop.form
    );

    return baseIbu * temperatureFactor;
  }

  private tinsethUtilization(
    timeMinutes: number,
    gravity: number
  ): number {
    const gravityFactor =
      1.65 *
      Math.pow(
        0.000125,
        gravity - 1
      );

    const timeFactor =
      (
        1 -
        Math.exp(
          -0.04 * timeMinutes
        )
      ) / 4.15;

    return gravityFactor * timeFactor;
  }

  private ragerUtilization(
    timeMinutes: number
  ): number {
    return (
      18.11 +
      13.86 *
      Math.tanh(
        (timeMinutes - 31.32) /
        18.27
      )
    ) / 100;
  }

  /**
   * Rager gravity adjustment factor for the IBU denominator.
   *
   * When boil gravity exceeds 1.050, utilisation drops linearly.
   * The factor is `0.00065 × (gravityUnits - 50)` and is used as:
   *
   *   IBU = (grams × AA% × utilisation × 10) / (volume × (1 + adjustment))
   */
  private ragerGravityAdjustment(
    gravity: number
  ): number {
    const gravityUnits = (gravity - 1) * 1000;

    if (gravityUnits <= 50) {
      return 0;
    }

    return (
      0.00065 *
      (gravityUnits - 50)
    );
  }

  /**
   * Hop-form efficiency factor used as a multiplier on utilisation.
   *
   *   - pellet: × 1.10 (empirical convention)
   *   - plug:   × 1.05
   *   - whole:  × 1.00 (baseline)
   */
  private getHopFormFactor(
    form: HopAddition['form']
  ): number {
    switch (form) {
      case 'pellet':
        return 1.10;
      case 'plug':
        return 1.05;
      case 'whole':
      default:
        return 1;
    }
  }

  /**
   * Empirical temperature factor for whirlpool hop additions.
   *
   * Based on the observation that isomerisation continues at whirlpool
   * temperatures but at reduced rates. Values are deliberately conservative.
   */
  private whirlpoolTemperatureFactor(
    temperatureC: number
  ): number {
    if (temperatureC >= 95) {
      return 0.50;
    }

    if (temperatureC >= 90) {
      return 0.35;
    }

    if (temperatureC >= 85) {
      return 0.20;
    }

    if (temperatureC >= 80) {
      return 0.10;
    }

    if (temperatureC >= 75) {
      return 0.05;
    }

    return 0;
  }
}

registerTool(IbuCalculatorTool);
