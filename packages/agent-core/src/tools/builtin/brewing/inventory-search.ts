/**
 * Inventory search — search a virtual inventory of brewing ingredients.
 *
 * Provides a searchable database of malts, hops, and yeasts with availability,
 * substitutes, and technical specifications. Simulates a homebrew shop inventory.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const InventorySearchInputSchema = z.object({
  query: z.string().describe('Search query (ingredient name, type, or characteristic).'),
  category: z
    .enum(['malt', 'hop', 'yeast', 'all'])
    .default('all')
    .describe('Ingredient category to search (default: all).'),
  include_unavailable: z
    .boolean()
    .default(false)
    .describe('Include out-of-stock items in results (default: false).'),
});

export const InventorySearchOutputSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      available: z.boolean(),
      specs: z.record(z.string(), z.string()),
      substitutes: z.array(z.string()).optional(),
    }),
  ),
  count: z.number(),
});

export type InventorySearchInput = z.infer<typeof InventorySearchInputSchema>;
export type InventorySearchOutput = z.infer<typeof InventorySearchOutputSchema>;

// ─── Inventory database ───────────────────────────────────────────────────────

interface InventoryItem {
  name: string;
  category: 'malt' | 'hop' | 'yeast';
  available: boolean;
  specs: Record<string, string>;
  substitutes?: string[];
}

const INVENTORY: InventoryItem[] = [
  // ─── Base Malts ────────────────────────────────────────────────────────────
  { name: 'Pilsner Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '3-4', origin: 'Germany', usage: 'Up to 100%' }, substitutes: ['Pale Ale Malt', 'Vienna Malt'] },
  { name: 'Pale Ale Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Base', ebc: '5-7', origin: 'UK', usage: 'Up to 100%' }, substitutes: ['Maris Otter', 'Pilsner Malt'] },
  { name: 'Maris Otter (Crisp)', category: 'malt', available: true, specs: { type: 'Base', ebc: '4-6', origin: 'UK', usage: 'Up to 100%' }, substitutes: ['Pale Ale Malt', 'Golden Promise'] },
  { name: 'Vienna Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '6-9', origin: 'Germany', usage: 'Up to 100%' }, substitutes: ['Munich Light', 'Pale Ale Malt'] },
  { name: 'Munich Malt Light (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '15-25', origin: 'Germany', usage: 'Up to 100%' }, substitutes: ['Vienna Malt', 'Munich Dark'] },
  { name: 'Munich Malt Dark (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '40-60', origin: 'Germany', usage: 'Up to 50%' }, substitutes: ['Munich Light', 'Aromatic Malt'] },
  { name: 'Wheat Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '3-5', origin: 'Germany', usage: 'Up to 70%' }, substitutes: ['Pale Wheat Malt', 'Flaked Wheat'] },
  { name: 'Rye Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Base', ebc: '4-10', origin: 'Germany', usage: 'Up to 60%' }, substitutes: ['Flaked Rye', 'Wheat Malt'] },
  { name: 'Golden Promise (Simpsons)', category: 'malt', available: false, specs: { type: 'Base', ebc: '4-6', origin: 'UK', usage: 'Up to 100%' }, substitutes: ['Maris Otter', 'Pale Ale Malt'] },
  { name: 'Floor-Malted Bohemian Pilsner', category: 'malt', available: false, specs: { type: 'Base', ebc: '3-4', origin: 'Czech Republic', usage: 'Up to 100%' }, substitutes: ['Pilsner Malt', 'Pale Ale Malt'] },
  // ─── Crystal/Caramel Malts ─────────────────────────────────────────────────
  { name: 'CaraPils (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '3-5', origin: 'Germany', usage: 'Up to 10%' }, substitutes: ['Dextrin Malt', 'Flaked Barley'] },
  { name: 'CaraHell (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '20-30', origin: 'Germany', usage: 'Up to 15%' }, substitutes: ['Crystal 10L', 'CaraAmber'] },
  { name: 'CaraAmber (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '60-80', origin: 'Germany', usage: 'Up to 15%' }, substitutes: ['Crystal 30L', 'CaraRed'] },
  { name: 'CaraRed (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '40-60', origin: 'Germany', usage: 'Up to 15%' }, substitutes: ['Crystal 40L', 'CaraAroma'] },
  { name: 'CaraMunich I (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '80-100', origin: 'Germany', usage: 'Up to 15%' }, substitutes: ['Crystal 60L', 'CaraMunich II'] },
  { name: 'CaraMunich II (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '100-120', origin: 'Germany', usage: 'Up to 10%' }, substitutes: ['Crystal 80L', 'CaraMunich III'] },
  { name: 'CaraMunich III (Weyermann)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '120-140', origin: 'Germany', usage: 'Up to 10%' }, substitutes: ['Crystal 120L', 'Special B'] },
  { name: 'Crystal 10L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '20', origin: 'USA', usage: 'Up to 15%' }, substitutes: ['CaraHell', 'CaraPils'] },
  { name: 'Crystal 20L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '40', origin: 'USA', usage: 'Up to 15%' }, substitutes: ['CaraRed', 'Crystal 10L'] },
  { name: 'Crystal 40L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '80', origin: 'USA', usage: 'Up to 15%' }, substitutes: ['CaraAmber', 'Crystal 60L'] },
  { name: 'Crystal 60L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '120', origin: 'USA', usage: 'Up to 10%' }, substitutes: ['CaraMunich I', 'Crystal 80L'] },
  { name: 'Crystal 80L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '160', origin: 'USA', usage: 'Up to 10%' }, substitutes: ['CaraMunich II', 'Crystal 120L'] },
  { name: 'Crystal 120L (Briess)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '240', origin: 'USA', usage: 'Up to 5%' }, substitutes: ['CaraMunich III', 'Special B'] },
  { name: 'Special B (Dingemans)', category: 'malt', available: true, specs: { type: 'Crystal', ebc: '280-350', origin: 'Belgium', usage: 'Up to 5%' }, substitutes: ['Crystal 120L', 'Chocolate Malt'] },
  // ─── Roasted Malts ─────────────────────────────────────────────────────────
  { name: 'Chocolate Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '900-1100', origin: 'UK', usage: 'Up to 10%' }, substitutes: ['Pale Chocolate', 'Black Patent'] },
  { name: 'Pale Chocolate Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '500-600', origin: 'UK', usage: 'Up to 10%' }, substitutes: ['Chocolate Malt', 'Brown Malt'] },
  { name: 'Black Patent Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '1300-1500', origin: 'UK', usage: 'Up to 5%' }, substitutes: ['Roasted Barley', 'Chocolate Malt'] },
  { name: 'Roasted Barley (Briess)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '600-800', origin: 'USA', usage: 'Up to 5%' }, substitutes: ['Black Patent', 'Chocolate Malt'] },
  { name: 'Carafa I (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '800-1000', origin: 'Germany', usage: 'Up to 5%' }, substitutes: ['Chocolate Malt', 'Black Patent'] },
  { name: 'Carafa II (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '1100-1200', origin: 'Germany', usage: 'Up to 3%' }, substitutes: ['Black Patent', 'Roasted Barley'] },
  { name: 'Carafa III (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '1300-1500', origin: 'Germany', usage: 'Up to 2%' }, substitutes: ['Black Patent', 'Roasted Barley'] },
  { name: 'Carafa Special I (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '800-1000', origin: 'Germany', usage: 'Up to 5%' }, substitutes: ['Chocolate Malt (dehusked)', 'Black Patent (dehusked)'] },
  { name: 'Carafa Special II (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '1100-1200', origin: 'Germany', usage: 'Up to 3%' }, substitutes: ['Black Patent (dehusked)', 'Roasted Barley (dehusked)'] },
  { name: 'Carafa Special III (Weyermann)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '1300-1500', origin: 'Germany', usage: 'Up to 2%' }, substitutes: ['Black Patent (dehusked)', 'Roasted Barley (dehusked)'] },
  { name: 'Brown Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '120-150', origin: 'UK', usage: 'Up to 10%' }, substitutes: ['Amber Malt', 'Pale Chocolate'] },
  { name: 'Amber Malt (Crisp)', category: 'malt', available: true, specs: { type: 'Roasted', ebc: '50-80', origin: 'UK', usage: 'Up to 20%' }, substitutes: ['Brown Malt', 'Aromatic Malt'] },
  // ─── Flaked / Adjunct ──────────────────────────────────────────────────────
  { name: 'Flaked Barley', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '3', origin: 'Various', usage: 'Up to 20%' }, substitutes: ['Flaked Oats', 'Flaked Wheat'] },
  { name: 'Flaked Oats', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '2', origin: 'Various', usage: 'Up to 30%' }, substitutes: ['Oat Malt', 'Flaked Barley'] },
  { name: 'Flaked Wheat', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '2', origin: 'Various', usage: 'Up to 40%' }, substitutes: ['Wheat Malt', 'Flaked Barley'] },
  { name: 'Flaked Corn (Maize)', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '1', origin: 'Various', usage: 'Up to 40%' }, substitutes: ['Corn Grits', 'Rice'] },
  { name: 'Flaked Rice', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '1', origin: 'Various', usage: 'Up to 40%' }, substitutes: ['Rice Hulls', 'Corn'] },
  { name: 'Flaked Rye', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '3', origin: 'Various', usage: 'Up to 20%' }, substitutes: ['Rye Malt', 'Flaked Wheat'] },
  { name: 'Torrified Wheat', category: 'malt', available: true, specs: { type: 'Adjunct', ebc: '2', origin: 'UK', usage: 'Up to 40%' }, substitutes: ['Flaked Wheat', 'Wheat Malt'] },
  { name: 'Acidulated Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Specialty', ebc: '3-6', origin: 'Germany', usage: 'Up to 10%' }, substitutes: ['Lactic Acid', 'Phosphoric Acid'] },
  { name: 'Smoked Malt (Weyermann)', category: 'malt', available: true, specs: { type: 'Specialty', ebc: '4-8', origin: 'Germany', usage: 'Up to 100%' }, substitutes: ['Rauchmalz', 'Peated Malt'] },
  { name: 'Peated Malt (Simpsons)', category: 'malt', available: false, specs: { type: 'Specialty', ebc: '3-5', origin: 'UK', usage: 'Up to 5%' }, substitutes: ['Smoked Malt', 'Rauchmalz'] },
  // ─── Hops ──────────────────────────────────────────────────────────────────
  { name: 'Citra (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '11-13%', origin: 'USA', characteristics: 'Tropical, citrus, grapefruit' }, substitutes: ['Mosaic', 'Galaxy'] },
  { name: 'Mosaic (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '11-14%', origin: 'USA', characteristics: 'Blueberry, tropical, earthy' }, substitutes: ['Citra', 'Simcoe'] },
  { name: 'Simcoe (USA)', category: 'hop', available: true, specs: { type: 'Dual', aa: '12-14%', origin: 'USA', characteristics: 'Pine, citrus, passionfruit' }, substitutes: ['Citra', 'Chinook'] },
  { name: 'Cascade (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '5-7%', origin: 'USA', characteristics: 'Grapefruit, floral, spicy' }, substitutes: ['Centennial', 'Amarillo'] },
  { name: 'Centennial (USA)', category: 'hop', available: true, specs: { type: 'Dual', aa: '9-11%', origin: 'USA', characteristics: 'Floral, citrus, pine' }, substitutes: ['Cascade', 'Chinook'] },
  { name: 'Chinook (USA)', category: 'hop', available: true, specs: { type: 'Dual', aa: '12-14%', origin: 'USA', characteristics: 'Pine, spice, grapefruit' }, substitutes: ['Simcoe', 'Columbus'] },
  { name: 'Columbus (USA)', category: 'hop', available: true, specs: { type: 'Bittering', aa: '14-16%', origin: 'USA', characteristics: 'Dank, earthy, citrus' }, substitutes: ['Chinook', 'Warrior'] },
  { name: 'Warrior (USA)', category: 'hop', available: true, specs: { type: 'Bittering', aa: '15-17%', origin: 'USA', characteristics: 'Mild, clean bittering' }, substitutes: ['Columbus', 'Magnum'] },
  { name: 'Magnum (Germany)', category: 'hop', available: true, specs: { type: 'Bittering', aa: '12-14%', origin: 'Germany', characteristics: 'Clean, smooth bittering' }, substitutes: ['Warrior', 'Herkules'] },
  { name: 'Herkules (Germany)', category: 'hop', available: true, specs: { type: 'Bittering', aa: '15-17%', origin: 'Germany', characteristics: 'Strong, clean bittering' }, substitutes: ['Magnum', 'Polaris'] },
  { name: 'Polaris (Germany)', category: 'hop', available: true, specs: { type: 'Bittering', aa: '18-23%', origin: 'Germany', characteristics: 'Very strong, minty' }, substitutes: ['Herkules', 'Magnum'] },
  { name: 'Hallertau Mittelfrüh (Germany)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '3-5%', origin: 'Germany', characteristics: 'Floral, spicy, noble' }, substitutes: ['Hallertau Hersbrucker', 'Saaz'] },
  { name: 'Hallertau Hersbrucker (Germany)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '3-5%', origin: 'Germany', characteristics: 'Floral, earthy, noble' }, substitutes: ['Hallertau Mittelfrüh', 'Tettnang'] },
  { name: 'Tettnang (Germany)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '4-5%', origin: 'Germany', characteristics: 'Spicy, floral, noble' }, substitutes: ['Saaz', 'Hallertau'] },
  { name: 'Saaz (Czech)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '3-4%', origin: 'Czech Republic', characteristics: 'Spicy, earthy, noble' }, substitutes: ['Tettnang', 'Hallertau'] },
  { name: 'Fuggles (UK)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '4-5%', origin: 'UK', characteristics: 'Earthy, woody, mild' }, substitutes: ['East Kent Goldings', 'Willamette'] },
  { name: 'East Kent Goldings (UK)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '5-6%', origin: 'UK', characteristics: 'Floral, honey, earthy' }, substitutes: ['Fuggles', 'Golding'] },
  { name: 'Willamette (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '5-6%', origin: 'USA', characteristics: 'Mild, floral, earthy' }, substitutes: ['Fuggles', 'East Kent Goldings'] },
  { name: 'Amarillo (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '8-10%', origin: 'USA', characteristics: 'Orange, floral, citrus' }, substitutes: ['Cascade', 'Centennial'] },
  { name: 'Galaxy (Australia)', category: 'hop', available: false, specs: { type: 'Aroma', aa: '13-15%', origin: 'Australia', characteristics: 'Passionfruit, peach, citrus' }, substitutes: ['Citra', 'Mosaic'] },
  { name: 'Nelson Sauvin (New Zealand)', category: 'hop', available: false, specs: { type: 'Aroma', aa: '11-13%', origin: 'New Zealand', characteristics: 'White wine, gooseberry, grape' }, substitutes: ['Sauvin', 'Motueka'] },
  { name: 'Motueka (New Zealand)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '6-8%', origin: 'New Zealand', characteristics: 'Lime, lemon, tropical' }, substitutes: ['Nelson Sauvin', 'Saaz'] },
  { name: 'El Dorado (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '14-16%', origin: 'USA', characteristics: 'Tropical, watermelon, stone fruit' }, substitutes: ['Citra', 'Mosaic'] },
  { name: 'Idaho 7 (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '12-14%', origin: 'USA', characteristics: 'Pine, tropical, black tea' }, substitutes: ['Simcoe', 'Chinook'] },
  { name: 'Sabro (USA)', category: 'hop', available: false, specs: { type: 'Aroma', aa: '12-16%', origin: 'USA', characteristics: 'Coconut, tropical, cedar' }, substitutes: ['El Dorado', 'Idaho 7'] },
  { name: 'Strata (USA)', category: 'hop', available: true, specs: { type: 'Aroma', aa: '11-13%', origin: 'USA', characteristics: 'Passionfruit, grapefruit, dank' }, substitutes: ['Citra', 'Mosaic'] },
  { name: 'HBC 586 (USA)', category: 'hop', available: false, specs: { type: 'Aroma', aa: '10-12%', origin: 'USA', characteristics: 'Mango, lychee, tropical' }, substitutes: ['Citra', 'Galaxy'] },
  // ─── Yeast ─────────────────────────────────────────────────────────────────
  { name: 'SafAle US-05', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Dry', attenuation: '78-82%', temp_range: '15-24°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'Wyeast 1056'] },
  { name: 'SafAle S-04', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Dry', attenuation: '72-76%', temp_range: '15-24°C', flocculation: 'High' }, substitutes: ['WLP002', 'Wyeast 1098'] },
  { name: 'SafAle K-97', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Dry', attenuation: '78-82%', temp_range: '15-24°C', flocculation: 'Medium' }, substitutes: ['US-05', 'WLP001'] },
  { name: 'SafLager W-34/70', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Dry', attenuation: '80-84%', temp_range: '9-15°C', flocculation: 'High' }, substitutes: ['WLP830', 'Wyeast 2124'] },
  { name: 'SafLager S-23', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Dry', attenuation: '72-76%', temp_range: '9-15°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'SafBrew WB-06', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Dry', attenuation: '86-90%', temp_range: '15-24°C', flocculation: 'Low' }, substitutes: ['WLP300', 'Wyeast 3068'] },
  { name: 'SafBrew T-58', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Dry', attenuation: '72-78%', temp_range: '15-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'Wyeast 1214'] },
  { name: 'SafBrew BE-256', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Dry', attenuation: '78-82%', temp_range: '15-24°C', flocculation: 'Medium' }, substitutes: ['WLP530', 'Wyeast 1762'] },
  { name: 'WLP001 California Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-80%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['US-05', 'Wyeast 1056'] },
  { name: 'WLP002 English Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '63-70%', temp_range: '18-21°C', flocculation: 'Very High' }, substitutes: ['S-04', 'Wyeast 1098'] },
  { name: 'WLP004 Irish Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '69-74%', temp_range: '18-21°C', flocculation: 'Medium' }, substitutes: ['Wyeast 1084', 'S-04'] },
  { name: 'WLP005 British Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-74%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP007 Dry English Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-80%', temp_range: '18-22°C', flocculation: 'Medium-High' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP008 East Coast Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Medium-Low' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP010 Anniversary Ale', category: 'yeast', available: false, specs: { type: 'Ale', form: 'Liquid', attenuation: '75-80%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP013 London Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-75%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP022 Essex Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '71-76%', temp_range: '18-22°C', flocculation: 'Medium-High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP023 Burton Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '69-75%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP025 Southwold Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '71-76%', temp_range: '18-22°C', flocculation: 'Medium-High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP026 Maris Otter Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP028 Edinburgh Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP029 German Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '72-78%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP033 Klassic Ale Yeast', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '66-72%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP036 Dusseldorf Alt', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '68-72%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP040 Hefeweizen Ale', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['WB-06', 'WLP300'] },
  { name: 'WLP041 Pacific Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '65-70%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP051 California Ale V', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Medium-High' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP060 American Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '72-78%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP066 London Fog', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Low' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP067 Coastal Haze', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Low' }, substitutes: ['WLP066', 'WLP001'] },
  { name: 'WLP080 Cream Ale Yeast', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '75-80%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP090 San Diego Super', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '76-83%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP095 Burlington Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'WLP100 Manchester Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '70-75%', temp_range: '18-22°C', flocculation: 'Medium-High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'WLP300 Hefeweizen Ale', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['WB-06', 'WLP041'] },
  { name: 'WLP380 Hefeweizen IV', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['WLP300', 'WB-06'] },
  { name: 'WLP400 Belgian Wit Ale', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '74-78%', temp_range: '18-22°C', flocculation: 'Low' }, substitutes: ['WLP300', 'WB-06'] },
  { name: 'WLP500 Trappist Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['BE-256', 'Wyeast 1214'] },
  { name: 'WLP510 Belgian Bastogne', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP515 Antwerp Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '73-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP530 Abbey Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP540 Abbey IV', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP530', 'WLP500'] },
  { name: 'WLP545 Belgian Strong Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '78-85%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP550 Belgian Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '78-85%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP545', 'WLP500'] },
  { name: 'WLP565 Belgian Saison I', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '65-75%', temp_range: '20-25°C', flocculation: 'Low' }, substitutes: ['Wyeast 3711', 'WLP566'] },
  { name: 'WLP566 Belgian Saison II', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '78-85%', temp_range: '20-25°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3724', 'WLP565'] },
  { name: 'WLP568 Belgian Style Saison', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '70-80%', temp_range: '20-25°C', flocculation: 'Medium' }, substitutes: ['WLP565', 'WLP566'] },
  { name: 'WLP570 Belgian Golden Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '73-78%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP575 Belgian Style Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP580 Belgian Style Ale 2', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP575', 'WLP500'] },
  { name: 'WLP585 Belgian Style Ale 3', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP580', 'WLP575'] },
  { name: 'WLP590 French Saison', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '73-80%', temp_range: '20-25°C', flocculation: 'Medium' }, substitutes: ['WLP565', 'WLP566'] },
  { name: 'WLP595 Belgian Dark Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'WLP800 Pilsner Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '72-78%', temp_range: '10-14°C', flocculation: 'Medium-High' }, substitutes: ['W-34/70', 'WLP830'] },
  { name: 'WLP802 Czech Budejovice Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '75-80%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'WLP810 San Francisco Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '65-70%', temp_range: '14-18°C', flocculation: 'High' }, substitutes: ['WLP800', 'W-34/70'] },
  { name: 'WLP820 Oktoberfest/Marzen Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '65-73%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP830 German Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '74-79%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'WLP833 German Bock Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-76%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP838 Southern German Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '68-76%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP840 American Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '75-80%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'WLP860 Munich Helles', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '68-72%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP866 German Lager X', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-75%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP870 American Lager X', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-75%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP840', 'W-34/70'] },
  { name: 'WLP920 Old Bavarian Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '66-73%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP830', 'W-34/70'] },
  { name: 'WLP940 Mexican Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-78%', temp_range: '10-14°C', flocculation: 'Medium' }, substitutes: ['WLP840', 'W-34/70'] },
  { name: 'Kveik Voss', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Hornindal', 'Kveik Lutra'] },
  { name: 'Kveik Hornindal', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'High' }, substitutes: ['Kveik Voss', 'Kveik Lutra'] },
  { name: 'Kveik Lutra', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Kveik Hornindal'] },
  { name: 'Lallemand Voss Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Kveik Hornindal'] },
  { name: 'Lallemand Hornindal Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'High' }, substitutes: ['Kveik Hornindal', 'Kveik Voss'] },
  { name: 'Lallemand Lutra Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Dry', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Lutra', 'Kveik Voss'] },
  { name: 'Omega Voss Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Liquid', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Lallemand Voss'] },
  { name: 'Omega Hornindal Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Liquid', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'High' }, substitutes: ['Kveik Hornindal', 'Lallemand Hornindal'] },
  { name: 'Omega Lutra Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Liquid', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Lutra', 'Lallemand Lutra'] },
  { name: 'Omega HotHead Ale', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Liquid', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Lallemand Voss'] },
  { name: 'Omega Jovaru Lithuanian Farmhouse', category: 'yeast', available: true, specs: { type: 'Farmhouse', form: 'Liquid', attenuation: '75-82%', temp_range: '20-35°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Lallemand Voss'] },
  { name: 'Omega Espe Kveik', category: 'yeast', available: true, specs: { type: 'Kveik', form: 'Liquid', attenuation: '75-82%', temp_range: '20-40°C', flocculation: 'Medium' }, substitutes: ['Kveik Voss', 'Lallemand Voss'] },
  { name: 'Omega Lactobacillus Blend', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Liquid', attenuation: 'N/A', temp_range: '20-40°C', flocculation: 'N/A' }, substitutes: ['WLP677', 'Wyeast 5335'] },
  { name: 'Omega Brettanomyces Blend', category: 'yeast', available: true, specs: { type: 'Wild', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['WLP650', 'Wyeast 5112'] },
  { name: 'WLP650 Brettanomyces Bruxellensis', category: 'yeast', available: true, specs: { type: 'Wild', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 5112', 'Omega Brett Blend'] },
  { name: 'WLP653 Brettanomyces Lambicus', category: 'yeast', available: true, specs: { type: 'Wild', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 5526', 'Omega Brett Blend'] },
  { name: 'WLP677 Lactobacillus', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Liquid', attenuation: 'N/A', temp_range: '20-40°C', flocculation: 'N/A' }, substitutes: ['Wyeast 5335', 'Omega Lacto Blend'] },
  { name: 'Wyeast 1056 American Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '15-22°C', flocculation: 'Medium' }, substitutes: ['US-05', 'WLP001'] },
  { name: 'Wyeast 1084 Irish Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '71-75%', temp_range: '16-22°C', flocculation: 'Medium' }, substitutes: ['WLP004', 'S-04'] },
  { name: 'Wyeast 1098 British Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-75%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1099 Whitbread Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '68-72%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1187 Ringwood Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '68-72%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP005', 'S-04'] },
  { name: 'Wyeast 1214 Belgian Abbey', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-78%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'Wyeast 1272 American Ale II', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '72-76%', temp_range: '15-22°C', flocculation: 'Medium' }, substitutes: ['Wyeast 1056', 'US-05'] },
  { name: 'Wyeast 1275 Thames Valley Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['Wyeast 1056', 'US-05'] },
  { name: 'Wyeast 1282 West Yorkshire Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1318 London Ale III', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '71-75%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1332 Northwest Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1335 British Ale II', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-76%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1338 European Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1469 West Yorkshire Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['Wyeast 1282', 'WLP002'] },
  { name: 'Wyeast 1728 Scottish Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '69-73%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP028', 'S-04'] },
  { name: 'Wyeast 1762 Belgian Abbey II', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['WLP500', 'BE-256'] },
  { name: 'Wyeast 1768 English Special Bitter', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '68-72%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 1968 London ESB Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['WLP002', 'S-04'] },
  { name: 'Wyeast 2000 Budvar Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '71-75%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2001 Urquell Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '72-76%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2007 Pilsen Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '71-75%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2035 American Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2042 Danish Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2112 California Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '67-71%', temp_range: '14-18°C', flocculation: 'High' }, substitutes: ['WLP810', 'S-23'] },
  { name: 'Wyeast 2124 Bohemian Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2206 Bavarian Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2247 European Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2278 North American Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-76%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2308 Munich Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-74%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2352 Munich Lager II', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-74%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2487 Hella Bock', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '70-74%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['W-34/70', 'WLP800'] },
  { name: 'Wyeast 2565 Kolsch', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '15-21°C', flocculation: 'Low' }, substitutes: ['WLP029', 'K-97'] },
  { name: 'Wyeast 2575 Kolsch II', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '15-21°C', flocculation: 'Low' }, substitutes: ['Wyeast 2565', 'WLP029'] },
  { name: 'Wyeast 2585 West Coast IPA', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '18-22°C', flocculation: 'Medium' }, substitutes: ['WLP001', 'US-05'] },
  { name: 'Wyeast 2633 Octoberfest Lager', category: 'yeast', available: true, specs: { type: 'Lager', form: 'Liquid', attenuation: '73-77%', temp_range: '9-13°C', flocculation: 'Medium' }, substitutes: ['WLP820', 'W-34/70'] },
  { name: 'Wyeast 3068 Weihenstephan Weizen', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['WLP300', 'WB-06'] },
  { name: 'Wyeast 3056 Bavarian Wheat', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['Wyeast 3068', 'WLP300'] },
  { name: 'Wyeast 3118 London Ale', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '67-71%', temp_range: '18-22°C', flocculation: 'High' }, substitutes: ['Wyeast 1318', 'WLP002'] },
  { name: 'Wyeast 3463 Forbidden Fruit', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '73-77%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['Wyeast 3068', 'WLP300'] },
  { name: 'Wyeast 3522 Belgian Ardennes', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '72-76%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 1762', 'WLP500'] },
  { name: 'Wyeast 3526 Belgian Ardennes II', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '72-76%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3522', 'WLP500'] },
  { name: 'Wyeast 3538 Leuven Pale Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-78%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3522', 'WLP500'] },
  { name: 'Wyeast 3711 French Saison', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '77-83%', temp_range: '18-25°C', flocculation: 'Low' }, substitutes: ['WLP565', 'WLP566'] },
  { name: 'Wyeast 3724 Belgian Saison', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '76-80%', temp_range: '18-25°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3711', 'WLP566'] },
  { name: 'Wyeast 3725 Biere de Garde', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '74-78%', temp_range: '18-25°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3711', 'WLP566'] },
  { name: 'Wyeast 3726 Farmhouse Ale', category: 'yeast', available: true, specs: { type: 'Saison', form: 'Liquid', attenuation: '74-78%', temp_range: '18-25°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3711', 'WLP566'] },
  { name: 'Wyeast 3739 Flanders Golden Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '74-78%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3522', 'WLP500'] },
  { name: 'Wyeast 3763 Roeselare Ale', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 3278', 'WLP655'] },
  { name: 'Wyeast 3787 Trappist High Gravity', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '76-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 1762', 'WLP500'] },
  { name: 'Wyeast 3789 Trappist Blend', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-79%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3787', 'WLP500'] },
  { name: 'Wyeast 3942 Belgian Wheat', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '72-76%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['Wyeast 3944', 'WLP400'] },
  { name: 'Wyeast 3944 Belgian Witbier', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '72-76%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['Wyeast 3942', 'WLP400'] },
  { name: 'Wyeast 4021 Belgian Wit II', category: 'yeast', available: true, specs: { type: 'Wheat', form: 'Liquid', attenuation: '74-78%', temp_range: '18-24°C', flocculation: 'Low' }, substitutes: ['Wyeast 3944', 'WLP400'] },
  { name: 'Wyeast 4028 Belgian Strong Ale', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '75-79%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3787', 'WLP500'] },
  { name: 'Wyeast 4134 Sake Yeast', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '15-20°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4134', 'WLP705'] },
  { name: 'Wyeast 4184 Sweet Mead', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '15-24°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4184', 'WLP720'] },
  { name: 'Wyeast 4242 Chablis', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '15-24°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4242', 'WLP715'] },
  { name: 'Wyeast 4335 Kolsch', category: 'yeast', available: true, specs: { type: 'Ale', form: 'Liquid', attenuation: '73-77%', temp_range: '15-21°C', flocculation: 'Low' }, substitutes: ['Wyeast 2565', 'WLP029'] },
  { name: 'Wyeast 4347 Extreme Fermentation', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4347', 'WLP099'] },
  { name: 'Wyeast 4632 Dry Mead', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '15-24°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4632', 'WLP720'] },
  { name: 'Wyeast 4766 Cider', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '15-24°C', flocculation: 'N/A' }, substitutes: ['Wyeast 4766', 'WLP775'] },
  { name: 'Wyeast 4942 Belgian Dark Strong', category: 'yeast', available: true, specs: { type: 'Abbey', form: 'Liquid', attenuation: '76-80%', temp_range: '18-24°C', flocculation: 'Medium' }, substitutes: ['Wyeast 3787', 'WLP500'] },
  { name: 'Wyeast 5112 Brettanomyces Bruxellensis', category: 'yeast', available: true, specs: { type: 'Wild', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['WLP650', 'Omega Brett Blend'] },
  { name: 'Wyeast 5335 Lactobacillus', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Liquid', attenuation: 'N/A', temp_range: '20-40°C', flocculation: 'N/A' }, substitutes: ['WLP677', 'Omega Lacto Blend'] },
  { name: 'Wyeast 5526 Brettanomyces Lambicus', category: 'yeast', available: true, specs: { type: 'Wild', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['WLP653', 'Omega Brett Blend'] },
  { name: 'Wyeast 5733 Pediococcus', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Liquid', attenuation: 'N/A', temp_range: '20-40°C', flocculation: 'N/A' }, substitutes: ['Wyeast 5733', 'WLP661'] },
  { name: 'Wyeast 9097 Old Ale Blend', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9098 Old Ale Blend II', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9099 Old Ale Blend III', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9100 Old Ale Blend IV', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9101 Old Ale Blend V', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9102 Old Ale Blend VI', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9103 Old Ale Blend VII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9104 Old Ale Blend VIII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9105 Old Ale Blend IX', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9106 Old Ale Blend X', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9107 Old Ale Blend XI', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9108 Old Ale Blend XII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9109 Old Ale Blend XIII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9110 Old Ale Blend XIV', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9111 Old Ale Blend XV', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9112 Old Ale Blend XVI', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9113 Old Ale Blend XVII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9114 Old Ale Blend XVIII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9115 Old Ale Blend XIX', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9116 Old Ale Blend XX', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9117 Old Ale Blend XXI', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9118 Old Ale Blend XXII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9119 Old Ale Blend XXIII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9120 Old Ale Blend XXIV', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9121 Old Ale Blend XXV', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9122 Old Ale Blend XXVI', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9123 Old Ale Blend XXVII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9124 Old Ale Blend XXVIII', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9125 Old Ale Blend XXIX', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Wyeast 9126 Old Ale Blend XXX', category: 'yeast', available: true, specs: { type: 'Specialty', form: 'Liquid', attenuation: 'N/A', temp_range: '18-25°C', flocculation: 'N/A' }, substitutes: ['Wyeast 9097', 'WLP545'] },
  { name: 'Lallemand WildBrew Philly Sour', category: 'yeast', available: true, specs: { type: 'Sour', form: 'Dry', attenuation: '75-85%', temp_range: '20-30°C', flocculation: 'High' }, substitutes: ['WLP677', 'Omega Lactobacillus Blend'] },
];

// ─── Tool implementation ─────────────────────────────────────────────────────

export class InventorySearchTool implements BuiltinTool<InventorySearchInput> {
  readonly name = 'inventory_search' as const;
  readonly description =
    'Search a virtual inventory of brewing ingredients (malts, hops, yeasts). Filter by category, check availability, find substitutes, and get technical specifications.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(InventorySearchInputSchema);

  resolveExecution(args: InventorySearchInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Inventory search: ${args.query}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: InventorySearchInput): Promise<ExecutableToolResult> {
    try {
      const query = args.query.toLowerCase();
      const category = args.category ?? 'all';
      const includeUnavailable = args.include_unavailable ?? false;

      const results = INVENTORY.filter((item) => {
        // Category filter
        if (category !== 'all' && item.category !== category) return false;

        // Availability filter
        if (!includeUnavailable && !item.available) return false;

        // Text search
        const nameMatch = item.name.toLowerCase().includes(query);
        const specMatch = Object.values(item.specs).some((v) =>
          v.toLowerCase().includes(query),
        );
        const substituteMatch = item.substitutes?.some((s) =>
          s.toLowerCase().includes(query),
        );

        return nameMatch || specMatch || substituteMatch;
      });

      if (results.length === 0) {
        return Promise.resolve({
          output: `Nessun risultato per "${args.query}" nella categoria "${category}".`,
        });
      }

      const lines: string[] = [
        `**${results.length} risultato/i per "${args.query}"**`,
        '',
      ];

      for (const item of results.slice(0, 20)) {
        const status = item.available ? '✅ Disponibile' : '❌ Non disponibile';
        lines.push(`**${item.name}** (${item.category}) — ${status}`);
        for (const [key, value] of Object.entries(item.specs)) {
          lines.push(`  ${key}: ${value}`);
        }
        if (item.substitutes !== undefined && item.substitutes.length > 0) {
          lines.push(`  Sostituti: ${item.substitutes.join(', ')}`);
        }
        lines.push('');
      }

      if (results.length > 20) {
        lines.push(`... e altri ${results.length - 20} risultati. Raffina la ricerca.`);
      }

      return Promise.resolve({ output: lines.join('\n') });
    } catch (error) {
      return Promise.resolve({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
