/**
 * Fruit calculator — estimate fruit dosage for fruit beers.
 *
 * Computes a recommended dosage range (not an exact quantity) based on
 * fruit aromatic potency, fruit form, addition method, beer style, and
 * other fruits already present. Also estimates the theoretical alcohol
 * potential of the added fruit sugars and the water contributed by the
 * actual product.
 *
 * Important caveats (documented in the output as well):
 * - The intensity scale and aromatic factors are sensory heuristics,
 *   not calibrated instruments.
 * - Form conversion uses fruit-specific water/sugar data, not universal
 *   multipliers.
 * - Actual extraction yield depends on contact time, temperature,
 *   bag/loose fruit, and fruit ripeness.
 * - "Other fruits" reduction treats all fruits as sensory-equivalent to
 *   the main fruit — a simplification.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';

// ── Fruit database ───────────────────────────────────────────────────────────

interface FruitInfo {
  id: string;
  name: string;
  aliases: string[];
  factor: number;
  sugarPercent: number;
  waterPercent: number;
  ph: number;
  notes: string;
}

const FRUITS: FruitInfo[] = [
  { id: 'strawberry', name: 'Fragola', aliases: ['fragole', 'strawberry'], factor: 1.00, sugarPercent: 5, waterPercent: 91, ph: 3.5, notes: 'Riferimento. Aroma riconoscibile dai 50 g/L.' },
  { id: 'raspberry', name: 'Lampone', aliases: ['lamponi', 'raspberry'], factor: 0.70, sugarPercent: 4, waterPercent: 87, ph: 3.3, notes: 'Molto aromatico, serve meno.' },
  { id: 'blackberry', name: 'Mora', aliases: ['more', 'blackberry'], factor: 0.80, sugarPercent: 5, waterPercent: 88, ph: 3.4, notes: 'Buona persistenza. Semi fastidiosi.' },
  { id: 'blueberry', name: 'Mirtillo', aliases: ['mirtilli', 'blueberry'], factor: 1.20, sugarPercent: 10, waterPercent: 84, ph: 3.3, notes: 'Meno aromatico, serve più.' },
  { id: 'cranberry', name: 'Mirtillo rosso', aliases: ['cranberry', 'mirtilli rossi'], factor: 0.90, sugarPercent: 4, waterPercent: 87, ph: 2.5, notes: 'Molto acido. Attenzione pH.' },
  { id: 'redcurrant', name: 'Ribes rosso', aliases: ['ribes', 'redcurrant'], factor: 0.60, sugarPercent: 7, waterPercent: 82, ph: 2.7, notes: 'Molto aromatico. Ottimo in sour.' },
  { id: 'blackcurrant', name: 'Ribes nero', aliases: ['cassis', 'blackcurrant'], factor: 0.50, sugarPercent: 6, waterPercent: 82, ph: 2.8, notes: 'Fortissimo. 30 g/L bastano.' },
  { id: 'gooseberry', name: 'Uva spina', aliases: ['gooseberry'], factor: 0.80, sugarPercent: 5, waterPercent: 88, ph: 3.0, notes: 'Buona acidità.' },
  { id: 'sour_cherry', name: 'Amarena / visciola', aliases: ['amarene', 'visciola', 'sour cherry'], factor: 0.75, sugarPercent: 8, waterPercent: 82, ph: 3.3, notes: 'Classica italiana.' },
  { id: 'elderberry', name: 'Sambuco', aliases: ['elderberry'], factor: 0.60, sugarPercent: 7, waterPercent: 80, ph: 3.8, notes: 'Solo succo, no semi.' },
  { id: 'cherry', name: 'Ciliegia', aliases: ['ciliegie', 'cherry'], factor: 0.90, sugarPercent: 12, waterPercent: 82, ph: 3.7, notes: 'Marasche più intense.' },
  { id: 'peach', name: 'Pesca', aliases: ['pesche', 'peach'], factor: 1.00, sugarPercent: 9, waterPercent: 89, ph: 3.8, notes: 'Aroma delicato.' },
  { id: 'apricot', name: 'Albicocca', aliases: ['albicocche', 'apricot'], factor: 1.00, sugarPercent: 9, waterPercent: 86, ph: 3.7, notes: 'Varietà tardive più aromatiche.' },
  { id: 'plum', name: 'Prugna', aliases: ['prugne', 'susine', 'plum'], factor: 1.00, sugarPercent: 10, waterPercent: 87, ph: 3.5, notes: 'Varietà rosse miglior colore.' },
  { id: 'damson', name: 'Susina selvatica', aliases: ['damson'], factor: 0.80, sugarPercent: 8, waterPercent: 80, ph: 3.0, notes: 'Più acida della prugna.' },
  { id: 'mango', name: 'Mango', aliases: [], factor: 0.80, sugarPercent: 14, waterPercent: 83, ph: 4.0, notes: 'Perfetto in IPA.' },
  { id: 'pineapple', name: 'Ananas', aliases: [], factor: 0.80, sugarPercent: 10, waterPercent: 86, ph: 3.5, notes: 'Enzima bromelina.' },
  { id: 'passionfruit', name: 'Frutto della passione', aliases: ['passion fruit', 'maracuja', 'maracujá'], factor: 0.60, sugarPercent: 11, waterPercent: 73, ph: 3.0, notes: 'Molto aromatico.' },
  { id: 'guava', name: 'Guava', aliases: [], factor: 0.80, sugarPercent: 9, waterPercent: 81, ph: 3.8, notes: 'Aroma tropicale.' },
  { id: 'papaya', name: 'Papaya', aliases: [], factor: 1.00, sugarPercent: 8, waterPercent: 88, ph: 5.0, notes: 'Enzima papaina. pH alto.' },
  { id: 'coconut', name: 'Cocco', aliases: [], factor: 1.20, sugarPercent: 3, waterPercent: 47, ph: 6.0, notes: 'Tostato non zuccherato.' },
  { id: 'lychee', name: 'Lychee', aliases: ['litchi'], factor: 0.90, sugarPercent: 15, waterPercent: 82, ph: 4.5, notes: 'Floreale delicato.' },
  { id: 'blood_orange', name: 'Arancia rossa', aliases: ['tarocco', 'blood orange'], factor: 0.80, sugarPercent: 9, waterPercent: 87, ph: 3.5, notes: 'Succo + scorza.' },
  { id: 'grapefruit', name: 'Pompelmo rosa', aliases: ['pompelmo', 'grapefruit'], factor: 0.70, sugarPercent: 6, waterPercent: 90, ph: 3.2, notes: 'Amareggiante. Interagisce farmaci.' },
  { id: 'lemon_lime', name: 'Limone / lime', aliases: ['limone', 'lime', 'limoni'], factor: 0.50, sugarPercent: 2, waterPercent: 89, ph: 2.2, notes: 'ACIDO. Controllo pH.' },
  { id: 'pear', name: 'Pera', aliases: ['pere', 'pear'], factor: 1.10, sugarPercent: 10, waterPercent: 84, ph: 4.0, notes: 'Delicata. Williams.' },
  { id: 'apple', name: 'Mela', aliases: ['mele', 'apple'], factor: 1.10, sugarPercent: 10, waterPercent: 85, ph: 3.5, notes: 'Granny Smith, Pink Lady.' },
  { id: 'banana', name: 'Banana', aliases: ['banane'], factor: 0.80, sugarPercent: 12, waterPercent: 75, ph: 5.0, notes: 'Corpo e torbidità.' },
  { id: 'melon', name: 'Melone', aliases: [], factor: 1.30, sugarPercent: 8, waterPercent: 90, ph: 5.5, notes: 'Molto delicato.' },
  { id: 'watermelon', name: 'Anguria', aliases: ['anguria', 'watermelon', 'cocomero'], factor: 1.50, sugarPercent: 6, waterPercent: 91, ph: 5.3, notes: 'Acquosissima. Diluisce.' },
  { id: 'cucumber', name: 'Cetriolo', aliases: ['cetrioli', 'cucumber'], factor: 1.50, sugarPercent: 2, waterPercent: 95, ph: 5.5, notes: 'Acquoso.' },
  { id: 'pumpkin', name: 'Zucca', aliases: ['pumpkin'], factor: 1.30, sugarPercent: 3, waterPercent: 92, ph: 5.5, notes: 'Cuocere prima.' },
  { id: 'fig', name: 'Fico', aliases: ['fichi', 'fig'], factor: 0.90, sugarPercent: 16, waterPercent: 79, ph: 5.0, notes: 'Molto zuccherino.' },
  { id: 'date', name: 'Dattero', aliases: ['datteri', 'date'], factor: 0.70, sugarPercent: 63, waterPercent: 21, ph: 5.5, notes: 'Pastorizzare 30 min a 70°C.' },
  { id: 'grape_must', name: 'Uva (mosto)', aliases: ["mosto d'uva", 'grape must', 'uva'], factor: 1.00, sugarPercent: 16, waterPercent: 81, ph: 3.3, notes: 'Contributo alcolico.' },
];

// ── Intensity levels ─────────────────────────────────────────────────────────

interface IntensityLevel {
  label: string;
  description: string;
  minGL: number;
  maxGL: number;
  midGL: number;
}

const INTENSITIES: IntensityLevel[] = [
  { label: 'Accenno', description: 'Nota fruttata leggera sullo sfondo.', minGL: 20, maxGL: 50, midGL: 35 },
  { label: 'Leggero', description: 'Il frutto si sente ma non domina.', minGL: 50, maxGL: 100, midGL: 75 },
  { label: 'Medio', description: 'Frutto ben presente ed equilibrato.', minGL: 100, maxGL: 200, midGL: 150 },
  { label: 'Intenso', description: 'Frutto dominante. Fruit bomb.', minGL: 200, maxGL: 400, midGL: 300 },
  { label: 'Estremo', description: 'Massima intensità.', minGL: 400, maxGL: 800, midGL: 600 },
];

// ── Forms ────────────────────────────────────────────────────────────────────

interface FormInfo {
  label: string;
  notes: string;
}

const FORMS: Record<string, FormInfo> = {
  fresh: { label: 'Fresco / congelato / surgelato', notes: 'Surgelato rompe pareti cellulari.' },
  puree: { label: 'Purea sterile (es. Boiron)', notes: "99.9% frutta, pronta all'uso." },
  juice: { label: 'Succo 100%', notes: 'Diluisce più del fresco.' },
  concentrate: { label: 'Concentrato (65°Brix)', notes: 'Conversione: Brix frutto / 65.' },
  lyophilized: { label: 'Liofilizzato in polvere', notes: 'Conversione da solidi del frutto fresco.' },
  dried: { label: 'Essiccato / disidratato', notes: 'Conversione da solidi del frutto fresco.' },
};

// ── Addition methods ─────────────────────────────────────────────────────────

interface MethodInfo {
  label: string;
  efficiency: number;
}

const METHODS: Record<string, MethodInfo> = {
  secondary: { label: 'In fermentatore (post-fermentazione)', efficiency: 1.0 },
  whirlpool: { label: 'Whirlpool a caldo (80-95°C)', efficiency: 0.70 },
  end_boil: { label: 'Fine bollitura (ultimi 5 min)', efficiency: 0.50 },
  mash: { label: 'In mash', efficiency: 0.30 },
  tincture: { label: 'Tintura alcolica post-fermento', efficiency: 1.0 },
  keg: { label: 'In fusto / serving tank', efficiency: 1.0 },
};

// ── Beer style adjustments ───────────────────────────────────────────────────

const STYLE_ADJUSTMENTS: Record<string, { factor: number; notes: string }> = {
  sour: { factor: 0.85, notes: "Acidità amplifica il frutto." },
  ipa: { factor: 1.15, notes: 'Luppolo compete col frutto.' },
  stout: { factor: 1.30, notes: 'Tostatura maschera il frutto.' },
  wheat: { factor: 1.00, notes: 'Base neutra.' },
  blonde: { factor: 0.95, notes: 'Base pulita.' },
  saison: { factor: 1.05, notes: 'Fenoli interferiscono.' },
  belgian: { factor: 1.10, notes: 'Esteri competono.' },
  lager: { factor: 1.00, notes: 'Pulita.' },
  neipa: { factor: 1.10, notes: 'Luppoli tropicali.' },
  other: { factor: 1.00, notes: 'Nessuna correzione.' },
};

// ── Input schema ─────────────────────────────────────────────────────────────

export const FruitCalculatorInputSchema = z.object({
  fruit_name: z.string().describe('Nome del frutto principale in italiano.'),
  batch_size_liters: z.number().positive().describe("Volume birra PRIMA dell'aggiunta frutta (L)."),
  intensity: z.enum(['accenno', 'leggero', 'medio', 'intenso', 'estremo']).default('leggero'),
  fruit_form: z.enum(['fresh', 'puree', 'juice', 'concentrate', 'lyophilized', 'dried']).default('fresh'),
  addition_method: z.enum(['secondary', 'whirlpool', 'end_boil', 'mash', 'tincture', 'keg']).default('secondary'),
  beer_style: z.enum(['sour', 'ipa', 'stout', 'wheat', 'blonde', 'saison', 'belgian', 'lager', 'neipa', 'other']).default('other'),
  other_fruits_kg: z.number().nonnegative().default(0).describe('Altri frutti già presenti (kg freschi eq.).'),
  show_details: z.boolean().default(true),
});

export type FruitCalculatorInput = z.infer<typeof FruitCalculatorInputSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

function findFruit(raw: string): FruitInfo | undefined {
  const query = normalizeName(raw);
  const exact = FRUITS.find(f => f.id === query || normalizeName(f.name) === query || f.aliases.some(a => normalizeName(a) === query));
  if (exact) return exact;
  const candidates = FRUITS.filter(f => normalizeName(f.name).includes(query) || f.aliases.some(a => normalizeName(a).includes(query)));
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  return candidates.sort((a, b) => Math.abs(a.name.length - raw.length) - Math.abs(b.name.length - raw.length))[0];
}

/** Convert fresh-equivalent kg to actual product mass using fruit-specific data. */
function toProductKg(freshKg: number, fruit: FruitInfo, formKey: string): number {
  switch (formKey) {
    case 'fresh': case 'puree': case 'juice': return freshKg;
    case 'concentrate': {
      const brix = fruit.sugarPercent;
      if (brix <= 0 || brix >= 65) return freshKg;
      return freshKg * (brix / 65);
    }
    case 'lyophilized': {
      const solidsFresh = (100 - fruit.waterPercent) / 100;
      return solidsFresh <= 0 ? freshKg * 0.1 : freshKg * solidsFresh / 0.96;
    }
    case 'dried': {
      const solidsFresh = (100 - fruit.waterPercent) / 100;
      return solidsFresh <= 0 ? freshKg * 0.25 : freshKg * solidsFresh / 0.85;
    }
    default: return freshKg;
  }
}

function productWaterKg(productKg: number, fruit: FruitInfo, formKey: string): number {
  switch (formKey) {
    case 'fresh': case 'puree': case 'juice': return productKg * (fruit.waterPercent / 100);
    case 'concentrate': return productKg * 0.35;
    case 'lyophilized': return productKg * 0.04;
    case 'dried': return productKg * 0.15;
    default: return 0;
  }
}

function productSugarGrams(productKg: number, fruit: FruitInfo, formKey: string): number {
  switch (formKey) {
    case 'fresh': case 'puree': case 'juice': return productKg * 1000 * (fruit.sugarPercent / 100);
    case 'concentrate': return productKg * 1000 * 0.65;
    case 'lyophilized': case 'dried': {
      const solidsFresh = (100 - fruit.waterPercent) / 100;
      if (solidsFresh <= 0) return 0;
      return productKg * 1000 * (fruit.sugarPercent / 100 / solidsFresh);
    }
    default: return productKg * 1000 * (fruit.sugarPercent / 100);
  }
}

// ── Compute ─────────────────────────────────────────────────────────────────

function compute(input: FruitCalculatorInput) {
  const fruit = findFruit(input.fruit_name);
  if (!fruit) throw new Error(`Frutto "${input.fruit_name}" non trovato.`);

  const intensity = INTENSITIES.find(i => i.label.toLowerCase() === input.intensity)!;
  const method = METHODS[input.addition_method];
  const style = STYLE_ADJUSTMENTS[input.beer_style];

  const rawMin = intensity.minGL * fruit.factor * style.factor / method.efficiency;
  const rawMax = intensity.maxGL * fruit.factor * style.factor / method.efficiency;
  const rawMid = (rawMin + rawMax) / 2;

  let otherReduction = 0;
  let finalMin = rawMin, finalMax = rawMax, finalMid = rawMid;
  if (input.other_fruits_kg > 0) {
    const otherGL = (input.other_fruits_kg * 1000) / input.batch_size_liters;
    finalMin = Math.max(0, rawMin - otherGL);
    finalMax = Math.max(0, rawMax - otherGL);
    finalMid = Math.max(0, rawMid - otherGL);
    otherReduction = rawMid > 0 ? (rawMid - finalMid) / rawMid : 0;
  }

  const midFreshKg = (finalMid * input.batch_size_liters) / 1000;
  const midProductKg = toProductKg(midFreshKg, fruit, input.fruit_form);
  const sugarGrams = productSugarGrams(midProductKg, fruit, input.fruit_form);
  const waterLiters = productWaterKg(midProductKg, fruit, input.fruit_form);

  return { fruit, intensity, method, style, rangeMinGL: finalMin, rangeMaxGL: finalMax, midFreshGL: finalMid, midFreshKg, midProductKg, otherReduction, sugarGrams, waterLiters, form: input.fruit_form };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatResults(input: FruitCalculatorInput): string {
  const lines: string[] = [];
  lines.push(`# 🍓 Fruit Calculator: ${input.fruit_name} in ${input.batch_size_liters}L`);
  lines.push('');

  const fruit = findFruit(input.fruit_name);
  if (!fruit) {
    lines.push(`⚠️ "${input.fruit_name}" non trovato. Frutti disponibili:`);
    for (const f of FRUITS) lines.push(`- ${f.name} (×${f.factor.toFixed(2)})`);
    return lines.join('\n');
  }

  const calc = compute(input);
  const formInfo = FORMS[input.fruit_form];
  const methodInfo = METHODS[input.addition_method];
  const styleInfo = STYLE_ADJUSTMENTS[input.beer_style];

  lines.push('## 📊 Parametri');
  lines.push('');
  lines.push('| Parametro | Valore |');
  lines.push('|---|---|');
  lines.push(`| Frutto | **${calc.fruit.name}** |`);
  lines.push(`| Fattore aromatico | ×${calc.fruit.factor.toFixed(2)} |`);
  lines.push(`| Intensità | **${calc.intensity.label}** (${calc.intensity.minGL}–${calc.intensity.maxGL} g/L fresco eq.) |`);
  lines.push(`| Formato | ${formInfo.label} |`);
  lines.push(`| Metodo | ${methodInfo.label} (~${(methodInfo.efficiency * 100).toFixed(0)}% efficienza) |`);
  if (input.beer_style !== 'other') lines.push(`| Stile | ${input.beer_style} (×${styleInfo.factor.toFixed(2)}) |`);
  if (input.other_fruits_kg > 0) {
    const otherGL = (input.other_fruits_kg * 1000) / input.batch_size_liters;
    lines.push(`| Altri frutti | ${input.other_fruits_kg.toFixed(1)} kg (${otherGL.toFixed(0)} g/L) → -${(calc.otherReduction * 100).toFixed(0)}% sul principale |`);
  }
  lines.push('');

  lines.push('## 🎯 Intervallo di dosaggio consigliato');
  lines.push('');
  lines.push(`Per **${input.batch_size_liters}L** (volume prima della frutta):`);
  lines.push('');
  const minKg = toProductKg((calc.rangeMinGL * input.batch_size_liters) / 1000, calc.fruit, input.fruit_form);
  const maxKg = toProductKg((calc.rangeMaxGL * input.batch_size_liters) / 1000, calc.fruit, input.fruit_form);
  lines.push('| Formato | Min | Consigliato | Max |');
  lines.push('|---|---|---|---|');
  lines.push(`| **${formInfo.label}** | **${minKg.toFixed(2)} kg** | **${calc.midProductKg.toFixed(2)} kg** | **${maxKg.toFixed(2)} kg** |`);
  lines.push(`| Fresco equivalente | ${(calc.rangeMinGL * input.batch_size_liters / 1000).toFixed(2)} kg | ${calc.midFreshKg.toFixed(2)} kg | ${(calc.rangeMaxGL * input.batch_size_liters / 1000).toFixed(2)} kg |`);
  lines.push(`| g/L fresco eq. | ${calc.rangeMinGL.toFixed(0)} | ${calc.midFreshGL.toFixed(0)} | ${calc.rangeMaxGL.toFixed(0)} |`);
  lines.push('');
  lines.push("> ⚠️ Intervallo indicativo. Regola nelle cotte successive.");
  lines.push('');

  lines.push('## 🔄 In altri formati');
  lines.push('');
  lines.push('| Formato | Quantità consigliata |');
  lines.push('|---|---|');
  for (const [key, fi] of Object.entries(FORMS)) {
    if (key === input.fruit_form) continue;
    const qty = toProductKg(calc.midFreshKg, calc.fruit, key);
    lines.push(`| ${fi.label} | ${qty.toFixed(2)} kg |`);
  }
  lines.push('');

  // Tincture
  const lyoKg = toProductKg(calc.midFreshKg, calc.fruit, 'lyophilized');
  if (lyoKg > 0.001) {
    const lyoG = Math.round(lyoKg * 1000);
    const alcMl = Math.round(lyoG * 1.3);
    const alcAbv = alcMl * 0.95 / 1000 / (input.batch_size_liters + alcMl / 1000) * 100;
    lines.push('## 🧪 Ricetta tintura alcolica');
    lines.push('');
    lines.push(`- Liofilizzato ${calc.fruit.name}: **${lyoG} g**`);
    lines.push(`- Alcool 90-95°: **${alcMl} mL** (7-14gg al buio, filtrare)`);
    lines.push(`- ⚠️ L'alcool aggiunge ~${alcAbv.toFixed(1)} punti ABV`);
  }
  lines.push('');

  // ABV & dilution
  if (input.show_details) {
    const sugarG = calc.sugarGrams;
    const ethanolML = sugarG * 0.51 / 0.789;
    const potentialAbv = (input.batch_size_liters + calc.waterLiters) > 0 ? (ethanolML / 1000 / (input.batch_size_liters + calc.waterLiters)) * 100 : 0;

    lines.push('## 📈 Impatto sulla birra (stima)');
    lines.push('');
    lines.push('| Parametro | Valore |');
    lines.push('|---|---|');
    lines.push(`| Zuccheri aggiunti | ~${sugarG.toFixed(0)} g`);
    lines.push(`| Potenziale alcolico teorico | ~+${potentialAbv.toFixed(1)}% ABV (solo zuccheri frutto) |`);
    if (calc.waterLiters > 0.05) lines.push(`| Acqua aggiunta (prodotto reale) | ~${calc.waterLiters.toFixed(1)} L`);
    else lines.push('| Acqua aggiunta | Trascurabile');
    lines.push(`| pH frutto | ~${calc.fruit.ph}`);
    if (calc.fruit.ph < 3.2) lines.push('| ⚠️ pH | Molto acido. Misurare dopo aggiunta.');
    if (calc.fruit.ph > 4.5) lines.push('| ⚠️ pH | > 4.5. RISCHIO CONTAMINAZIONE. Pastorizzare.');
    lines.push('');
    lines.push("> Il potenziale alcolico è solo degli zuccheri del frutto. L'ABV finale dipende anche da ABV iniziale e perdite. Con frutti acquosi l'ABV può SCENDERE.");
    lines.push('');
  }

  // Processing notes
  if (input.show_details) {
    lines.push('## 🔧 Note di processo');
    lines.push('');
    if (calc.fruit.ph > 4.5) lines.push("- ⚠️ Pastorizzare 70°C × 30 min prima dell'aggiunta.");
    if (['Lampone', 'Mora', 'Fragola'].includes(calc.fruit.name)) lines.push('- Rimuovere semi dopo 5-7gg (astringenza).');
    if (['Mela', 'Pera', 'Prugna', 'Ribes rosso', 'Ribes nero', 'Mirtillo'].includes(calc.fruit.name)) lines.push('- Aggiungere pectinasi 2-3 g/hL.');
    if (input.fruit_form === 'lyophilized') lines.push("- Reidratare in acqua tiepida. La liofilizzazione NON garantisce sterilità.");
    if (input.fruit_form === 'fresh') lines.push('- Surgelare/scongelare. Pastorizzare 70°C × 15 min o metabisolfito.');
    lines.push('- Usare hop bag per contenere la polpa.');
    lines.push('- Aspettare FG stabile dopo aggiunta prima di imbottigliare.');
    lines.push('');
  }

  // Full intensity table
  lines.push('## 📋 Tabella per tutte le intensità');
  lines.push('');
  lines.push(`| Intensità | g/L fresco eq. | ${formInfo.label} |`);
  lines.push('|---|---|---|');
  for (const int of INTENSITIES) {
    const rMin = int.minGL * fruit.factor * styleInfo.factor / methodInfo.efficiency;
    const rMax = int.maxGL * fruit.factor * styleInfo.factor / methodInfo.efficiency;
    const rMid = (rMin + rMax) / 2;
    const oGL = input.other_fruits_kg > 0 ? (input.other_fruits_kg * 1000) / input.batch_size_liters : 0;
    const mid = Math.max(0, rMid - oGL);
    const kg = toProductKg((mid * input.batch_size_liters) / 1000, fruit, input.fruit_form);
    lines.push(`| ${int.label} | ${mid.toFixed(0)} | **${kg.toFixed(2)} kg** |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('*Euristiche sensoriali. Regola in base ai tuoi risultati.*');

  return lines.join('\n');
}

// ── Tool ─────────────────────────────────────────────────────────────────────

const FRUIT_CALCULATOR_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    fruit_name: { type: 'string', description: 'Nome frutto in italiano.' },
    batch_size_liters: { type: 'number', exclusiveMinimum: 0, description: 'Volume birra prima della frutta (L).' },
    intensity: { type: 'string', enum: ['accenno', 'leggero', 'medio', 'intenso', 'estremo'], default: 'leggero' },
    fruit_form: { type: 'string', enum: ['fresh', 'puree', 'juice', 'concentrate', 'lyophilized', 'dried'], default: 'fresh' },
    addition_method: { type: 'string', enum: ['secondary', 'whirlpool', 'end_boil', 'mash', 'tincture', 'keg'], default: 'secondary' },
    beer_style: { type: 'string', enum: ['sour', 'ipa', 'stout', 'wheat', 'blonde', 'saison', 'belgian', 'lager', 'neipa', 'other'], default: 'other' },
    other_fruits_kg: { type: 'number', minimum: 0, default: 0 },
    show_details: { type: 'boolean', default: true },
  },
  required: ['fruit_name', 'batch_size_liters'],
  additionalProperties: false,
};

export class FruitCalculatorTool implements BuiltinTool<FruitCalculatorInput> {
  readonly name = 'fruit_calculator' as const;
  readonly description = "Stima il dosaggio di frutta per fruit beers (intervallo, non quantità esatta). Conversione tra formati specifica per frutto.";
  readonly parameters = FRUIT_CALCULATOR_PARAMETERS;

  resolveExecution(args: FruitCalculatorInput): ToolExecution {
    return {
      description: `Fruit calc: ${args.fruit_name} @ ${args.intensity}`,
      approvalRule: this.name,
      execute: () => {
        try { return Promise.resolve({ output: formatResults(args) }); }
        catch (e) { return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) }); }
      },
    };
  }
}

registerTool(FruitCalculatorTool);
