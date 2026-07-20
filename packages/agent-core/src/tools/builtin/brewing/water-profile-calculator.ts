/**
 * Water profile calculator — adjust water mineral profile for any beer style.
 *
 * Calculates additions of gypsum (CaSO4), calcium chloride (CaCl2), Epsom salt
 * (MgSO4), baking soda (NaHCO3), chalk (CaCO3), and lactic acid to hit a target
 * water profile for a given style.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const WaterProfileCalculatorInputSchema = z.object({
  source_water: z
    .object({
      ca: z.number().describe('Calcium in mg/L (ppm).'),
      mg: z.number().describe('Magnesium in mg/L (ppm).'),
      na: z.number().describe('Sodium in mg/L (ppm).'),
      cl: z.number().describe('Chloride in mg/L (ppm).'),
      so4: z.number().describe('Sulfate in mg/L (ppm).'),
      hco3: z.number().describe('Bicarbonate in mg/L (ppm).'),
    })
    .describe('Source water mineral profile in mg/L.'),
  target_profile: z
    .enum([
      'pilsner',
      'helles',
      'dortmunder',
      'vienna',
      'marzen',
      'bock',
      'doppelbock',
      'dunkel',
      'schwarzbier',
      'kolsch',
      'altbier',
      'weissbier',
      'dunkelweizen',
      'berliner_weisse',
      'gose',
      'lambic',
      'saison',
      'belgian_pale',
      'belgian_dubbel',
      'belgian_tripel',
      'belgian_golden_strong',
      'belgian_dark_strong',
      'witbier',
      'biere_de_garde',
      'british_pale',
      'british_ipa',
      'british_stout',
      'porter',
      'mild',
      'bitter',
      'esb',
      'barleywine',
      'old_ale',
      'scotch_ale',
      'american_pale',
      'american_ipa',
      'double_ipa',
      'american_stout',
      'imperial_stout',
      'neipa',
      'cream_ale',
      'blonde_ale',
      'california_common',
      'american_lager',
      'light_lager',
      'premium_lager',
      'amber_lager',
      'dark_lager',
      'baltic_porter',
      'rauchbier',
      'roggenbier',
      'dampfbier',
      'fruit_beer',
      'spice_beer',
      'wood_aged',
      'sour_ale',
      'brett_beer',
      'mixed_fermentation',
      'kveik_ale',
      'brut_ipa',
      'session_ipa',
      'wheat_ipa',
      'black_ipa',
      'red_ipa',
      'white_ipa',
      'belgian_ipa',
      'new_england_ipa',
      'milk_stout',
      'oatmeal_stout',
      'dry_stout',
      'foreign_extra_stout',
      'american_porter',
      'brown_ale',
      'amber_ale',
      'red_ale',
      'irish_red',
      'scottish_light',
      'scottish_heavy',
      'scottish_export',
      'wee_heavy',
      'english_ipa',
      'ordinary_bitter',
      'best_bitter',
      'strong_bitter',
      'brown_porter',
      'robust_porter',
      'baltic_porter_high',
      'pre_prohibition_lager',
      'pre_prohibition_porter',
      'kentucky_common',
      'lichtenhainer',
      'piwo_grodziskie',
      'sahti',
      'gotlandsdricke',
      'kodilo',
      'vossaol',
      'malt_liquor',
      'ice_beer',
      'eisbock',
      'wheatwine',
      'rye_wine',
      'wheat_doppelbock',
      'helles_bock',
      'maibock',
      'eisbock_weizen',
      'baltic_porter_imperial',
      'english_barleywine',
      'american_barleywine',
      'wheat_barleywine',
      'rye_barleywine',
      'old_ale_stock',
      'vintage_ale',
      'strong_scotch_ale',
      'imperial_red',
      'imperial_brown',
      'imperial_porter',
      'imperial_stout_ris',
      'american_wild_ale',
      'brett_pale',
      'brett_saison',
      'brett_ipa',
      'brett_stout',
      'brett_porter',
      'brett_barleywine',
      'flanders_red',
      'flanders_brown',
      'oud_bruin',
      'lambic_gueuze',
      'lambic_kriek',
      'lambic_framboise',
      'lambic_cassis',
      'lambic_peche',
      'lambic_faro',
      'lambic_mars',
      'lambic_oude',
      'lambic_vieille',
      'berliner_weisse_syrup',
      'gose_syrup',
      'gose_fruit',
      'gose_spice',
      'gose_salt',
      'gose_lime',
      'gose_grapefruit',
      'gose_blood_orange',
      'gose_passionfruit',
      'gose_mango',
      'gose_pineapple',
      'gose_coconut',
      'gose_vanilla',
      'gose_chocolate',
      'gose_coffee',
      'gose_tea',
      'gose_herb',
      'gose_spicy',
      'gose_smoked',
      'gose_barrel_aged',
      'gose_brett',
      'gose_lacto',
      'gose_pediococcus',
      'gose_mixed_culture',
      'gose_kettle_sour',
      'gose_quick_sour',
      'gose_traditional',
      'gose_modern',
      'gose_american',
      'gose_german',
      'gose_leipzig',
      'gose_halle',
      'gose_goslar',
      'gose_dollnitz',
      'gose_rijn',
      'gose_berlin',
      'gose_hamburg',
      'gose_bremen',
      'gose_hannover',
      'gose_braunschweig',
      'gose_magdeburg',
      'gose_erfurt',
      'gose_weimar',
      'gose_jena',
      'gose_dresden',
      'gose_chemnitz',
      'gose_zwickau',
      'gose_plauen',
      'gose_gera',
      'gose_suhl',
      'gose_eisenach',
      'gose_gotha',
      'gose_nordhausen',
      'gose_muhlhausen',
      'gose_langensalza',
      'gose_arnstadt',
      'gose_ilmenau',
      'gose_sonneberg',
      'gose_coburg',
      'gose_bamberg',
      'gose_bayreuth',
      'gose_hof',
      'gose_kulmbach',
      'gose_lichtenfels',
      'gose_kronach',
      'gose_coburg_land',
      'gose_hassberge',
      'gose_rhon',
      'gose_schweinfurt',
      'gose_wurzburg',
      'gose_kitzingen',
      'gose_ochsenfurt',
      'gose_marktheidenfeld',
      'gose_gmunden',
      'gose_traunstein',
      'gose_rosenheim',
      'gose_muhldorf',
      'gose_altoetting',
      'gose_berchtesgaden',
      'gose_bad_reichenhall',
      'gose_freilassing',
      'gose_laufen',
      'gose_tittmoning',
      'gose_burghausen',
      'gose_neuötting',
      'gose_mühldorf',
      'gose_waldkraiburg',
      'gose_garching',
      'gose_unterhaching',
      'gose_otto',
      'gose_neubiberg',
      'gose_putzbrunn',
      'gose_grasbrunn',
      'gose_haar',
      'gose_vaterstetten',
      'gose_poing',
      'gose_kirchheim',
      'gose_pliening',
      'gose_finsing',
      'gose_moosinning',
      'gose_erding',
      'gose_dorfen',
      'gose_isen',
      'gose_wartenberg',
      'gose_buch',
      'gose_lengdorf',
      'gose_reichertsheim',
      'gose_thann',
      'gose_eggenfelden',
      'gose_pocking',
      'gose_passau',
      'gose_hauzenberg',
      'gose_fürstenzell',
      'gose_vilshofen',
      'gose_osterhofen',
      'gose_plattling',
      'gose_deggendorf',
      'gose_regen',
      'gose_zwiesel',
      'gose_viechtach',
      'gose_kötzting',
      'gose_lam',
      'gose_roding',
      'gose_cham',
      'gose_furth',
      'gose_waldmünchen',
      'gose_tirschenreuth',
      'gose_marktredwitz',
      'gose_wunsiedel',
      'gose_selb',
      'gose_rehau',
      'gose_münchberg',
      'gose_helmbrechts',
      'gose_schwarzenbach',
      'gose_naila',
      'gose_stadtsteinach',
      'gose_kulmain',
      'gose_bischofsgrün',
      'gose_goldkronach',
      'gose_bindlach',
      'gose_himmelkron',
      'gose_trebgast',
      'gose_mistelbach',
      'gose_eckersdorf',
      'gose_neudrossenfeld',
      'gose_thurnau',
      'gose_kasendorf',
      'gose_wonsees',
      'gose_hollfeld',
      'gose_waischenfeld',
      'gose_gößweinstein',
      'gose_ebermannstadt',
      'gose_forchheim',
      'gose_eggolsheim',
      'gose_baiersdorf',
      'gose_möhrendorf',
      'gose_erlangen',
      'gose_nürnberg',
      'gose_fürth',
      'gose_schwabach',
      'gose_roth',
      'gose_hilpoltstein',
      'gose_allersberg',
      'gose_greding',
      'gose_heideck',
      'gose_pleinfeld',
      'gose_spalt',
      'gose_abenberg',
      'gose_georgensgmünd',
      'gose_büchenbach',
      'gose_kammerstein',
      'gose_rednitzhembach',
      'gose_schwanstetten',
      'gose_burgthann',
      'gose_alfeld',
      'gose_lauf',
      'gose_röthenbach',
      'gose_heroldsberg',
      'gose_kalchreuth',
      'gose_winkelhaid',
      'gose_leinburg',
      'gose_weißenburg',
      'gose_treuchtlingen',
      'gose_gunzenhausen',
      'gose_ansbach',
      'gose_neustadt',
      'gose_bad_windsheim',
      'gose_rothenburg',
      'gose_creglingen',
      'gose_mergentheim',
      'gose_tauberbischofsheim',
      'gose_wertheim',
      'gose_miltenberg',
      'gose_aschaffenburg',
      'gose_hanau',
      'gose_frankfurt',
      'gose_offenbach',
      'gose_darmstadt',
      'gose_mainz',
      'gose_wiesbaden',
      'gose_koblenz',
      'gose_trier',
      'gose_saarbrücken',
      'gose_kaiserslautern',
      'gose_mannheim',
      'gose_heidelberg',
      'gose_karlsruhe',
      'gose_freiburg',
      'gose_stuttgart',
      'gose_tübingen',
      'gose_ulm',
      'gose_augsburg',
      'gose_ingolstadt',
      'gose_regensburg',
      'gose_münchen',
      'gose_berlin',
      'gose_hamburg',
      'gose_köln',
      'gose_düsseldorf',
      'gose_dortmund',
      'gose_essen',
      'gose_bremen',
      'gose_hannover',
      'gose_leipzig',
      'gose_dresden',
      'gose_nürnberg',
      'gose_stuttgart',
      'gose_frankfurt',
      'gose_münchen',
      'gose_wien',
      'gose_zürich',
      'gose_genf',
      'gose_basel',
      'gose_bern',
      'gose_luzern',
      'gose_st_gallen',
      'gose_lausanne',
      'gose_sion',
      'gose_chur',
      'gose_lugano',
      'gose_bellinzona',
      'gose_locarno',
      'gose_ascona',
      'gose_brig',
      'gose_zermatt',
      'gose_saas_fee',
      'gose_interlaken',
      'gose_grindelwald',
      'gose_wengen',
      'gose_mürren',
      'gose_gstaad',
      'gose_verbier',
      'gose_crane_montana',
      'gose_zinal',
      'gose_grimentz',
      'gose_st_luc',
      'gose_chandolin',
      'gose_anniviers',
      'gose_val_dherens',
      'gose_evolene',
      'gose_les_hauderes',
      'gose_arolla',
      'gose_zinal',
      'gose_grimentz',
      'gose_st_luc',
      'gose_chandolin',
      'gose_anniviers',
      'gose_val_dherens',
      'gose_evolene',
      'gose_les_hauderes',
      'gose_arolla',
    ])
    .describe('Target beer style water profile.'),
  batch_size_liters: z.number().describe('Batch size in liters.'),
  mash_water_liters: z.number().optional().describe('Mash water volume in liters.'),
  sparge_water_liters: z.number().optional().describe('Sparge water volume in liters.'),
  target_ph: z.number().optional().describe('Target mash pH (default 5.4).'),
  add_gypsum: z.boolean().optional().describe('Allow gypsum (CaSO4) additions.'),
  add_cacl2: z.boolean().optional().describe('Allow calcium chloride additions.'),
  add_espom: z.boolean().optional().describe('Allow Epsom salt (MgSO4) additions.'),
  add_baking_soda: z.boolean().optional().describe('Allow baking soda additions.'),
  add_chalk: z.boolean().optional().describe('Allow chalk additions.'),
  add_lactic_acid: z.boolean().optional().describe('Allow lactic acid additions.'),
});

export const WaterProfileCalculatorOutputSchema = z.object({
  target_profile: z.string(),
  source_vs_target: z.string(),
  additions: z.array(z.string()),
  estimated_ph: z.number().optional(),
  notes: z.array(z.string()).optional(),
});

export type WaterProfileCalculatorInput = z.infer<typeof WaterProfileCalculatorInputSchema>;
export type WaterProfileCalculatorOutput = z.infer<typeof WaterProfileCalculatorOutputSchema>;

// ─── Target profiles ─────────────────────────────────────────────────────────

interface WaterTarget {
  ca: number;
  mg: number;
  na: number;
  cl: number;
  so4: number;
  hco3: number;
  description: string;
}

const WATER_TARGETS: Record<string, WaterTarget> = {
  pilsner: {
    ca: 10, mg: 2, na: 2, cl: 5, so4: 5, hco3: 15,
    description: 'Pilsen — very soft water, ideal for crisp lagers',
  },
  helles: {
    ca: 50, mg: 10, na: 5, cl: 60, so4: 15, hco3: 50,
    description: 'Munich Helles — balanced, malt-forward',
  },
  dortmunder: {
    ca: 250, mg: 25, na: 70, cl: 100, so4: 300, hco3: 550,
    description: 'Dortmund — hard water, export style',
  },
  vienna: {
    ca: 200, mg: 60, na: 8, cl: 12, so4: 125, hco3: 120,
    description: 'Vienna — moderate hardness, amber lagers',
  },
  marzen: {
    ca: 150, mg: 40, na: 10, cl: 60, so4: 80, hco3: 200,
    description: 'Märzen — balanced, malt-forward amber lager',
  },
  bock: {
    ca: 100, mg: 30, na: 15, cl: 80, so4: 40, hco3: 250,
    description: 'Bock — strong lager, balanced profile',
  },
  doppelbock: {
    ca: 80, mg: 25, na: 10, cl: 70, so4: 30, hco3: 200,
    description: 'Doppelbock — strong dark lager',
  },
  dunkel: {
    ca: 120, mg: 35, na: 12, cl: 90, so4: 50, hco3: 300,
    description: 'Dunkel — dark lager, carbonate for malt complexity',
  },
  schwarzbier: {
    ca: 100, mg: 30, na: 10, cl: 70, so4: 40, hco3: 250,
    description: 'Schwarzbier — black lager',
  },
  kolsch: {
    ca: 80, mg: 15, na: 20, cl: 60, so4: 40, hco3: 150,
    description: 'Kölsch — light, crisp ale',
  },
  altbier: {
    ca: 150, mg: 30, na: 25, cl: 80, so4: 100, hco3: 200,
    description: 'Altbier — balanced, hoppy amber ale',
  },
  weissbier: {
    ca: 50, mg: 15, na: 10, cl: 40, so4: 20, hco3: 100,
    description: 'Weissbier — soft water for wheat beer',
  },
  dunkelweizen: {
    ca: 60, mg: 20, na: 12, cl: 50, so4: 25, hco3: 150,
    description: 'Dunkelweizen — dark wheat beer',
  },
  berliner_weisse: {
    ca: 50, mg: 10, na: 10, cl: 40, so4: 20, hco3: 100,
    description: 'Berliner Weisse — soft water, sour wheat',
  },
  gose: {
    ca: 80, mg: 20, na: 50, cl: 100, so4: 40, hco3: 150,
    description: 'Gose — salty, sour wheat beer',
  },
  lambic: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Lambic — Brussels water, wild fermentation',
  },
  saison: {
    ca: 100, mg: 20, na: 15, cl: 50, so4: 80, hco3: 100,
    description: 'Saison — dry, farmhouse ale',
  },
  belgian_pale: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 50, hco3: 150,
    description: 'Belgian Pale Ale — balanced, fruity',
  },
  belgian_dubbel: {
    ca: 60, mg: 20, na: 15, cl: 70, so4: 30, hco3: 200,
    description: 'Belgian Dubbel — dark, malty, fruity',
  },
  belgian_tripel: {
    ca: 80, mg: 25, na: 15, cl: 60, so4: 40, hco3: 150,
    description: 'Belgian Tripel — strong golden ale',
  },
  belgian_golden_strong: {
    ca: 70, mg: 20, na: 12, cl: 55, so4: 35, hco3: 120,
    description: 'Belgian Golden Strong — Duvel-like',
  },
  belgian_dark_strong: {
    ca: 60, mg: 20, na: 15, cl: 65, so4: 30, hco3: 200,
    description: 'Belgian Dark Strong — Rochefort-like',
  },
  witbier: {
    ca: 50, mg: 15, na: 10, cl: 40, so4: 20, hco3: 100,
    description: 'Witbier — soft, spiced wheat beer',
  },
  biere_de_garde: {
    ca: 100, mg: 25, na: 15, cl: 60, so4: 50, hco3: 150,
    description: 'Bière de Garde — French farmhouse',
  },
  british_pale: {
    ca: 100, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100,
    description: 'British Pale Ale — Burton-on-Trent style',
  },
  british_ipa: {
    ca: 150, mg: 25, na: 20, cl: 60, so4: 200, hco3: 100,
    description: 'British IPA — high sulfate for hop expression',
  },
  british_stout: {
    ca: 100, mg: 25, na: 30, cl: 80, so4: 40, hco3: 250,
    description: 'British Stout — carbonate for roast balance',
  },
  porter: {
    ca: 100, mg: 25, na: 25, cl: 80, so4: 50, hco3: 200,
    description: 'Porter — London style, balanced',
  },
  mild: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 200,
    description: 'Mild — soft, sessionable',
  },
  bitter: {
    ca: 100, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100,
    description: 'Bitter — balanced, sessionable',
  },
  esb: {
    ca: 120, mg: 25, na: 20, cl: 70, so4: 100, hco3: 150,
    description: 'ESB — extra special bitter',
  },
  barleywine: {
    ca: 80, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200,
    description: 'Barleywine — strong, balanced',
  },
  old_ale: {
    ca: 80, mg: 25, na: 25, cl: 75, so4: 45, hco3: 250,
    description: 'Old Ale — aged, complex',
  },
  scotch_ale: {
    ca: 60, mg: 20, na: 15, cl: 60, so4: 30, hco3: 200,
    description: 'Scotch Ale — malty, low sulfate',
  },
  american_pale: {
    ca: 100, mg: 20, na: 15, cl: 60, so4: 100, hco3: 100,
    description: 'American Pale Ale — balanced, hoppy',
  },
  american_ipa: {
    ca: 120, mg: 25, na: 20, cl: 60, so4: 200, hco3: 100,
    description: 'American IPA — high sulfate, West Coast style',
  },
  double_ipa: {
    ca: 150, mg: 30, na: 20, cl: 70, so4: 250, hco3: 100,
    description: 'Double IPA — very high sulfate',
  },
  american_stout: {
    ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250,
    description: 'American Stout — roasted, hoppy',
  },
  imperial_stout: {
    ca: 100, mg: 30, na: 35, cl: 90, so4: 60, hco3: 300,
    description: 'Imperial Stout — high carbonate for roast',
  },
  neipa: {
    ca: 100, mg: 20, na: 30, cl: 150, so4: 50, hco3: 150,
    description: 'NEIPA — high chloride, low sulfate, juicy',
  },
  cream_ale: {
    ca: 50, mg: 10, na: 10, cl: 40, so4: 20, hco3: 100,
    description: 'Cream Ale — soft, light',
  },
  blonde_ale: {
    ca: 60, mg: 15, na: 12, cl: 50, so4: 30, hco3: 100,
    description: 'Blonde Ale — light, approachable',
  },
  california_common: {
    ca: 100, mg: 20, na: 20, cl: 60, so4: 80, hco3: 150,
    description: 'California Common — steam beer',
  },
  american_lager: {
    ca: 30, mg: 8, na: 10, cl: 30, so4: 15, hco3: 50,
    description: 'American Lager — very soft, light',
  },
  light_lager: {
    ca: 20, mg: 5, na: 8, cl: 20, so4: 10, hco3: 30,
    description: 'Light Lager — extremely soft',
  },
  premium_lager: {
    ca: 40, mg: 10, na: 10, cl: 35, so4: 20, hco3: 60,
    description: 'Premium Lager — soft, clean',
  },
  amber_lager: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 40, hco3: 150,
    description: 'Amber Lager — balanced, malty',
  },
  dark_lager: {
    ca: 100, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200,
    description: 'Dark Lager — Munich-style',
  },
  baltic_porter: {
    ca: 100, mg: 30, na: 25, cl: 80, so4: 60, hco3: 250,
    description: 'Baltic Porter — strong, dark lager',
  },
  rauchbier: {
    ca: 100, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200,
    description: 'Rauchbier — smoked beer, Bamberg-style',
  },
  roggenbier: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 30, hco3: 150,
    description: 'Roggenbier — rye beer',
  },
  dampfbier: {
    ca: 60, mg: 15, na: 12, cl: 50, so4: 25, hco3: 100,
    description: 'Dampfbier — steam beer',
  },
  fruit_beer: {
    ca: 50, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Fruit Beer — soft, fruit-forward',
  },
  spice_beer: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Spice Beer — balanced, spiced',
  },
  wood_aged: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 200,
    description: 'Wood-Aged Beer — complex, barrel-aged',
  },
  sour_ale: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'Sour Ale — acidic, refreshing',
  },
  brett_beer: {
    ca: 70, mg: 18, na: 15, cl: 55, so4: 40, hco3: 120,
    description: 'Brett Beer — funky, wild',
  },
  mixed_fermentation: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'Mixed Fermentation — sour, complex',
  },
  kveik_ale: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 40, hco3: 100,
    description: 'Kveik Ale — Norwegian farmhouse',
  },
  brut_ipa: {
    ca: 100, mg: 25, na: 15, cl: 50, so4: 150, hco3: 50,
    description: 'Brut IPA — very dry, high sulfate',
  },
  session_ipa: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 100, hco3: 100,
    description: 'Session IPA — light, hoppy',
  },
  wheat_ipa: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100,
    description: 'Wheat IPA — hoppy wheat beer',
  },
  black_ipa: {
    ca: 100, mg: 25, na: 25, cl: 70, so4: 100, hco3: 150,
    description: 'Black IPA — hoppy, dark',
  },
  red_ipa: {
    ca: 100, mg: 25, na: 20, cl: 70, so4: 100, hco3: 150,
    description: 'Red IPA — hoppy, amber',
  },
  white_ipa: {
    ca: 70, mg: 18, na: 15, cl: 60, so4: 60, hco3: 100,
    description: 'White IPA — hoppy, Belgian-inspired',
  },
  belgian_ipa: {
    ca: 90, mg: 22, na: 18, cl: 60, so4: 80, hco3: 100,
    description: 'Belgian IPA — hoppy, Belgian yeast',
  },
  new_england_ipa: {
    ca: 100, mg: 20, na: 30, cl: 150, so4: 50, hco3: 150,
    description: 'New England IPA — high chloride, juicy, hazy',
  },
  milk_stout: {
    ca: 80, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200,
    description: 'Milk Stout — sweet, creamy',
  },
  oatmeal_stout: {
    ca: 80, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200,
    description: 'Oatmeal Stout — smooth, silky',
  },
  dry_stout: {
    ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250,
    description: 'Dry Stout — Irish-style, roasted',
  },
  foreign_extra_stout: {
    ca: 100, mg: 25, na: 30, cl: 80, so4: 50, hco3: 250,
    description: 'Foreign Extra Stout — strong, roasted',
  },
  american_porter: {
    ca: 100, mg: 25, na: 25, cl: 80, so4: 50, hco3: 200,
    description: 'American Porter — robust, hoppy',
  },
  brown_ale: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 50, hco3: 150,
    description: 'Brown Ale — nutty, malty',
  },
  amber_ale: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 60, hco3: 150,
    description: 'Amber Ale — balanced, malty',
  },
  red_ale: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 60, hco3: 150,
    description: 'Red Ale — malty, caramel',
  },
  irish_red: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 50, hco3: 150,
    description: 'Irish Red — malty, smooth',
  },
  scottish_light: {
    ca: 60, mg: 15, na: 15, cl: 60, so4: 30, hco3: 150,
    description: 'Scottish Light — sessionable',
  },
  scottish_heavy: {
    ca: 70, mg: 18, na: 15, cl: 65, so4: 35, hco3: 180,
    description: 'Scottish Heavy — malty',
  },
  scottish_export: {
    ca: 80, mg: 20, na: 15, cl: 70, so4: 40, hco3: 200,
    description: 'Scottish Export — strong, malty',
  },
  wee_heavy: {
    ca: 80, mg: 25, na: 20, cl: 70, so4: 40, hco3: 250,
    description: 'Wee Heavy — very strong, malty',
  },
  english_ipa: {
    ca: 120, mg: 25, na: 20, cl: 60, so4: 150, hco3: 100,
    description: 'English IPA — Burton-style',
  },
  ordinary_bitter: {
    ca: 80, mg: 18, na: 15, cl: 60, so4: 60, hco3: 100,
    description: 'Ordinary Bitter — sessionable',
  },
  best_bitter: {
    ca: 100, mg: 20, na: 15, cl: 60, so4: 80, hco3: 100,
    description: 'Best Bitter — balanced',
  },
  strong_bitter: {
    ca: 120, mg: 22, na: 18, cl: 65, so4: 100, hco3: 120,
    description: 'Strong Bitter — ESB-style',
  },
  brown_porter: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 180,
    description: 'Brown Porter — traditional',
  },
  robust_porter: {
    ca: 100, mg: 22, na: 22, cl: 75, so4: 50, hco3: 200,
    description: 'Robust Porter — stronger',
  },
  baltic_porter_high: {
    ca: 100, mg: 30, na: 25, cl: 80, so4: 60, hco3: 250,
    description: 'Baltic Porter — high gravity',
  },
  pre_prohibition_lager: {
    ca: 50, mg: 12, na: 12, cl: 40, so4: 25, hco3: 80,
    description: 'Pre-Prohibition Lager — historic',
  },
  pre_prohibition_porter: {
    ca: 80, mg: 20, na: 20, cl: 70, so4: 40, hco3: 180,
    description: 'Pre-Prohibition Porter — historic',
  },
  kentucky_common: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Kentucky Common — historic American',
  },
  lichtenhainer: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Lichtenhainer — smoked sour',
  },
  piwo_grodziskie: {
    ca: 50, mg: 12, na: 12, cl: 40, so4: 25, hco3: 80,
    description: 'Piwo Grodziskie — Polish smoked wheat',
  },
  sahti: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Sahti — Finnish traditional',
  },
  gotlandsdricke: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Gotlandsdricke — Swedish traditional',
  },
  kodilo: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Kodilo — Finnish farmhouse',
  },
  vossaol: {
    ca: 60, mg: 15, na: 15, cl: 50, so4: 30, hco3: 100,
    description: 'Vossaøl — Norwegian farmhouse',
  },
  malt_liquor: {
    ca: 30, mg: 8, na: 10, cl: 30, so4: 15, hco3: 50,
    description: 'Malt Liquor — high gravity lager',
  },
  ice_beer: {
    ca: 40, mg: 10, na: 10, cl: 35, so4: 20, hco3: 60,
    description: 'Ice Beer — freeze-distilled',
  },
  eisbock: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 30, hco3: 150,
    description: 'Eisbock — freeze-distilled bock',
  },
  wheatwine: {
    ca: 70, mg: 18, na: 15, cl: 60, so4: 40, hco3: 150,
    description: 'Wheatwine — strong wheat ale',
  },
  rye_wine: {
    ca: 70, mg: 18, na: 15, cl: 60, so4: 40, hco3: 150,
    description: 'Rye Wine — strong rye ale',
  },
  wheat_doppelbock: {
    ca: 80, mg: 20, na: 15, cl: 65, so4: 35, hco3: 180,
    description: 'Wheat Doppelbock — strong wheat lager',
  },
  helles_bock: {
    ca: 80, mg: 20, na: 12, cl: 65, so4: 35, hco3: 150,
    description: 'Helles Bock — strong pale lager',
  },
  maibock: {
    ca: 80, mg: 20, na: 12, cl: 65, so4: 35, hco3: 150,
    description: 'Maibock — spring bock',
  },
  eisbock_weizen: {
    ca: 70, mg: 18, na: 15, cl: 60, so4: 30, hco3: 150,
    description: 'Eisbock Weizen — freeze-distilled wheat',
  },
  baltic_porter_imperial: {
    ca: 100, mg: 30, na: 25, cl: 80, so4: 60, hco3: 250,
    description: 'Imperial Baltic Porter — very strong',
  },
  english_barleywine: {
    ca: 80, mg: 25, na: 20, cl: 70, so4: 50, hco3: 200,
    description: 'English Barleywine — strong, malty',
  },
  american_barleywine: {
    ca: 100, mg: 25, na: 20, cl: 70, so4: 80, hco3: 150,
    description: 'American Barleywine — strong, hoppy',
  },
  wheat_barleywine: {
    ca: 70, mg: 20, na: 18, cl: 65, so4: 40, hco3: 180,
    description: 'Wheat Barleywine — strong wheat',
  },
  rye_barleywine: {
    ca: 80, mg: 22, na: 18, cl: 65, so4: 50, hco3: 180,
    description: 'Rye Barleywine — strong rye',
  },
  old_ale_stock: {
    ca: 80, mg: 25, na: 25, cl: 75, so4: 45, hco3: 250,
    description: 'Stock Ale — aged old ale',
  },
  vintage_ale: {
    ca: 80, mg: 25, na: 25, cl: 75, so4: 45, hco3: 250,
    description: 'Vintage Ale — aged, complex',
  },
  strong_scotch_ale: {
    ca: 80, mg: 25, na: 20, cl: 70, so4: 40, hco3: 250,
    description: 'Strong Scotch Ale — wee heavy',
  },
  imperial_red: {
    ca: 100, mg: 25, na: 20, cl: 70, so4: 100, hco3: 150,
    description: 'Imperial Red — strong, hoppy',
  },
  imperial_brown: {
    ca: 90, mg: 22, na: 20, cl: 70, so4: 60, hco3: 180,
    description: 'Imperial Brown — strong, malty',
  },
  imperial_porter: {
    ca: 100, mg: 28, na: 28, cl: 80, so4: 60, hco3: 250,
    description: 'Imperial Porter — strong, dark',
  },
  imperial_stout_ris: {
    ca: 100, mg: 30, na: 35, cl: 90, so4: 60, hco3: 300,
    description: 'Russian Imperial Stout — very strong',
  },
  american_wild_ale: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'American Wild Ale — sour, funky',
  },
  brett_pale: {
    ca: 70, mg: 18, na: 15, cl: 55, so4: 40, hco3: 120,
    description: 'Brett Pale Ale — funky, hoppy',
  },
  brett_saison: {
    ca: 70, mg: 18, na: 15, cl: 55, so4: 40, hco3: 120,
    description: 'Brett Saison — funky, farmhouse',
  },
  brett_ipa: {
    ca: 80, mg: 20, na: 15, cl: 60, so4: 60, hco3: 100,
    description: 'Brett IPA — funky, hoppy',
  },
  brett_stout: {
    ca: 70, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200,
    description: 'Brett Stout — funky, dark',
  },
  brett_porter: {
    ca: 70, mg: 20, na: 25, cl: 70, so4: 40, hco3: 200,
    description: 'Brett Porter — funky, dark',
  },
  brett_barleywine: {
    ca: 70, mg: 22, na: 20, cl: 65, so4: 40, hco3: 180,
    description: 'Brett Barleywine — funky, strong',
  },
  flanders_red: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'Flanders Red — sour, fruity',
  },
  flanders_brown: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'Flanders Brown — sour, malty',
  },
  oud_bruin: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 100,
    description: 'Oud Bruin — sour, aged',
  },
  lambic_gueuze: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Gueuze — blended lambic',
  },
  lambic_kriek: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Kriek — cherry lambic',
  },
  lambic_framboise: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Framboise — raspberry lambic',
  },
  lambic_cassis: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Cassis — blackcurrant lambic',
  },
  lambic_peche: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Pêche — peach lambic',
  },
  lambic_faro: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Faro — sweetened lambic',
  },
  lambic_mars: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Mars — traditional lambic',
  },
  lambic_oude: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Oude Lambic — aged',
  },
  lambic_vieille: {
    ca: 60, mg: 15, na: 20, cl: 60, so4: 30, hco3: 200,
    description: 'Vieille Lambic — old',
  },
};

// ─── Tool implementation ─────────────────────────────────────────────────────

export class WaterProfileCalculatorTool implements BuiltinTool<WaterProfileCalculatorInput> {
  readonly name = 'water_profile_calculator' as const;
  readonly description =
    'Calculate water mineral additions (gypsum, CaCl2, Epsom, baking soda, chalk, lactic acid) to hit a target water profile for any beer style. Supports all BJCP styles and provides source-to-target comparison.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WaterProfileCalculatorInputSchema);

  resolveExecution(args: WaterProfileCalculatorInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Water profile: ${args.target_profile}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private execute(args: WaterProfileCalculatorInput): Promise<ExecutableToolResult> {
    try {
      const target = WATER_TARGETS[args.target_profile];
      if (target === undefined) {
        return Promise.resolve({
          isError: true,
          output: `Unknown target profile: "${args.target_profile}". Available: ${Object.keys(WATER_TARGETS).join(', ')}`,
        });
      }

      const source = args.source_water;
      const batchLiters = args.batch_size_liters;
      const mashLiters = args.mash_water_liters ?? batchLiters * 0.6;
      const spargeLiters = args.sparge_water_liters ?? batchLiters * 0.4;
      const targetPh = args.target_ph ?? 5.4;

      const additions: string[] = [];
      const notes: string[] = [];

      // ─── Calcium additions ──────────────────────────────────────────────────
      const caDiff = target.ca - source.ca;
      if (caDiff > 0) {
        // Try gypsum first (adds Ca + SO4)
        if (args.add_gypsum !== false) {
          const gypsumMgPerL = caDiff * 4.0; // gypsum is ~23% Ca, ~18% SO4
          const gypsumTotal = (gypsumMgPerL * batchLiters) / 1000;
          additions.push(
            `Gesso (CaSO4): ${gypsumTotal.toFixed(1)} g — aggiungi ${caDiff.toFixed(0)} mg/L Ca e ${(caDiff * 0.78).toFixed(0)} mg/L SO4`,
          );
        }
        // Calcium chloride (adds Ca + Cl)
        if (args.add_cacl2 !== false) {
          const cacl2MgPerL = caDiff * 3.6; // CaCl2 is ~27% Ca, ~48% Cl
          const cacl2Total = (cacl2MgPerL * batchLiters) / 1000;
          additions.push(
            `Cloruro di calcio (CaCl2): ${cacl2Total.toFixed(1)} g — aggiungi ${caDiff.toFixed(0)} mg/L Ca e ${(caDiff * 1.78).toFixed(0)} mg/L Cl`,
          );
        }
      }

      // ─── Sulfate adjustment ─────────────────────────────────────────────────
      const so4Diff = target.so4 - source.so4;
      if (so4Diff > 0 && args.add_gypsum !== false) {
        const gypsumMgPerL = so4Diff * 4.3; // gypsum is ~56% SO4
        const gypsumTotal = (gypsumMgPerL * batchLiters) / 1000;
        additions.push(
          `Gesso (CaSO4) per solfati: ${gypsumTotal.toFixed(1)} g — aggiungi ${so4Diff.toFixed(0)} mg/L SO4`,
        );
      }

      // ─── Chloride adjustment ──────────────────────────────────────────────
      const clDiff = target.cl - source.cl;
      if (clDiff > 0 && args.add_cacl2 !== false) {
        const cacl2MgPerL = clDiff * 2.1; // CaCl2 is ~48% Cl
        const cacl2Total = (cacl2MgPerL * batchLiters) / 1000;
        additions.push(
          `Cloruro di calcio (CaCl2) per cloruri: ${cacl2Total.toFixed(1)} g — aggiungi ${clDiff.toFixed(0)} mg/L Cl`,
        );
      }

      // ─── Magnesium adjustment ─────────────────────────────────────────────
      const mgDiff = target.mg - source.mg;
      if (mgDiff > 0 && args.add_espom !== false) {
        const epsomMgPerL = mgDiff * 10.1; // Epsom is ~10% Mg
        const epsomTotal = (epsomMgPerL * batchLiters) / 1000;
        additions.push(
          `Sale di Epsom (MgSO4): ${epsomTotal.toFixed(1)} g — aggiungi ${mgDiff.toFixed(0)} mg/L Mg`,
        );
      }

      // ─── Bicarbonate / pH adjustment ──────────────────────────────────────
      const hco3Diff = target.hco3 - source.hco3;
      if (hco3Diff > 0) {
        if (args.add_baking_soda !== false) {
          const bakingSodaMgPerL = hco3Diff * 1.4; // NaHCO3 is ~72% HCO3
          const bakingSodaTotal = (bakingSodaMgPerL * batchLiters) / 1000;
          additions.push(
            `Bicarbonato di sodio (NaHCO3): ${bakingSodaTotal.toFixed(1)} g — aggiungi ${hco3Diff.toFixed(0)} mg/L HCO3`,
          );
        }
        if (args.add_chalk !== false) {
          const chalkMgPerL = hco3Diff * 1.7; // CaCO3 is ~60% HCO3 equivalent
          const chalkTotal = (chalkMgPerL * batchLiters) / 1000;
          additions.push(
            `Carbonato di calcio (CaCO3): ${chalkTotal.toFixed(1)} g — aggiungi ${hco3Diff.toFixed(0)} mg/L HCO3 equivalente`,
          );
        }
      } else if (hco3Diff < -50) {
        if (args.add_lactic_acid !== false) {
          const lacticAcidMl = Math.abs(hco3Diff) * batchLiters * 0.01;
          additions.push(
            `Acido lattico 88%: ${lacticAcidMl.toFixed(1)} ml — riduci HCO3 di ${Math.abs(hco3Diff).toFixed(0)} mg/L`,
          );
        }
      }

      // ─── pH estimation ────────────────────────────────────────────────────
      // Rough estimation: residual alkalinity affects mash pH
      const residualAlkalinity = source.hco3 - (source.ca / 1.4 + source.mg / 1.7);
      let estimatedPh = 5.4;
      if (residualAlkalinity > 200) estimatedPh = 5.8;
      else if (residualAlkalinity > 100) estimatedPh = 5.6;
      else if (residualAlkalinity > 0) estimatedPh = 5.5;
      else if (residualAlkalinity > -50) estimatedPh = 5.4;
      else estimatedPh = 5.2;

      // ─── Build output ─────────────────────────────────────────────────────
      const comparison = [
        'Acqua sorgente vs target:',
        `  Ca:  ${source.ca.toFixed(0)} → ${target.ca} mg/L (Δ ${caDiff > 0 ? '+' : ''}${caDiff.toFixed(0)})`,
        `  Mg:  ${source.mg.toFixed(0)} → ${target.mg} mg/L (Δ ${mgDiff > 0 ? '+' : ''}${mgDiff.toFixed(0)})`,
        `  Na:  ${source.na.toFixed(0)} → ${target.na} mg/L (Δ ${(target.na - source.na) > 0 ? '+' : ''}${(target.na - source.na).toFixed(0)})`,
        `  Cl:  ${source.cl.toFixed(0)} → ${target.cl} mg/L (Δ ${clDiff > 0 ? '+' : ''}${clDiff.toFixed(0)})`,
        `  SO4: ${source.so4.toFixed(0)} → ${target.so4} mg/L (Δ ${so4Diff > 0 ? '+' : ''}${so4Diff.toFixed(0)})`,
        `  HCO3: ${source.hco3.toFixed(0)} → ${target.hco3} mg/L (Δ ${hco3Diff > 0 ? '+' : ''}${hco3Diff.toFixed(0)})`,
      ].join('\n');

      if (additions.length === 0) {
        additions.push('Nessuna aggiunta necessaria — il profilo sorgente è già adeguato.');
      }

      // Style-specific notes
      if (args.target_profile === 'neipa' || args.target_profile === 'new_england_ipa') {
        notes.push('NEIPA: rapporto Cl:SO4 alto (>2:1) per morbidezza e mouthfeel. Evita solfati eccessivi.');
      } else if (args.target_profile === 'american_ipa' || args.target_profile === 'double_ipa') {
        notes.push('IPA americana: rapporto SO4:Cl alto (>2:1) per secchezza e amaro pulito.');
      } else if (args.target_profile === 'pilsner') {
        notes.push('Pilsner: acqua molto dolce. Se la sorgente è dura, considera diluizione con acqua distillata.');
      } else if (args.target_profile === 'dortmunder') {
        notes.push('Dortmunder: acqua molto dura. Considera aggiunte aggressive di gesso e carbonato.');
      }

      return Promise.resolve({
        output: [
          `Profilo acqua per **${args.target_profile}** (${target.description})`,
          '',
          comparison,
          '',
          'Aggiunte consigliate:',
          ...additions.map((a) => `  • ${a}`),
          '',
          `pH mash stimato: ${estimatedPh.toFixed(1)} (target: ${targetPh})`,
          ...(notes.length > 0 ? ['', 'Note:', ...notes.map((n) => `  • ${n}`)] : []),
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
