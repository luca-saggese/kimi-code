/**
 * Recipe validator — validate a beer recipe against BJCP style guidelines and best practices.
 *
 * Checks OG, FG, ABV, IBU, color, and ingredient balance. Flags issues like
 * excessive specialty malts, incoherent IBU/OG ratio, or out-of-style parameters.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const RecipeValidatorInputSchema = z.object({
  recipe_name: z.string().describe('Recipe name.'),
  beer_style: z.string().describe('BJCP style code or name (e.g. "21A", "American IPA").'),
  batch_size_liters: z.number().describe('Batch size in liters.'),
  og: z.number().describe('Original Gravity (e.g. 1.065).'),
  fg: z.number().describe('Final Gravity (e.g. 1.012).'),
  ibu: z.number().describe('Calculated IBU.'),
  ebc: z.number().optional().describe('Color in EBC (optional).'),
  srm: z.number().optional().describe('Color in SRM (optional).'),
  grain_bill: z
    .array(
      z.object({
        malt: z.string().describe('Malt name.'),
        kg: z.number().describe('Amount in kg.'),
        percent: z.number().optional().describe('Percentage of total grain bill.'),
      }),
    )
    .describe('Complete grain bill.'),
  hop_schedule: z
    .array(
      z.object({
        variety: z.string(),
        grams: z.number(),
        time_minutes: z.number(),
        use: z.enum(['boil', 'whirlpool', 'dry_hop', 'first_wort', 'mash']),
      }),
    )
    .describe('Hop schedule.'),
  yeast: z
    .object({
      strain: z.string().describe('Yeast strain (e.g. "WLP001", "US-05").'),
      attenuation_percent: z.number().optional().describe('Expected attenuation %.'),
    })
    .describe('Yeast information.'),
  mash_temp_c: z.number().optional().describe('Mash temperature in °C.'),
  fermentation_temp_c: z.number().optional().describe('Fermentation temperature in °C.'),
  water_profile: z
    .object({
      ca: z.number(),
      mg: z.number(),
      na: z.number(),
      cl: z.number(),
      so4: z.number(),
      hco3: z.number(),
    })
    .optional()
    .describe('Water profile if known.'),
});

export const RecipeValidatorOutputSchema = z.object({
  valid: z.boolean(),
  style_match: z.string(),
  issues: z.array(z.string()),
  warnings: z.array(z.string()),
  suggestions: z.array(z.string()),
  bjcp_compliance: z.string(),
});

export type RecipeValidatorInput = z.infer<typeof RecipeValidatorInputSchema>;
export type RecipeValidatorOutput = z.infer<typeof RecipeValidatorOutputSchema>;

// ─── BJCP Style Guidelines ────────────────────────────────────────────────────

interface BjcpStyle {
  code: string;
  name: string;
  category: string;
  og_min: number;
  og_max: number;
  fg_min: number;
  fg_max: number;
  abv_min: number;
  abv_max: number;
  ibu_min: number;
  ibu_max: number;
  ebc_min: number;
  ebc_max: number;
  notes: string;
}

const BJCP_STYLES: Record<string, BjcpStyle> = {
  '1A': { code: '1A', name: 'American Light Lager', category: 'American Lager', og_min: 1.028, og_max: 1.040, fg_min: 0.998, fg_max: 1.008, abv_min: 2.8, abv_max: 4.2, ibu_min: 8, ibu_max: 12, ebc_min: 4, ebc_max: 6, notes: 'Very light, crisp, refreshing' },
  '1B': { code: '1B', name: 'American Lager', category: 'American Lager', og_min: 1.040, og_max: 1.050, fg_min: 1.004, fg_max: 1.010, abv_min: 4.2, abv_max: 5.3, ibu_min: 8, ibu_max: 18, ebc_min: 4, ebc_max: 8, notes: 'Light, crisp, clean' },
  '1C': { code: '1C', name: 'Cream Ale', category: 'American Lager', og_min: 1.042, og_max: 1.055, fg_min: 1.006, fg_max: 1.012, abv_min: 4.2, abv_max: 5.6, ibu_min: 8, ibu_max: 20, ebc_min: 5, ebc_max: 10, notes: 'Smooth, easy-drinking' },
  '1D': { code: '1D', name: 'American Wheat Beer', category: 'American Lager', og_min: 1.040, og_max: 1.055, fg_min: 1.008, fg_max: 1.016, abv_min: 4.0, abv_max: 5.5, ibu_min: 15, ibu_max: 30, ebc_min: 6, ebc_max: 12, notes: 'Light, refreshing wheat' },
  '2A': { code: '2A', name: 'International Pale Lager', category: 'International Lager', og_min: 1.042, og_max: 1.050, fg_min: 1.008, fg_max: 1.012, abv_min: 4.5, abv_max: 6.0, ibu_min: 18, ibu_max: 25, ebc_min: 4, ebc_max: 10, notes: 'Clean, balanced lager' },
  '2B': { code: '2B', name: 'International Amber Lager', category: 'International Lager', og_min: 1.042, og_max: 1.055, fg_min: 1.008, fg_max: 1.016, abv_min: 4.5, abv_max: 6.0, ibu_min: 8, ibu_max: 25, ebc_min: 14, ebc_max: 25, notes: 'Amber, malt-forward' },
  '2C': { code: '2C', name: 'International Dark Lager', category: 'International Lager', og_min: 1.044, og_max: 1.056, fg_min: 1.008, fg_max: 1.016, abv_min: 4.2, abv_max: 6.0, ibu_min: 8, ibu_max: 20, ebc_min: 28, ebc_max: 50, notes: 'Dark, smooth' },
  '3A': { code: '3A', name: 'Czech Pale Lager', category: 'Czech Lager', og_min: 1.028, og_max: 1.044, fg_min: 1.008, fg_max: 1.014, abv_min: 3.0, abv_max: 4.1, ibu_min: 20, ibu_max: 35, ebc_min: 6, ebc_max: 12, notes: 'Sessionable, hoppy' },
  '3B': { code: '3B', name: 'Czech Premium Pale Lager', category: 'Czech Lager', og_min: 1.044, og_max: 1.060, fg_min: 1.013, fg_max: 1.017, abv_min: 4.2, abv_max: 5.8, ibu_min: 30, ibu_max: 45, ebc_min: 7, ebc_max: 14, notes: 'Pilsner Urquell style' },
  '3C': { code: '3C', name: 'Czech Amber Lager', category: 'Czech Lager', og_min: 1.044, og_max: 1.060, fg_min: 1.013, fg_max: 1.017, abv_min: 4.4, abv_max: 5.8, ibu_min: 20, ibu_max: 35, ebc_min: 20, ebc_max: 35, notes: 'Amber, malt-forward' },
  '3D': { code: '3D', name: 'Czech Dark Lager', category: 'Czech Lager', og_min: 1.044, og_max: 1.060, fg_min: 1.013, fg_max: 1.017, abv_min: 4.4, abv_max: 5.8, ibu_min: 18, ibu_max: 34, ebc_min: 35, ebc_max: 70, notes: 'Dark, rich' },
  '4A': { code: '4A', name: 'Munich Helles', category: 'Pale Malty European Lager', og_min: 1.044, og_max: 1.048, fg_min: 1.006, fg_max: 1.012, abv_min: 4.7, abv_max: 5.4, ibu_min: 16, ibu_max: 22, ebc_min: 6, ebc_max: 10, notes: 'Malt-forward, clean' },
  '4B': { code: '4B', name: 'Festbier', category: 'Pale Malty European Lager', og_min: 1.054, og_max: 1.057, fg_min: 1.010, fg_max: 1.012, abv_min: 5.8, abv_max: 6.3, ibu_min: 18, ibu_max: 25, ebc_min: 8, ebc_max: 16, notes: 'Oktoberfest style' },
  '4C': { code: '4C', name: 'Helles Bock', category: 'Pale Malty European Lager', og_min: 1.064, og_max: 1.072, fg_min: 1.011, fg_max: 1.018, abv_min: 6.3, abv_max: 7.4, ibu_min: 23, ibu_max: 35, ebc_min: 12, ebc_max: 20, notes: 'Strong pale lager' },
  '5A': { code: '5A', name: 'German Leichtbier', category: 'Pale Bitter European Lager', og_min: 1.026, og_max: 1.034, fg_min: 1.006, fg_max: 1.010, abv_min: 2.4, abv_max: 3.6, ibu_min: 15, ibu_max: 28, ebc_min: 4, ebc_max: 8, notes: 'Light, low alcohol' },
  '5B': { code: '5B', name: 'Kölsch', category: 'Pale Bitter European Lager', og_min: 1.044, og_max: 1.050, fg_min: 1.007, fg_max: 1.011, abv_min: 4.4, abv_max: 5.2, ibu_min: 18, ibu_max: 30, ebc_min: 7, ebc_max: 10, notes: 'Cologne style, crisp' },
  '5C': { code: '5C', name: 'German Helles Exportbier', category: 'Pale Bitter European Lager', og_min: 1.048, og_max: 1.056, fg_min: 1.010, fg_max: 1.015, abv_min: 4.8, abv_max: 6.0, ibu_min: 20, ibu_max: 30, ebc_min: 8, ebc_max: 14, notes: 'Dortmunder style' },
  '5D': { code: '5D', name: 'German Pils', category: 'Pale Bitter European Lager', og_min: 1.044, og_max: 1.050, fg_min: 1.008, fg_max: 1.013, abv_min: 4.4, abv_max: 5.2, ibu_min: 22, ibu_max: 40, ebc_min: 4, ebc_max: 8, notes: 'Crisp, bitter' },
  '6A': { code: '6A', name: 'Märzen', category: 'Amber Malty European Lager', og_min: 1.054, og_max: 1.060, fg_min: 1.010, fg_max: 1.014, abv_min: 5.8, abv_max: 6.3, ibu_min: 18, ibu_max: 24, ebc_min: 16, ebc_max: 30, notes: 'Oktoberfest, malt-forward' },
  '6B': { code: '6B', name: 'Rauchbier', category: 'Amber Malty European Lager', og_min: 1.050, og_max: 1.057, fg_min: 1.012, fg_max: 1.016, abv_min: 4.8, abv_max: 6.0, ibu_min: 20, ibu_max: 30, ebc_min: 25, ebc_max: 45, notes: 'Smoked, Bamberg style' },
  '6C': { code: '6C', name: 'Dunkles Bock', category: 'Amber Malty European Lager', og_min: 1.064, og_max: 1.072, fg_min: 1.013, fg_max: 1.019, abv_min: 6.3, abv_max: 7.2, ibu_min: 20, ibu_max: 27, ebc_min: 28, ebc_max: 45, notes: 'Strong dark lager' },
  '7A': { code: '7A', name: 'Vienna Lager', category: 'Amber Bitter European Lager', og_min: 1.048, og_max: 1.055, fg_min: 1.010, fg_max: 1.014, abv_min: 4.7, abv_max: 5.5, ibu_min: 18, ibu_max: 30, ebc_min: 18, ebc_max: 30, notes: 'Amber, toasty' },
  '7B': { code: '7B', name: 'Altbier', category: 'Amber Bitter European Lager', og_min: 1.044, og_max: 1.052, fg_min: 1.008, fg_max: 1.014, abv_min: 4.3, abv_max: 5.5, ibu_min: 25, ibu_max: 50, ebc_min: 22, ebc_max: 35, notes: 'Düsseldorf style, bitter' },
  '7C': { code: '7C', name: 'Kellerbier', category: 'Amber Bitter European Lager', og_min: 1.045, og_max: 1.052, fg_min: 1.008, fg_max: 1.014, abv_min: 4.7, abv_max: 5.5, ibu_min: 20, ibu_max: 35, ebc_min: 14, ebc_max: 30, notes: 'Unfiltered, cellar-aged' },
  '8A': { code: '8A', name: 'Munich Dunkel', category: 'Dark European Lager', og_min: 1.048, og_max: 1.056, fg_min: 1.010, fg_max: 1.016, abv_min: 4.5, abv_max: 5.6, ibu_min: 18, ibu_max: 28, ebc_min: 28, ebc_max: 45, notes: 'Dark, malty' },
  '8B': { code: '8B', name: 'Schwarzbier', category: 'Dark European Lager', og_min: 1.046, og_max: 1.052, fg_min: 1.010, fg_max: 1.016, abv_min: 4.4, abv_max: 5.4, ibu_min: 20, ibu_max: 30, ebc_min: 35, ebc_max: 60, notes: 'Black lager, dry' },
  '9A': { code: '9A', name: 'Doppelbock', category: 'Strong European Beer', og_min: 1.072, og_max: 1.112, fg_min: 1.016, fg_max: 1.024, abv_min: 7.0, abv_max: 10.0, ibu_min: 16, ibu_max: 26, ebc_min: 24, ebc_max: 45, notes: 'Strong, malty' },
  '9B': { code: '9B', name: 'Eisbock', category: 'Strong European Beer', og_min: 1.078, og_max: 1.120, fg_min: 1.020, fg_max: 1.035, abv_min: 9.0, abv_max: 14.0, ibu_min: 25, ibu_max: 35, ebc_min: 30, ebc_max: 60, notes: 'Freeze-distilled' },
  '9C': { code: '9C', name: 'Baltic Porter', category: 'Strong European Beer', og_min: 1.060, og_max: 1.090, fg_min: 1.016, fg_max: 1.024, abv_min: 6.5, abv_max: 9.5, ibu_min: 20, ibu_max: 40, ebc_min: 35, ebc_max: 60, notes: 'Strong, dark, smooth' },
  '10A': { code: '10A', name: 'Weissbier', category: 'German Wheat Beer', og_min: 1.044, og_max: 1.052, fg_min: 1.010, fg_max: 1.014, abv_min: 4.3, abv_max: 5.6, ibu_min: 8, ibu_max: 15, ebc_min: 4, ebc_max: 14, notes: 'Banana, clove' },
  '10B': { code: '10B', name: 'Dunkles Weissbier', category: 'German Wheat Beer', og_min: 1.044, og_max: 1.056, fg_min: 1.010, fg_max: 1.014, abv_min: 4.3, abv_max: 5.6, ibu_min: 10, ibu_max: 18, ebc_min: 28, ebc_max: 45, notes: 'Dark wheat' },
  '10C': { code: '10C', name: 'Weizenbock', category: 'German Wheat Beer', og_min: 1.064, og_max: 1.090, fg_min: 1.015, fg_max: 1.022, abv_min: 6.5, abv_max: 9.0, ibu_min: 15, ibu_max: 30, ebc_min: 12, ebc_max: 50, notes: 'Strong wheat' },
  '11A': { code: '11A', name: 'Ordinary Bitter', category: 'British Bitter', og_min: 1.030, og_max: 1.039, fg_min: 1.007, fg_max: 1.011, abv_min: 3.2, abv_max: 3.8, ibu_min: 25, ibu_max: 35, ebc_min: 15, ebc_max: 30, notes: 'Sessionable' },
  '11B': { code: '11B', name: 'Best Bitter', category: 'British Bitter', og_min: 1.040, og_max: 1.048, fg_min: 1.008, fg_max: 1.012, abv_min: 3.8, abv_max: 4.6, ibu_min: 25, ibu_max: 40, ebc_min: 15, ebc_max: 35, notes: 'Balanced bitter' },
  '11C': { code: '11C', name: 'Strong Bitter', category: 'British Bitter', og_min: 1.048, og_max: 1.060, fg_min: 1.010, fg_max: 1.016, abv_min: 4.6, abv_max: 6.2, ibu_min: 30, ibu_max: 50, ebc_min: 18, ebc_max: 40, notes: 'ESB style' },
  '12A': { code: '12A', name: 'British Golden Ale', category: 'Pale Commonwealth Beer', og_min: 1.038, og_max: 1.053, fg_min: 1.006, fg_max: 1.012, abv_min: 3.8, abv_max: 5.0, ibu_min: 20, ibu_max: 45, ebc_min: 4, ebc_max: 10, notes: 'Golden, hoppy' },
  '12B': { code: '12B', name: 'Australian Sparkling Ale', category: 'Pale Commonwealth Beer', og_min: 1.038, og_max: 1.050, fg_min: 1.004, fg_max: 1.006, abv_min: 4.5, abv_max: 6.0, ibu_min: 20, ibu_max: 35, ebc_min: 8, ebc_max: 14, notes: 'Sparkling, crisp' },
  '12C': { code: '12C', name: 'English IPA', category: 'Pale Commonwealth Beer', og_min: 1.050, og_max: 1.075, fg_min: 1.010, fg_max: 1.018, abv_min: 5.0, abv_max: 7.5, ibu_min: 40, ibu_max: 60, ebc_min: 12, ebc_max: 30, notes: 'Hoppy, balanced' },
  '13A': { code: '13A', name: 'Dark Mild', category: 'Brown British Beer', og_min: 1.030, og_max: 1.038, fg_min: 1.008, fg_max: 1.013, abv_min: 3.0, abv_max: 3.8, ibu_min: 10, ibu_max: 25, ebc_min: 25, ebc_max: 45, notes: 'Dark, sessionable' },
  '13B': { code: '13B', name: 'British Brown Ale', category: 'Brown British Beer', og_min: 1.040, og_max: 1.052, fg_min: 1.008, fg_max: 1.013, abv_min: 4.2, abv_max: 5.4, ibu_min: 20, ibu_max: 30, ebc_min: 25, ebc_max: 45, notes: 'Nutty, malty' },
  '13C': { code: '13C', name: 'English Porter', category: 'Brown British Beer', og_min: 1.040, og_max: 1.052, fg_min: 1.008, fg_max: 1.014, abv_min: 4.0, abv_max: 5.4, ibu_min: 18, ibu_max: 35, ebc_min: 40, ebc_max: 60, notes: 'London style' },
  '14A': { code: '14A', name: 'Scottish Light', category: 'Scottish Ale', og_min: 1.030, og_max: 1.035, fg_min: 1.010, fg_max: 1.013, abv_min: 2.5, abv_max: 3.2, ibu_min: 10, ibu_max: 20, ebc_min: 25, ebc_max: 45, notes: 'Light, sessionable' },
  '14B': { code: '14B', name: 'Scottish Heavy', category: 'Scottish Ale', og_min: 1.035, og_max: 1.040, fg_min: 1.010, fg_max: 1.015, abv_min: 3.2, abv_max: 3.9, ibu_min: 10, ibu_max: 20, ebc_min: 25, ebc_max: 45, notes: 'Malty, smooth' },
  '14C': { code: '14C', name: 'Scottish Export', category: 'Scottish Ale', og_min: 1.040, og_max: 1.060, fg_min: 1.010, fg_max: 1.016, abv_min: 3.9, abv_max: 6.0, ibu_min: 15, ibu_max: 30, ebc_min: 25, ebc_max: 45, notes: 'Strong, malty' },
  '15A': { code: '15A', name: 'Irish Red Ale', category: 'Irish Beer', og_min: 1.036, og_max: 1.046, fg_min: 1.010, fg_max: 1.014, abv_min: 3.8, abv_max: 5.0, ibu_min: 18, ibu_max: 28, ebc_min: 18, ebc_max: 30, notes: 'Red, smooth' },
  '15B': { code: '15B', name: 'Irish Stout', category: 'Irish Beer', og_min: 1.036, og_max: 1.044, fg_min: 1.007, fg_max: 1.011, abv_min: 4.0, abv_max: 4.5, ibu_min: 25, ibu_max: 45, ebc_min: 50, ebc_max: 80, notes: 'Dry, roasted' },
  '15C': { code: '15C', name: 'Irish Extra Stout', category: 'Irish Beer', og_min: 1.052, og_max: 1.062, fg_min: 1.010, fg_max: 1.014, abv_min: 5.5, abv_max: 6.5, ibu_min: 35, ibu_max: 50, ebc_min: 50, ebc_max: 80, notes: 'Strong stout' },
  '16A': { code: '16A', name: 'Sweet Stout', category: 'Dark British Beer', og_min: 1.044, og_max: 1.060, fg_min: 1.012, fg_max: 1.024, abv_min: 4.0, abv_max: 6.0, ibu_min: 20, ibu_max: 40, ebc_min: 60, ebc_max: 100, notes: 'Milk stout' },
  '16B': { code: '16B', name: 'Oatmeal Stout', category: 'Dark British Beer', og_min: 1.045, og_max: 1.065, fg_min: 1.010, fg_max: 1.018, abv_min: 4.2, abv_max: 5.9, ibu_min: 25, ibu_max: 40, ebc_min: 45, ebc_max: 80, notes: 'Smooth, silky' },
  '16C': { code: '16C', name: 'Tropical Stout', category: 'Dark British Beer', og_min: 1.056, og_max: 1.075, fg_min: 1.010, fg_max: 1.018, abv_min: 5.5, abv_max: 8.0, ibu_min: 30, ibu_max: 50, ebc_min: 60, ebc_max: 100, notes: 'Fruity, strong' },
  '16D': { code: '16D', name: 'Foreign Extra Stout', category: 'Dark British Beer', og_min: 1.056, og_max: 1.075, fg_min: 1.010, fg_max: 1.018, abv_min: 6.3, abv_max: 8.0, ibu_min: 50, ibu_max: 70, ebc_min: 60, ebc_max: 100, notes: 'Strong, hoppy stout' },
  '17A': { code: '17A', name: 'British Strong Ale', category: 'Strong British Ale', og_min: 1.055, og_max: 1.080, fg_min: 1.015, fg_max: 1.022, abv_min: 5.5, abv_max: 8.0, ibu_min: 30, ibu_max: 60, ebc_min: 16, ebc_max: 45, notes: 'Strong, complex' },
  '17B': { code: '17B', name: 'Old Ale', category: 'Strong British Ale', og_min: 1.055, og_max: 1.088, fg_min: 1.015, fg_max: 1.022, abv_min: 5.5, abv_max: 9.0, ibu_min: 30, ibu_max: 60, ebc_min: 20, ebc_max: 50, notes: 'Aged, complex' },
  '17C': { code: '17C', name: 'Wee Heavy', category: 'Strong British Ale', og_min: 1.070, og_max: 1.130, fg_min: 1.018, fg_max: 1.040, abv_min: 6.5, abv_max: 10.0, ibu_min: 17, ibu_max: 35, ebc_min: 28, ebc_max: 60, notes: 'Strong Scotch ale' },
  '17D': { code: '17D', name: 'English Barleywine', category: 'Strong British Ale', og_min: 1.080, og_max: 1.120, fg_min: 1.018, fg_max: 1.030, abv_min: 8.0, abv_max: 12.0, ibu_min: 35, ibu_max: 70, ebc_min: 16, ebc_max: 45, notes: 'Strong, aged' },
  '18A': { code: '18A', name: 'Blonde Ale', category: 'Pale American Ale', og_min: 1.038, og_max: 1.054, fg_min: 1.008, fg_max: 1.013, abv_min: 3.8, abv_max: 5.5, ibu_min: 15, ibu_max: 28, ebc_min: 6, ebc_max: 12, notes: 'Light, approachable' },
  '18B': { code: '18B', name: 'American Pale Ale', category: 'Pale American Ale', og_min: 1.045, og_max: 1.060, fg_min: 1.010, fg_max: 1.015, abv_min: 4.5, abv_max: 6.2, ibu_min: 30, ibu_max: 50, ebc_min: 10, ebc_max: 20, notes: 'Hoppy, balanced' },
  '19A': { code: '19A', name: 'American Amber Ale', category: 'Amber and Brown American Beer', og_min: 1.045, og_max: 1.060, fg_min: 1.010, fg_max: 1.015, abv_min: 4.5, abv_max: 6.2, ibu_min: 25, ibu_max: 40, ebc_min: 20, ebc_max: 35, notes: 'Amber, malty' },
  '19B': { code: '19B', name: 'California Common', category: 'Amber and Brown American Beer', og_min: 1.048, og_max: 1.054, fg_min: 1.011, fg_max: 1.014, abv_min: 4.5, abv_max: 5.5, ibu_min: 30, ibu_max: 45, ebc_min: 20, ebc_max: 35, notes: 'Steam beer' },
  '19C': { code: '19C', name: 'American Brown Ale', category: 'Amber and Brown American Beer', og_min: 1.045, og_max: 1.060, fg_min: 1.010, fg_max: 1.016, abv_min: 4.3, abv_max: 6.2, ibu_min: 20, ibu_max: 30, ebc_min: 35, ebc_max: 60, notes: 'Brown, hoppy' },
  '20A': { code: '20A', name: 'American Porter', category: 'American Porter and Stout', og_min: 1.050, og_max: 1.070, fg_min: 1.012, fg_max: 1.018, abv_min: 4.8, abv_max: 6.5, ibu_min: 25, ibu_max: 50, ebc_min: 40, ebc_max: 60, notes: 'Robust, hoppy' },
  '20B': { code: '20B', name: 'American Stout', category: 'American Porter and Stout', og_min: 1.050, og_max: 1.075, fg_min: 1.010, fg_max: 1.022, abv_min: 5.0, abv_max: 7.0, ibu_min: 35, ibu_max: 75, ebc_min: 50, ebc_max: 80, notes: 'Roasted, hoppy' },
  '20C': { code: '20C', name: 'Imperial Stout', category: 'American Porter and Stout', og_min: 1.075, og_max: 1.115, fg_min: 1.018, fg_max: 1.030, abv_min: 8.0, abv_max: 12.0, ibu_min: 50, ibu_max: 90, ebc_min: 60, ebc_max: 100, notes: 'Strong, complex' },
  '21A': { code: '21A', name: 'American IPA', category: 'IPA', og_min: 1.056, og_max: 1.070, fg_min: 1.008, fg_max: 1.014, abv_min: 5.5, abv_max: 7.5, ibu_min: 40, ibu_max: 70, ebc_min: 12, ebc_max: 28, notes: 'Hoppy, bitter' },
  '21B': { code: '21B', name: 'Specialty IPA', category: 'IPA', og_min: 1.050, og_max: 1.085, fg_min: 1.008, fg_max: 1.018, abv_min: 5.5, abv_max: 9.5, ibu_min: 40, ibu_max: 100, ebc_min: 10, ebc_max: 40, notes: 'Rye, white, black, etc.' },
  '21B1': { code: '21B1', name: 'New England IPA', category: 'IPA', og_min: 1.060, og_max: 1.085, fg_min: 1.010, fg_max: 1.020, abv_min: 6.0, abv_max: 9.0, ibu_min: 25, ibu_max: 60, ebc_min: 6, ebc_max: 16, notes: 'Hazy, juicy, low bitterness' },
  '21B2': { code: '21B2', name: 'Black IPA', category: 'IPA', og_min: 1.050, og_max: 1.085, fg_min: 1.010, fg_max: 1.018, abv_min: 5.5, abv_max: 9.0, ibu_min: 50, ibu_max: 90, ebc_min: 50, ebc_max: 80, notes: 'Dark, hoppy' },
  '21B3': { code: '21B3', name: 'Brown IPA', category: 'IPA', og_min: 1.056, og_max: 1.070, fg_min: 1.008, fg_max: 1.016, abv_min: 5.5, abv_max: 7.5, ibu_min: 40, ibu_max: 70, ebc_min: 25, ebc_max: 45, notes: 'Brown, hoppy' },
  '21B4': { code: '21B4', name: 'Red IPA', category: 'IPA', og_min: 1.056, og_max: 1.070, fg_min: 1.008, fg_max: 1.016, abv_min: 5.5, abv_max: 7.5, ibu_min: 40, ibu_max: 70, ebc_min: 22, ebc_max: 40, notes: 'Red, hoppy' },
  '21B5': { code: '21B5', name: 'Rye IPA', category: 'IPA', og_min: 1.056, og_max: 1.075, fg_min: 1.008, fg_max: 1.014, abv_min: 5.5, abv_max: 8.0, ibu_min: 50, ibu_max: 75, ebc_min: 12, ebc_max: 30, notes: 'Spicy, hoppy' },
  '21B6': { code: '21B6', name: 'White IPA', category: 'IPA', og_min: 1.056, og_max: 1.065, fg_min: 1.008, fg_max: 1.016, abv_min: 5.5, abv_max: 7.0, ibu_min: 40, ibu_max: 70, ebc_min: 8, ebc_max: 16, notes: 'Belgian-inspired, hoppy' },
  '21B7': { code: '21B7', name: 'Brut IPA', category: 'IPA', og_min: 1.046, og_max: 1.057, fg_min: 0.998, fg_max: 1.004, abv_min: 6.0, abv_max: 7.5, ibu_min: 20, ibu_max: 40, ebc_min: 4, ebc_max: 10, notes: 'Very dry, sparkling' },
  '22A': { code: '22A', name: 'Double IPA', category: 'Strong American Ale', og_min: 1.065, og_max: 1.085, fg_min: 1.010, fg_max: 1.020, abv_min: 7.5, abv_max: 10.0, ibu_min: 60, ibu_max: 120, ebc_min: 12, ebc_max: 30, notes: 'Very hoppy, strong' },
  '22B': { code: '22B', name: 'American Strong Ale', category: 'Strong American Ale', og_min: 1.062, og_max: 1.090, fg_min: 1.014, fg_max: 1.024, abv_min: 6.3, abv_max: 10.0, ibu_min: 50, ibu_max: 100, ebc_min: 14, ebc_max: 40, notes: 'Strong, hoppy' },
  '22C': { code: '22C', name: 'American Barleywine', category: 'Strong American Ale', og_min: 1.080, og_max: 1.120, fg_min: 1.016, fg_max: 1.030, abv_min: 8.0, abv_max: 12.0, ibu_min: 50, ibu_max: 100, ebc_min: 20, ebc_max: 45, notes: 'Strong, hoppy' },
  '22D': { code: '22D', name: 'Wheatwine', category: 'Strong American Ale', og_min: 1.080, og_max: 1.120, fg_min: 1.016, fg_max: 1.030, abv_min: 8.0, abv_max: 12.0, ibu_min: 30, ibu_max: 60, ebc_min: 16, ebc_max: 30, notes: 'Strong wheat' },
  '23A': { code: '23A', name: 'Berliner Weisse', category: 'European Sour Ale', og_min: 1.028, og_max: 1.032, fg_min: 1.003, fg_max: 1.006, abv_min: 2.8, abv_max: 3.8, ibu_min: 3, ibu_max: 8, ebc_min: 4, ebc_max: 6, notes: 'Sour, light, refreshing' },
  '23B': { code: '23B', name: 'Flanders Red Ale', category: 'European Sour Ale', og_min: 1.048, og_max: 1.057, fg_min: 1.002, fg_max: 1.012, abv_min: 4.6, abv_max: 6.5, ibu_min: 10, ibu_max: 25, ebc_min: 20, ebc_max: 35, notes: 'Sour, fruity' },
  '23C': { code: '23C', name: 'Oud Bruin', category: 'European Sour Ale', og_min: 1.040, og_max: 1.074, fg_min: 1.008, fg_max: 1.012, abv_min: 4.0, abv_max: 8.0, ibu_min: 20, ibu_max: 25, ebc_min: 30, ebc_max: 45, notes: 'Sour, malty' },
  '23D': { code: '23D', name: 'Lambic', category: 'European Sour Ale', og_min: 1.040, og_max: 1.054, fg_min: 1.001, fg_max: 1.010, abv_min: 5.0, abv_max: 6.5, ibu_min: 0, ibu_max: 10, ebc_min: 12, ebc_max: 25, notes: 'Wild, sour' },
  '23E': { code: '23E', name: 'Gueuze', category: 'European Sour Ale', og_min: 1.040, og_max: 1.060, fg_min: 1.000, fg_max: 1.006, abv_min: 5.0, abv_max: 8.0, ibu_min: 0, ibu_max: 10, ebc_min: 10, ebc_max: 20, notes: 'Blended lambic' },
  '23F': { code: '23F', name: 'Fruit Lambic', category: 'European Sour Ale', og_min: 1.040, og_max: 1.060, fg_min: 1.000, fg_max: 1.010, abv_min: 5.0, abv_max: 7.0, ibu_min: 0, ibu_max: 10, ebc_min: 15, ebc_max: 40, notes: 'Fruity, sour' },
  '23G': { code: '23G', name: 'Gose', category: 'European Sour Ale', og_min: 1.036, og_max: 1.056, fg_min: 1.006, fg_max: 1.010, abv_min: 4.2, abv_max: 4.8, ibu_min: 5, ibu_max: 12, ebc_min: 6, ebc_max: 12, notes: 'Salty, sour, coriander' },
  '24A': { code: '24A', name: 'Witbier', category: 'Belgian Ale', og_min: 1.044, og_max: 1.052, fg_min: 1.008, fg_max: 1.012, abv_min: 4.5, abv_max: 5.5, ibu_min: 10, ibu_max: 20, ebc_min: 4, ebc_max: 8, notes: 'Spiced, wheat' },
  '24B': { code: '24B', name: 'Belgian Pale Ale', category: 'Belgian Ale', og_min: 1.048, og_max: 1.054, fg_min: 1.010, fg_max: 1.014, abv_min: 4.8, abv_max: 5.5, ibu_min: 20, ibu_max: 30, ebc_min: 16, ebc_max: 30, notes: 'Fruity, balanced' },
  '24C': { code: '24C', name: 'Bière de Garde', category: 'Belgian Ale', og_min: 1.060, og_max: 1.080, fg_min: 1.008, fg_max: 1.016, abv_min: 6.0, abv_max: 8.5, ibu_min: 18, ibu_max: 28, ebc_min: 12, ebc_max: 40, notes: 'Strong, farmhouse' },
  '25A': { code: '25A', name: 'Belgian Blond Ale', category: 'Strong Belgian Ale', og_min: 1.062, og_max: 1.075, fg_min: 1.008, fg_max: 1.018, abv_min: 6.0, abv_max: 7.5, ibu_min: 15, ibu_max: 30, ebc_min: 8, ebc_max: 16, notes: 'Golden, strong' },
  '25B': { code: '25B', name: 'Saison', category: 'Strong Belgian Ale', og_min: 1.048, og_max: 1.065, fg_min: 1.002, fg_max: 1.008, abv_min: 5.0, abv_max: 7.0, ibu_min: 20, ibu_max: 35, ebc_min: 10, ebc_max: 20, notes: 'Dry, farmhouse, spicy' },
  '25C': { code: '25C', name: 'Belgian Golden Strong Ale', category: 'Strong Belgian Ale', og_min: 1.070, og_max: 1.095, fg_min: 1.005, fg_max: 1.016, abv_min: 7.5, abv_max: 10.5, ibu_min: 22, ibu_max: 35, ebc_min: 6, ebc_max: 12, notes: 'Duvel style' },
  '26A': { code: '26A', name: 'Trappist Single', category: 'Trappist Ale', og_min: 1.044, og_max: 1.054, fg_min: 1.004, fg_max: 1.010, abv_min: 4.8, abv_max: 6.0, ibu_min: 25, ibu_max: 45, ebc_min: 6, ebc_max: 12, notes: 'Single, sessionable' },
  '26B': { code: '26B', name: 'Belgian Dubbel', category: 'Trappist Ale', og_min: 1.062, og_max: 1.075, fg_min: 1.008, fg_max: 1.018, abv_min: 6.0, abv_max: 7.6, ibu_min: 15, ibu_max: 25, ebc_min: 20, ebc_max: 35, notes: 'Dark, malty, fruity' },
  '26C': { code: '26C', name: 'Belgian Tripel', category: 'Trappist Ale', og_min: 1.075, og_max: 1.085, fg_min: 1.008, fg_max: 1.014, abv_min: 7.5, abv_max: 9.5, ibu_min: 20, ibu_max: 40, ebc_min: 8, ebc_max: 14, notes: 'Strong, golden' },
  '26D': { code: '26D', name: 'Belgian Dark Strong Ale', category: 'Trappist Ale', og_min: 1.075, og_max: 1.110, fg_min: 1.010, fg_max: 1.024, abv_min: 8.0, abv_max: 12.0, ibu_min: 20, ibu_max: 35, ebc_min: 24, ebc_max: 45, notes: 'Rochefort, Westvleteren' },
  '27A': { code: '27A', name: 'Historical Beer', category: 'Historical Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.0, abv_max: 12.0, ibu_min: 0, ibu_max: 50, ebc_min: 4, ebc_max: 100, notes: 'Gose, Lichtenhainer, etc.' },
  '28A': { code: '28A', name: 'Brett Beer', category: 'American Wild Ale', og_min: 1.040, og_max: 1.080, fg_min: 1.000, fg_max: 1.016, abv_min: 4.0, abv_max: 8.0, ibu_min: 10, ibu_max: 40, ebc_min: 8, ebc_max: 40, notes: 'Funky, wild' },
  '28B': { code: '28B', name: 'Mixed-Fermentation Sour Beer', category: 'American Wild Ale', og_min: 1.040, og_max: 1.080, fg_min: 1.000, fg_max: 1.012, abv_min: 4.0, abv_max: 8.0, ibu_min: 5, ibu_max: 25, ebc_min: 6, ebc_max: 40, notes: 'Sour, complex' },
  '28C': { code: '28C', name: 'Wild Specialty Beer', category: 'American Wild Ale', og_min: 1.040, og_max: 1.090, fg_min: 1.000, fg_max: 1.016, abv_min: 4.0, abv_max: 10.0, ibu_min: 5, ibu_max: 40, ebc_min: 4, ebc_max: 60, notes: 'Experimental, wild' },
  '29A': { code: '29A', name: 'Fruit Beer', category: 'Fruit Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Fruit-forward' },
  '29B': { code: '29B', name: 'Fruit and Spice Beer', category: 'Fruit Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Fruit + spice' },
  '29C': { code: '29C', name: 'Specialty Fruit Beer', category: 'Fruit Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Specialty fruit' },
  '30A': { code: '30A', name: 'Spice, Herb, or Vegetable Beer', category: 'Spiced Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Spiced' },
  '30B': { code: '30B', name: 'Autumn Seasonal Beer', category: 'Spiced Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Pumpkin, harvest' },
  '30C': { code: '30C', name: 'Winter Seasonal Beer', category: 'Spiced Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Warming, spiced' },
  '31A': { code: '31A', name: 'Alternative Grain Beer', category: 'Alternative Fermentables Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Rice, corn, sorghum' },
  '31B': { code: '31B', name: 'Alternative Sugar Beer', category: 'Alternative Fermentables Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Honey, maple, agave' },
  '32A': { code: '32A', name: 'Classic Style Smoked Beer', category: 'Smoked Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Rauchbier base' },
  '32B': { code: '32B', name: 'Specialty Smoked Beer', category: 'Smoked Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Experimental smoked' },
  '33A': { code: '33A', name: 'Wood-Aged Beer', category: 'Wood-Aged Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Oak, barrel' },
  '33B': { code: '33B', name: 'Specialty Wood-Aged Beer', category: 'Wood-Aged Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Experimental wood' },
  '34A': { code: '34A', name: 'Clone Beer', category: 'Specialty Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Commercial clone' },
  '34B': { code: '34B', name: 'Mixed-Style Beer', category: 'Specialty Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Hybrid style' },
  '34C': { code: '34C', name: 'Experimental Beer', category: 'Specialty Beer', og_min: 1.030, og_max: 1.110, fg_min: 1.000, fg_max: 1.030, abv_min: 2.5, abv_max: 12.0, ibu_min: 5, ibu_max: 50, ebc_min: 4, ebc_max: 60, notes: 'Experimental' },
  '35A': { code: '35A', name: 'Kellerbier', category: 'Specialty Beer', og_min: 1.045, og_max: 1.052, fg_min: 1.008, fg_max: 1.014, abv_min: 4.7, abv_max: 5.5, ibu_min: 20, ibu_max: 35, ebc_min: 14, ebc_max: 30, notes: 'Unfiltered lager' },
  '36A': { code: '36A', name: 'Kentucky Common', category: 'Specialty Beer', og_min: 1.044, og_max: 1.055, fg_min: 1.010, fg_max: 1.018, abv_min: 4.0, abv_max: 5.5, ibu_min: 15, ibu_max: 30, ebc_min: 20, ebc_max: 40, notes: 'Historic American' },
  '37A': { code: '37A', name: 'Lichtenhainer', category: 'Specialty Beer', og_min: 1.032, og_max: 1.040, fg_min: 1.004, fg_max: 1.008, abv_min: 3.5, abv_max: 4.5, ibu_min: 5, ibu_max: 12, ebc_min: 30, ebc_max: 50, notes: 'Smoked sour' },
  '38A': { code: '38A', name: 'London Brown Ale', category: 'Specialty Beer', og_min: 1.033, og_max: 1.038, fg_min: 1.012, fg_max: 1.015, abv_min: 2.8, abv_max: 3.6, ibu_min: 15, ibu_max: 20, ebc_min: 45, ebc_max: 70, notes: 'Historic London' },
  '39A': { code: '39A', name: 'Piwo Grodziskie', category: 'Specialty Beer', og_min: 1.028, og_max: 1.032, fg_min: 1.006, fg_max: 1.010, abv_min: 2.5, abv_max: 3.3, ibu_min: 20, ibu_max: 35, ebc_min: 6, ebc_max: 12, notes: 'Polish smoked wheat' },
  '40A': { code: '40A', name: 'Pre-Prohibition Lager', category: 'Specialty Beer', og_min: 1.044, og_max: 1.060, fg_min: 1.010, fg_max: 1.015, abv_min: 4.5, abv_max: 6.0, ibu_min: 25, ibu_max: 40, ebc_min: 6, ebc_max: 14, notes: 'Historic American lager' },
  '41A': { code: '41A', name: 'Pre-Prohibition Porter', category: 'Specialty Beer', og_min: 1.046, og_max: 1.060, fg_min: 1.010, fg_max: 1.016, abv_min: 4.5, abv_max: 6.0, ibu_min: 20, ibu_max: 30, ebc_min: 40, ebc_max: 60, notes: 'Historic American porter' },
  '42A': { code: '42A', name: 'Roggenbier', category: 'Specialty Beer', og_min: 1.046, og_max: 1.056, fg_min: 1.010, fg_max: 1.014, abv_min: 4.5, abv_max: 6.0, ibu_min: 10, ibu_max: 20, ebc_min: 28, ebc_max: 50, notes: 'Rye beer' },
  '43A': { code: '43A', name: 'Sahti', category: 'Specialty Beer', og_min: 1.040, og_max: 1.070, fg_min: 1.010, fg_max: 1.020, abv_min: 7.0, abv_max: 11.0, ibu_min: 0, ibu_max: 15, ebc_min: 8, ebc_max: 25, notes: 'Finnish traditional' },
  '44A': { code: '44A', name: 'Gotlandsdricke', category: 'Specialty Beer', og_min: 1.040, og_max: 1.060, fg_min: 1.010, fg_max: 1.018, abv_min: 4.5, abv_max: 6.5, ibu_min: 5, ibu_max: 15, ebc_min: 10, ebc_max: 25, notes: 'Swedish traditional' },
  '45A': { code: '45A', name: 'Kodilo', category: 'Specialty Beer', og_min: 1.040, og_max: 1.060, fg_min: 1.010, fg_max: 1.018, abv_min: 4.5, abv_max: 6.5, ibu_min: 5, ibu_max: 15, ebc_min: 10, ebc_max: 25, notes: 'Finnish farmhouse' },
  '46A': { code: '46A', name: 'Vossaøl', category: 'Specialty Beer', og_min: 1.050, og_max: 1.080, fg_min: 1.010, fg_max: 1.020, abv_min: 6.0, abv_max: 9.0, ibu_min: 5, ibu_max: 15, ebc_min: 8, ebc_max: 20, notes: 'Norwegian farmhouse' },
  '47A': { code: '47A', name: 'Kveik Ale', category: 'Specialty Beer', og_min: 1.040, og_max: 1.070, fg_min: 1.008, fg_max: 1.016, abv_min: 4.5, abv_max: 7.0, ibu_min: 10, ibu_max: 30, ebc_min: 6, ebc_max: 20, notes: 'Norwegian farmhouse yeast' },
  '48A': { code: '48A', name: 'Braggot', category: 'Specialty Beer', og_min: 1.060, og_max: 1.120, fg_min: 1.010, fg_max: 1.030, abv_min: 6.0, abv_max: 12.0, ibu_min: 0, ibu_max: 30, ebc_min: 8, ebc_max: 30, notes: 'Mead + beer hybrid' },
  '49A': { code: '49A', name: 'Malt Liquor', category: 'Specialty Beer', og_min: 1.050, og_max: 1.060, fg_min: 1.004, fg_max: 1.010, abv_min: 6.0, abv_max: 8.0, ibu_min: 10, ibu_max: 20, ebc_min: 4, ebc_max: 10, notes: 'High gravity lager' },
  '50A': { code: '50A', name: 'Ice Beer', category: 'Specialty Beer', og_min: 1.060, og_max: 1.080, fg_min: 1.010, fg_max: 1.020, abv_min: 8.0, abv_max: 12.0, ibu_min: 15, ibu_max: 30, ebc_min: 8, ebc_max: 20, notes: 'Freeze-distilled' },
};

// ─── Tool implementation ─────────────────────────────────────────────────────

export class RecipeValidatorTool implements BuiltinTool<RecipeValidatorInput> {
  readonly name = 'recipe_validator' as const;
  readonly description =
    'Validate a beer recipe against BJCP style guidelines and best practices. Checks OG, FG, ABV, IBU, color, ingredient balance, and flags issues like excessive specialty malts, incoherent ratios, or out-of-style parameters.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RecipeValidatorInputSchema);

  resolveExecution(args: RecipeValidatorInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Validate recipe: ${args.recipe_name}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: RecipeValidatorInput): Promise<ExecutableToolResult> {
    try {
      const issues: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // ─── Find BJCP style ──────────────────────────────────────────────────
      const style = this.findStyle(args.beer_style);
      let bjcpCompliance = 'N/A — stile non trovato nel database BJCP';

      if (style !== undefined) {
        // ─── Check OG ───────────────────────────────────────────────────────
        if (args.og < style.og_min || args.og > style.og_max) {
          issues.push(
            `OG ${args.og.toFixed(3)} fuori range per ${style.code} ${style.name} (${style.og_min.toFixed(3)}–${style.og_max.toFixed(3)})`,
          );
        }

        // ─── Check FG ───────────────────────────────────────────────────────
        if (args.fg < style.fg_min || args.fg > style.fg_max) {
          warnings.push(
            `FG ${args.fg.toFixed(3)} fuori range per ${style.code} ${style.name} (${style.fg_min.toFixed(3)}–${style.fg_max.toFixed(3)})`,
          );
        }

        // ─── Check IBU ──────────────────────────────────────────────────────
        if (args.ibu < style.ibu_min || args.ibu > style.ibu_max) {
          issues.push(
            `IBU ${args.ibu.toFixed(0)} fuori range per ${style.code} ${style.name} (${style.ibu_min}–${style.ibu_max})`,
          );
        }

        // ─── Check ABV ──────────────────────────────────────────────────────
        const abv = (args.og - args.fg) * 131.25;
        if (abv < style.abv_min || abv > style.abv_max) {
          issues.push(
            `ABV ${abv.toFixed(1)}% fuori range per ${style.code} ${style.name} (${style.abv_min}–${style.abv_max}%)`,
          );
        }

        // ─── Check color ────────────────────────────────────────────────────
        if (args.ebc !== undefined) {
          if (args.ebc < style.ebc_min || args.ebc > style.ebc_max) {
            warnings.push(
              `Colore ${args.ebc.toFixed(0)} EBC fuori range per ${style.code} ${style.name} (${style.ebc_min}–${style.ebc_max})`,
            );
          }
        }

        bjcpCompliance = `Stile: ${style.code} — ${style.name} (${style.category}). ${style.notes}.`;
      }

      // ─── IBU/OG ratio ─────────────────────────────────────────────────────
      const ogPoints = (args.og - 1) * 1000;
      const ibuRatio = args.ibu / ogPoints;
      if (ibuRatio < 0.2) {
        issues.push('Rapporto IBU/OG molto basso — birra molto sbilanciata verso il malto.');
      } else if (ibuRatio < 0.3 && args.ibu < 15) {
        warnings.push('Rapporto IBU/OG basso — potrebbe essere troppo dolce.');
      } else if (ibuRatio > 1.5) {
        issues.push('Rapporto IBU/OG molto alto — amaro eccessivo rispetto al corpo.');
      } else if (ibuRatio > 1.0) {
        warnings.push('Rapporto IBU/OG alto — verifica che sia intenzionale per lo stile.');
      }

      // ─── Grain bill analysis ──────────────────────────────────────────────
      const totalGrainKg = args.grain_bill.reduce((sum: number, g: { malt: string; kg: number; percent?: number }) => sum + g.kg, 0);
      if (totalGrainKg <= 0) {
        issues.push('Grain bill vuota — aggiungi almeno un malto base.');
      }

      let specialtyPercent = 0;
      let baseMaltPercent = 0;
      for (const grain of args.grain_bill) {
        const percent = grain.percent ?? (grain.kg / totalGrainKg) * 100;
        const maltName = grain.malt.toLowerCase();

        // Base malts
        if (maltName.includes('pilsner') || maltName.includes('pale') || maltName.includes('maris otter') || maltName.includes('munich') || maltName.includes('vienna') || maltName.includes('wheat') || maltName.includes('base')) {
          baseMaltPercent += percent;
        }

        // Specialty malts
        if (maltName.includes('crystal') || maltName.includes('caramel') || maltName.includes('chocolate') || maltName.includes('black') || maltName.includes('roast') || maltName.includes('special')) {
          specialtyPercent += percent;
        }

        // Flag excessive specialty malts
        if (percent > 20 && !maltName.includes('base') && !maltName.includes('pilsner') && !maltName.includes('pale')) {
          warnings.push(`Malto "${grain.malt}" al ${percent.toFixed(0)}% — percentuale molto alta per un malto non base.`);
        }
      }

      if (specialtyPercent > 25) {
        issues.push(`Malti speciali al ${specialtyPercent.toFixed(0)}% — rischio dolcezza, astringenza o pesantezza eccessiva.`);
      } else if (specialtyPercent > 15) {
        warnings.push(`Malti speciali al ${specialtyPercent.toFixed(0)}% — considera di ridurre per migliore equilibrio.`);
      }

      if (baseMaltPercent < 60 && totalGrainKg > 0) {
        warnings.push(`Malto base al ${baseMaltPercent.toFixed(0)}% — bassa percentuale, rischio di corpo insufficiente.`);
      }

      // ─── Hop schedule analysis ────────────────────────────────────────────
      type HopEntry = { variety: string; grams: number; time_minutes: number; use: string };
      const boilHops = args.hop_schedule.filter((h: HopEntry) => h.use === 'boil' || h.use === 'first_wort');
      const dryHops = args.hop_schedule.filter((h: HopEntry) => h.use === 'dry_hop');
      const whirlpoolHops = args.hop_schedule.filter((h: HopEntry) => h.use === 'whirlpool');

      if (boilHops.length === 0 && dryHops.length === 0) {
        issues.push('Nessuna aggiunta di luppolo — la birra avrà 0 IBU e nessun aroma luppolato.');
      }

      if (boilHops.length === 0 && dryHops.length > 0) {
        warnings.push('Solo dry hop — 0 IBU, la birra sarà molto dolce e sbilanciata.');
      }

      const dryHopGrams = dryHops.reduce((sum: number, h: HopEntry) => sum + h.grams, 0);
      if (dryHopGrams > 20 * args.batch_size_liters) {
        warnings.push(`Dry hop molto alto (${dryHopGrams}g in ${args.batch_size_liters}L) — rischio di astringenza vegetale e ossidazione.`);
      }

      // ─── Yeast analysis ───────────────────────────────────────────────────
      if (args.yeast.attenuation_percent !== undefined) {
        const expectedFg = args.og - (args.og - 1) * (args.yeast.attenuation_percent / 100);
        if (Math.abs(expectedFg - args.fg) > 0.004) {
          warnings.push(`FG ${args.fg.toFixed(3)} non coerente con attenuazione attesa ${args.yeast.attenuation_percent}% (FG attesa: ${expectedFg.toFixed(3)}).`);
        }
      }

      // ─── Mash temperature ─────────────────────────────────────────────────
      if (args.mash_temp_c !== undefined) {
        if (args.mash_temp_c < 60) {
          issues.push('Temperatura mash sotto 60°C — rischio di conversione incompleta.');
        } else if (args.mash_temp_c > 72) {
          warnings.push('Temperatura mash sopra 72°C — rischio di attenuazione bassa e corpo eccessivo.');
        }
      }

      // ─── Fermentation temperature ─────────────────────────────────────────
      if (args.fermentation_temp_c !== undefined) {
        const yeastName = args.yeast.strain.toLowerCase();
        if (yeastName.includes('lager') || yeastName.includes('w-34') || yeastName.includes('saflager')) {
          if (args.fermentation_temp_c > 15) {
            issues.push(`Temperatura fermentazione ${args.fermentation_temp_c}°C troppo alta per lievito lager — rischio di esteri indesiderati.`);
          }
        } else if (yeastName.includes('kveik')) {
          if (args.fermentation_temp_c < 20) {
            warnings.push(`Temperatura ${args.fermentation_temp_c}°C bassa per kveik — ottimale 25-40°C.`);
          }
        } else {
          if (args.fermentation_temp_c < 15) {
            warnings.push(`Temperatura ${args.fermentation_temp_c}°C bassa per lievito ale — rischio di fermentazione lenta.`);
          } else if (args.fermentation_temp_c > 24) {
            warnings.push(`Temperatura ${args.fermentation_temp_c}°C alta per lievito ale — rischio di esteri e fusel.`);
          }
        }
      }

      // ─── Water profile ────────────────────────────────────────────────────
      if (args.water_profile !== undefined) {
        const wp = args.water_profile;
        const sulfateChlorideRatio = wp.so4 / (wp.cl + 1);
        if (sulfateChlorideRatio > 5) {
          warnings.push(`Rapporto SO4:Cl molto alto (${sulfateChlorideRatio.toFixed(1)}) — rischio di amaro aspro.`);
        } else if (sulfateChlorideRatio < 0.5) {
          warnings.push(`Rapporto SO4:Cl molto basso (${sulfateChlorideRatio.toFixed(1)}) — rischio di amaro morbido e poco definito.`);
        }
      }

      // ─── Summary ──────────────────────────────────────────────────────────
      const isValid = issues.length === 0;

      return Promise.resolve({
        output: [
          `**Validazione ricetta: ${args.recipe_name}**`,
          '',
          bjcpCompliance,
          '',
          isValid ? '✅ Ricetta valida — nessun errore critico.' : '❌ Errori critici trovati:',
          ...issues.map((i) => `  ❌ ${i}`),
          ...(warnings.length > 0 ? ['', '⚠️ Avvisi:', ...warnings.map((w) => `  ⚠️ ${w}`)] : []),
          ...(suggestions.length > 0 ? ['', '💡 Suggerimenti:', ...suggestions.map((s) => `  💡 ${s}`)] : []),
          '',
          `Rapporto IBU/OG: ${ibuRatio.toFixed(2)} (${ibuRatio < 0.3 ? 'maltata' : ibuRatio < 0.8 ? 'bilanciata' : ibuRatio < 1.2 ? 'amara' : 'molto amara'})`,
          `Malti speciali: ${specialtyPercent.toFixed(1)}% | Malto base: ${baseMaltPercent.toFixed(1)}%`,
        ].join('\n'),
      });
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private findStyle(query: string): BjcpStyle | undefined {
    // Try exact code match
    if (BJCP_STYLES[query] !== undefined) return BJCP_STYLES[query];

    // Try code without letter (e.g., "21" → "21A")
    for (const [code, style] of Object.entries(BJCP_STYLES)) {
      if (code.startsWith(query)) return style;
    }

    // Try name match (case-insensitive, partial)
    const lowerQuery = query.toLowerCase();
    for (const style of Object.values(BJCP_STYLES)) {
      if (style.name.toLowerCase().includes(lowerQuery)) return style;
    }

    return undefined;
  }
}
