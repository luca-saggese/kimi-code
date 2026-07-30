/**
 * Tincture calculator — plan alcoholic tinctures for brewing.
 *
 * Computes the solvent recipe (alcohol 95° + water → target ABV), the
 * ingredient-to-solvent ratio, extraction time, preparation and filtration
 * steps, a bench-trial dosing protocol, and an estimated batch dose with
 * alcohol contribution. Also flags safety concerns for risky botanicals.
 *
 * Covers: hops, woods, seed spices, bark/root spices, fresh herbs, dried
 * herbs/flowers, citrus peels, chili, coffee, cocoa, vanilla, and fruit.
 *
 * ⚠️ A tincture is NOT a replacement for dry hopping. It is a corrective,
 * experimental, or blending tool. The bench trial is MANDATORY — the tool
 * will not compute a batch dose without test-sample parameters.
 *
 * Important caveats: extraction kinetics vary enormously with cultivar, lot,
 * particle size, roast level, and storage age. The preset ratios are
 * starting points, not guarantees. Always bench-trial before dosing a batch.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';

// ── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES = [
    'hop',
    'wood',
    'seed_spice',
    'bark_root',
    'fresh_herb',
    'dried_herb',
    'citrus_peel',
    'chili',
    'coffee',
    'cacao',
    'vanilla',
    'fruit',
    'other',
] as const;

type Category = (typeof CATEGORIES)[number];

// ── Ingredient states ────────────────────────────────────────────────────────

const INGREDIENT_STATES = [
    'fresh',
    'dried',
    'pellet',
    'whole',
    'ground',
    'crushed',
    'chips',
    'cubes',
] as const;

type IngredientState = (typeof INGREDIENT_STATES)[number];

// ── Preset database ──────────────────────────────────────────────────────────

interface CategoryPreset {
    /** Default target ABV range [min, max]. */
    abvRange: [number, number];
    /** Default recommended target ABV. */
    abvRecommended: number;
    /** Ingredient-to-solvent ratio range [min, max] as g ingredient per mL solvent. */
    ratioRange: [number, number];
    /** Recommended ratio. */
    ratioRecommended: number;
    /** Recommended extraction time range. */
    timeRange: string;
    /** Recommended extraction temperature range. */
    tempRange: string;
    /** Extraction temperature in °C (midpoint for calculations). */
    tempC: number;
    /** Any special notes for the category. */
    notes: string;
    /** Whether the ingredient contains fermentable sugars. */
    hasFermentables: boolean;
    /** Human-readable category label in Italian. */
    label: string;
}

const CATEGORY_PRESETS: Record<string, CategoryPreset> = {
    hop: {
        abvRange: [45, 55],
        abvRecommended: 50,
        ratioRange: [1 / 12, 1 / 8],
        ratioRecommended: 1 / 10,
        timeRange: '12–48 ore',
        tempRange: '4–15 °C',
        tempC: 10,
        notes: 'Usare pellet freschi. Minima esposizione all\'aria. Conservare al freddo e al buio. NON sostituisce il dry hopping.',
        hasFermentables: false,
        label: 'Luppolo',
    },
    hop_cold_short: {
        abvRange: [60, 70],
        abvRecommended: 65,
        ratioRange: [1 / 10, 1 / 10],
        ratioRecommended: 1 / 10,
        timeRange: '4–12 ore',
        tempRange: '0–8 °C',
        tempC: 4,
        notes: 'Tecnica sperimentale. Estrazione breve e fredda — più selettiva sugli oli, meno sulle resine. Non garantisce assenza di amaro.',
        hasFermentables: false,
        label: 'Luppolo (estrazione breve/fredda)',
    },
    wood: {
        abvRange: [45, 65],
        abvRecommended: 55,
        ratioRange: [1 / 10, 1 / 4],
        ratioRecommended: 1 / 7,
        timeRange: '3–42 giorni (chips: 3–14, cubes: 14–42)',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Solo legno certificato alimentare. Mai legno da falegnameria. 40-50%: più tannino/legnosità. 55-65%: più vanillina/oak lactones.',
        hasFermentables: false,
        label: 'Legno',
    },
    seed_spice: {
        abvRange: [45, 60],
        abvRecommended: 50,
        ratioRange: [1 / 15, 1 / 8],
        ratioRecommended: 1 / 10,
        timeRange: '12 ore – 7 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Schiacciare grossolanamente, NON polverizzare. L\'aumento estremo della superficie estrae note resinose/medicinali.',
        hasFermentables: false,
        label: 'Spezie-seme',
    },
    bark_root: {
        abvRange: [50, 70],
        abvRecommended: 60,
        ratioRange: [1 / 15, 1 / 8],
        ratioRecommended: 1 / 10,
        timeRange: '3–21 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Cannella di Ceylon preferita alla cassia (più delicata). Genziana: usare 2-5g, dosare a gocce. Liquirizia: aumenta dolcezza percepita.',
        hasFermentables: false,
        label: 'Corteccia/radice',
    },
    fresh_herb: {
        abvRange: [55, 70],
        abvRecommended: 65,
        ratioRange: [1 / 5, 1 / 2],
        ratioRecommended: 1 / 3,
        timeRange: '4–48 ore',
        tempRange: '4–15 °C',
        tempC: 10,
        notes: 'Le erbe fresche contengono molta acqua → la gradazione effettiva finale sarà inferiore. Rosmarino/salvia: possono diventare canforati/medicinali. Controllare già dopo 4–6 ore.',
        hasFermentables: false,
        label: 'Erbe fresche',
    },
    dried_herb: {
        abvRange: [35, 55],
        abvRecommended: 45,
        ratioRange: [1 / 25, 1 / 10],
        ratioRecommended: 1 / 15,
        timeRange: '6 ore – 7 giorni (fiori delicati: 6–48 ore)',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Lavanda: estremamente facile da sovradosare (può ricordare sapone). Ibisco: usare 25-40% ABV per estrarre colore e acidità. Fiori delicati: 40-50%, rapporto 1:15-1:25.',
        hasFermentables: false,
        label: 'Erbe essiccate / fiori',
    },
    citrus_peel: {
        abvRange: [60, 75],
        abvRecommended: 70,
        ratioRange: [1 / 15, 1 / 3],
        ratioRecommended: 1 / 6,
        timeRange: '12 ore – 7 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Solo scorze NON trattate, senza cere. Ridurre al minimo l\'albedo (amaro, pectina, astringenza). Preparare agrumi diversi separatamente.',
        hasFermentables: false,
        label: 'Scorze agrumi',
    },
    chili: {
        abvRange: [60, 75],
        abvRecommended: 70,
        ratioRange: [1 / 30, 1 / 10],
        ratioRecommended: 1 / 20,
        timeRange: '6 ore – 7 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Usare guanti. La capsaicina è molto solubile in etanolo. NON assaggiare la tintura pura. Dose iniziale: 1 goccia in 100 mL. Registrare varietà, lotto, peso, placenta, semi.',
        hasFermentables: false,
        label: 'Peperoncino',
    },
    coffee: {
        abvRange: [20, 40],
        abvRecommended: 30,
        ratioRange: [1 / 10, 1 / 5],
        ratioRecommended: 1 / 7,
        timeRange: '12–48 ore',
        tempRange: '4–15 °C',
        tempC: 10,
        notes: 'Macinatura grossolana. Troppa acqua, tempo lungo o macinatura fine → amaro, astringenza. Il cold brew concentrato con sola acqua dà spesso risultati migliori, ma la tintura idroalcolica ha maggiore stabilità.',
        hasFermentables: false,
        label: 'Caffè',
    },
    cacao: {
        abvRange: [45, 60],
        abvRecommended: 50,
        ratioRange: [1 / 6, 1 / 3],
        ratioRecommended: 1 / 4,
        timeRange: '5–21 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'I nibs contengono grassi: la tintura può diventare torbida/oleosa. Filtrare, raffreddare 24-48h, rimuovere strato grasso, rifiltrare su carta.',
        hasFermentables: false,
        label: 'Cacao',
    },
    vanilla: {
        abvRange: [40, 60],
        abvRecommended: 50,
        ratioRange: [1 / 100, 1 / 50],
        ratioRecommended: 1 / 75,
        timeRange: '14–60 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Aprire longitudinalmente, raschiare semi, inserire semi + baccello. Agitare periodicamente. La vaniglia evolve lentamente e tollera estrazioni lunghe.',
        hasFermentables: false,
        label: 'Vaniglia',
    },
    fruit: {
        abvRange: [60, 75],
        abvRecommended: 70,
        ratioRange: [1 / 2, 1 / 1],
        ratioRecommended: 1 / 1.5,
        timeRange: '3–14 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'La frutta contiene molta acqua → la gradazione finale scenderà. Contiene zuccheri fermentabili. Per molte birre è meglio purea asettica o succo. La tintura ha senso per scorze, frutti di bosco aromatici, ciliegie essiccate, bucce.',
        hasFermentables: true,
        label: 'Frutta',
    },
    other: {
        abvRange: [40, 60],
        abvRecommended: 50,
        ratioRange: [1 / 15, 1 / 5],
        ratioRecommended: 1 / 10,
        timeRange: '3–14 giorni',
        tempRange: '15–22 °C',
        tempC: 18,
        notes: 'Categoria generica. Usare con cautela: verificare sempre la sicurezza alimentare dell\'ingrediente.',
        hasFermentables: false,
        label: 'Altro',
    },
};

// ── Safety warnings ──────────────────────────────────────────────────────────

interface SafetyWarnings {
    ingredient: string;
    warnings: string[];
}

const SAFETY_WARNINGS: SafetyWarnings[] = [
    { ingredient: 'calamo', warnings: ['⚠️ Il calamo aromatico (Acorus calamus) contiene β-asarone, potenzialmente cancerogeno. Vietato come alimento in UE e USA. NON USARE.'] },
    { ingredient: 'genziana', warnings: ['⚠️ Estremamente amara. Usare massimo 2-5g. Dosare a gocce. Non trattare come spezia aromatica normale.'] },
    { ingredient: 'zenzero', warnings: ['⚠️ Lo zenzero fresco contiene molta acqua e diluisce il solvente. Preferire essiccato per maggiore controllo.'] },
    { ingredient: 'salvia', warnings: ['⚠️ Può diventare canforata, medicinale, amara rapidamente. Controllare dopo 4-6 ore.'] },
    { ingredient: 'rosmarino', warnings: ['⚠️ Può diventare canforato, medicinale, amaro rapidamente. Controllare dopo 4-6 ore.'] },
    { ingredient: 'lavanda', warnings: ['⚠️ Estremamente facile da sovradosare — può ricordare sapone o deodorante. Usare rapporto molto diluito (1:15-1:25).'] },
    { ingredient: 'peperoncino', warnings: ['⚠️ NON assaggiare la tintura pura. Usare guanti. La capsaicina è estremamente solubile in etanolo.'] },
    { ingredient: 'sambuco', warnings: ['⚠️ NON usare bacche/semi di sambuco crudi (contengono cianuro). Solo fiori o bacche cotte.'] },
    { ingredient: 'assenzio', warnings: ['⚠️ L\'assenzio (Artemisia absinthium) contiene tujone, regolamentato in molti paesi. Verificare limiti legali.'] },
    { ingredient: 'noce moscata', warnings: ['⚠️ La noce moscata contiene miristicina. In dosi elevate (>5g) può causare effetti tossici. Mantenere dosi basse.'] },
    { ingredient: 'fava tonka', warnings: ['⚠️ La fava tonka contiene cumarina. Vietata come ingrediente alimentare in USA. Limitata in UE (tracce). Valutare legalità.'] },
    { ingredient: 'ginepro', warnings: ['⚠️ Il ginepro contiene oli essenziali che in grandi quantità possono essere irritanti. Schiacciare leggermente, non polverizzare.'] },
];

function getSafetyWarnings(ingredient: string, category: Category): string[] {
    const nameLower = ingredient.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const warnings: string[] = [];

    for (const sw of SAFETY_WARNINGS) {
        const swLower = sw.ingredient.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
        if (nameLower.includes(swLower) || swLower.includes(nameLower)) {
            warnings.push(...sw.warnings);
        }
    }

    // Generic safety notes by category
    if (category === 'wood') {
        warnings.push('⚠️ Usare SOLO legno certificato per contatto alimentare. Mai legno da falegnameria, trattato, verniciato o non tracciato.');
    }
    if (category === 'citrus_peel') {
        warnings.push('⚠️ Usare SOLO scorze non trattate, senza cere fungicide. Ridurre al minimo l\'albedo bianco.');
    }
    if (category === 'other') {
        warnings.push('⚠️ Categoria generica: verificare che l\'ingrediente sia certificato per uso alimentare. Non usare piante raccolte senza identificazione botanica certa.');
    }

    // Deduplicate while preserving order
    return [...new Set(warnings)];
}

// ── Alcohol dilution ─────────────────────────────────────────────────────────

/**
 * Compute the volume of 95° alcohol and water needed to produce `targetVolumeMl`
 * of solvent at `targetAbvPercent`.
 *
 * V_source = (ABV_target / ABV_source) × V_target
 * Water then fills to target volume.
 *
 * Note: water–ethanol volumes are not perfectly additive; this is an
 * approximation. Best practice: pour alcohol first, add water, then top up
 * to final volume.
 */
function computeDilution(
    sourceAbvPercent: number,
    targetAbvPercent: number,
    targetVolumeMl: number,
): { alcoholMl: number; waterMl: number } {
    const alcoholMl = (targetAbvPercent / sourceAbvPercent) * targetVolumeMl;
    const waterMl = targetVolumeMl - alcoholMl;
    return {
        alcoholMl: Math.round(alcoholMl * 10) / 10,
        waterMl: Math.round(waterMl * 10) / 10,
    };
}

// ── Compute solvent volume from ratio ────────────────────────────────────────

function solventVolumeFromRatio(ingredientWeightG: number, ratio: number): number {
    // ratio is g ingredient per mL solvent, e.g. 1/10 = 0.1
    // solvent_ml = ingredient_g / ratio
    if (ratio <= 0) return 0;
    return Math.round(ingredientWeightG / ratio);
}

// ── Input schema ─────────────────────────────────────────────────────────────

export const TinctureCalculatorInputSchema = z.object({
    ingredient: z.string().trim().min(1).describe('Nome dell\'ingrediente (es. "Luppolo Citra", "Quercia francese", "Coriandolo").'),
    category: z.enum(CATEGORIES).describe('Categoria dell\'ingrediente. Determina i preset di estrazione.'),
    ingredient_weight_g: z.number().positive().describe('Peso dell\'ingrediente in grammi.'),
    ingredient_state: z.enum(INGREDIENT_STATES).describe('Stato fisico dell\'ingrediente (fresh, dried, pellet, whole, ground, crushed, chips, cubes).'),
    source_abv_percent: z.number().min(1).max(100).default(95).describe('Gradazione dell\'alcol di partenza (95° in Italia).'),
    target_abv_percent: z.number().min(1).max(100).optional().describe('Gradazione target della tintura. Se omesso, usa il preset della categoria.'),
    solvent_volume_ml: z.number().positive().optional().describe('Volume di solvente in mL. Se omesso, calcolato dal rapporto ingrediente/solvente.'),
    extraction_time_days: z.number().positive().optional().describe('Tempo di estrazione in giorni. Se omesso, usa il preset della categoria.'),
    extraction_temp_c: z.number().min(0).max(40).optional().describe('Temperatura di estrazione in °C. Se omesso, usa il preset della categoria.'),
    beer_volume_l: z.number().positive().optional().describe('Volume effettivo della birra nel fermentatore/keg (L).'),
    test_sample_ml: z.number().positive().optional().describe('Volume campione per bench trial (es. 100 mL).'),
    test_dose_ml: z.number().positive().optional().describe('Dose scelta nel campione (mL). Da cui calcolare la dose batch.'),
    /** For hops: use the cold/short extraction variant. */
    hop_variant: z.enum(['standard', 'cold_short']).optional().describe('Per luppolo: "standard" (45-55%, 12-48h) o "cold_short" (60-70%, 4-12h).'),
    /** For fresh herbs: the estimated water content of the herb (g water / 100g fresh). */
    herb_water_percent: z.number().min(0).max(100).optional().describe('Per erbe fresche: contenuto d\'acqua (g/100g), stima la diluizione del solvente.'),
    /** For fruit: estimated sugar content for fermentability warning. */
    fruit_sugar_percent: z.number().min(0).max(100).optional().describe('Per frutta: zuccheri g/100g. Usato per avviso fermentabili.'),
    /** Explicitly set the ingredient-to-solvent ratio (overrides preset). */
    custom_ratio: z.number().positive().optional().describe('Rapporto ingrediente/solvente personalizzato (g/mL). Sovrascrive il preset.'),
    show_details: z.boolean().default(true).describe('Mostra la guida completa e i dettagli.'),
}).refine((input) => {
    // Require test parameters if batch dosing is requested
    if (input.beer_volume_l !== undefined) {
        if (input.test_sample_ml === undefined || input.test_dose_ml === undefined) {
            return false;
        }
    }
    return true;
}, {
    message: 'Per calcolare la dose batch servono test_sample_ml e test_dose_ml (bench trial).',
    path: ['beer_volume_l'],
});

export type TinctureCalculatorInput = z.infer<typeof TinctureCalculatorInputSchema>;

// ── Output type ──────────────────────────────────────────────────────────────

export interface TincturePlan {
    ingredient: string;
    categoryLabel: string;
    category: Category;
    targetAbvPercent: number;
    alcohol95Ml: number;
    waterMl: number;
    solventVolumeMl: number;
    ingredientWeightG: number;
    ingredientToSolventRatio: string;
    extractionTime: string;
    extractionTempC: number;
    preparation: string[];
    agitation: string;
    filtration: string[];
    benchTrial: {
        doseLowMlPer100ml: number;
        doseMidMlPer100ml: number;
        doseHighMlPer100ml: number;
        samples: { sample: string; doseMl: number }[];
    };
    estimatedBatchDoseMl: number | null;
    alcoholContributionAbv: number | null;
    hasFermentables: boolean;
    effectiveAbvPercent: number | null;
    warnings: string[];
}

// ── Compute ──────────────────────────────────────────────────────────────────

function compute(input: TinctureCalculatorInput): TincturePlan {
    // Resolve category preset key
    const presetKey = input.category === 'hop' && input.hop_variant === 'cold_short'
        ? 'hop_cold_short'
        : input.category;

    const preset = CATEGORY_PRESETS[presetKey] ?? CATEGORY_PRESETS.other;
    if (!preset) {
        throw new Error(`Categoria "${presetKey}" non trovata nei preset.`);
    }

    // Resolve target ABV
    const targetAbv = input.target_abv_percent ?? preset.abvRecommended;

    // Resolve ingredient-to-solvent ratio
    const ratio = input.custom_ratio ?? preset.ratioRecommended;

    // Resolve solvent volume
    const solventMl = input.solvent_volume_ml ?? solventVolumeFromRatio(input.ingredient_weight_g, ratio);

    // Compute dilution
    const { alcoholMl, waterMl } = computeDilution(input.source_abv_percent, targetAbv, solventMl);

    // Resolve extraction time
    const extractionDays = input.extraction_time_days;
    const extractionTimeHours = extractionDays ? extractionDays * 24 : undefined;
    let extractionTime: string;
    if (extractionDays) {
        if (extractionDays < 1) {
            extractionTime = `${Math.round(extractionDays * 24)} ore`;
        } else if (extractionDays < 14) {
            extractionTime = `${extractionDays} giorni`;
        } else {
            extractionTime = `${extractionDays} giorni (${Math.round(extractionDays / 7)} settimane)`;
        }
    } else {
        extractionTime = preset.timeRange;
    }

    // Resolve temperature
    const tempC = input.extraction_temp_c ?? preset.tempC;

    // Build ingredient-to-solvent ratio string
    const actualRatio = input.ingredient_weight_g / solventMl;
    const ratioLabel = `1:${Math.round(1 / actualRatio)} (${input.ingredient_weight_g}g / ${solventMl}mL → ${(actualRatio * 100).toFixed(1)} g/100mL)`;

    // ── Preparation steps ──
    const preparation: string[] = [
        `Pesare ${input.ingredient_weight_g}g di ${input.ingredient} (${preset.label}).`,
    ];

    // State-specific prep
    switch (input.ingredient_state) {
        case 'fresh':
            preparation.push('Lavare solo se necessario, asciugare perfettamente.');
            preparation.push('Eliminare parti danneggiate.');
            break;
        case 'dried':
            preparation.push('NON polverizzare: schiacciare o spezzare solo quanto necessario.');
            break;
        case 'pellet':
            preparation.push('Non macinare ulteriormente i pellet.');
            break;
        case 'whole':
            preparation.push('Spezzare o schiacciare leggermente per aumentare la superficie.');
            break;
        case 'ground':
            preparation.push('Usare macinatura grossolana. Evitare polveri fini (sovraestrazione).');
            break;
        case 'crushed':
            preparation.push('Schiacciatura grossolana — sufficiente per superficie senza polveri.');
            break;
        case 'chips':
            preparation.push('Non serve ulteriore preparazione. I chips hanno già superficie adeguata.');
            break;
        case 'cubes':
            preparation.push('Non serve ulteriore preparazione. I cubes estraggono più lentamente dei chips.');
            break;
    }

    // Category-specific prep
    switch (input.category) {
        case 'vanilla':
            preparation.push('Aprire il baccello longitudinalmente, raschiare i semi con la lama.');
            preparation.push('Inserire sia i semi che il baccello nel solvente.');
            break;
        case 'citrus_peel':
            preparation.push('Rimuovere il più possibile l\'albedo bianco (amaro, pectina).');
            preparation.push('Usare solo la scorza colorata (zest).');
            break;
        case 'chili':
            preparation.push('⚠️ Indossare guanti. Rimuovere parte della placenta per ridurre piccantezza.');
            preparation.push('Preparare varietà differenti in contenitori separati.');
            break;
        case 'coffee':
            preparation.push('Usare macinatura GROSSOLANA (french press). Mai fine (espresso).');
            break;
        case 'cacao':
            preparation.push('Se i nibs non sono tostati, tostarli leggermente prima (150°C × 10 min).');
            break;
        case 'fresh_herb':
            preparation.push('Non triturare finemente. Lasciare le foglie intere o leggermente spezzate.');
            break;
    }

    // Solvent prep
    preparation.push(`Preparare il solvente: ${alcoholMl} mL di alcol a ${input.source_abv_percent}° + ${waterMl} mL di acqua demineralizzata → ${solventMl} mL al ${targetAbv}%.`);
    preparation.push('Versare PRIMA l\'alcol, POI l\'acqua, quindi portare a volume finale (i volumi non sono additivi).');
    preparation.push('Usare ESCLUSIVAMENTE alcol alimentare non denaturato e acqua demineralizzata/osmotizzata/bollita.');
    preparation.push('Inserire ingrediente e solvente in un contenitore di VETRO sanificato.');
    preparation.push('Chiudere ermeticamente con tappo resistente all\'alcol.');
    preparation.push(`Conservare al buio a ${tempC}°C circa.`);

    // Agitation
    const agitation = 'Agitare delicatamente una volta al giorno. Per luppolo: agitazione minima (rischio ossidazione).';

    // Filtration
    const filtration: string[] = [
        'Filtrare grossolanamente con colino fine a maglia inox.',
        'Lasciare sedimentare 12–48 ore in frigorifero.',
    ];
    if (input.category === 'cacao') {
        filtration.push('Rimuovere lo strato grasso superficiale dopo raffreddamento.');
    }
    filtration.push('Filtrare nuovamente con carta (filtro da caffè) o filtro a membrana fine.');
    filtration.push('Conservare la tintura in bottiglia di vetro scuro, ben chiusa, al fresco e al buio.');

    // ── Bench trial ──
    // Determine appropriate bench trial range based on category
    let doseLow = 0.02;
    let doseMid = 0.10;
    let doseHigh = 0.30;

    switch (input.category) {
        case 'chili':
            doseLow = 0.005;
            doseMid = 0.02;
            doseHigh = 0.05;
            break;
        case 'hop':
        case 'hop_cold_short':
            doseLow = 0.05;
            doseMid = 0.20;
            doseHigh = 0.40;
            break;
        case 'wood':
            doseLow = 0.10;
            doseMid = 0.50;
            doseHigh = 1.00;
            break;
        case 'vanilla':
            doseLow = 0.10;
            doseMid = 0.30;
            doseHigh = 0.50;
            break;
        case 'seed_spice':
        case 'bark_root':
            doseLow = 0.02;
            doseMid = 0.10;
            doseHigh = 0.30;
            break;
        case 'citrus_peel':
            doseLow = 0.02;
            doseMid = 0.15;
            doseHigh = 0.30;
            break;
        case 'coffee':
            doseLow = 0.05;
            doseMid = 0.15;
            doseHigh = 0.30;
            break;
        case 'cacao':
            doseLow = 0.10;
            doseMid = 0.50;
            doseHigh = 1.00;
            break;
        case 'fresh_herb':
        case 'dried_herb':
            doseLow = 0.05;
            doseMid = 0.20;
            doseHigh = 0.50;
            break;
        case 'fruit':
            doseLow = 0.10;
            doseMid = 0.50;
            doseHigh = 1.00;
            break;
        default:
            doseLow = 0.05;
            doseMid = 0.15;
            doseHigh = 0.40;
    }

    const benchTrial = {
        doseLowMlPer100ml: doseLow,
        doseMidMlPer100ml: doseMid,
        doseHighMlPer100ml: doseHigh,
        samples: [
            { sample: 'A — Controllo', doseMl: 0 },
            { sample: 'B — Dose minima', doseMl: doseLow },
            { sample: 'C — Dose bassa', doseMl: doseMid },
            { sample: 'D — Dose media', doseMl: doseHigh },
            { sample: 'E — Dose alta', doseMl: doseHigh * 2 },
        ],
    };

    // ── Batch dosing ──
    let estimatedBatchDoseMl: number | null = null;
    let alcoholContributionAbv: number | null = null;

    if (input.beer_volume_l !== undefined && input.test_sample_ml !== undefined && input.test_dose_ml !== undefined) {
        const batchVolumeMl = input.beer_volume_l * 1000;
        estimatedBatchDoseMl = Math.round((input.test_dose_ml * batchVolumeMl) / input.test_sample_ml * 100) / 100;

        // ABV contribution: ΔABV ≈ (V_tincture × ABV_tincture) / (V_beer + V_tincture)
        const beerMl = input.beer_volume_l * 1000;
        alcoholContributionAbv = Math.round(((estimatedBatchDoseMl * (targetAbv / 100)) / (beerMl + estimatedBatchDoseMl)) * 100 * 100) / 100;
    }

    // ── Effective ABV (for fresh herbs / fruit) ──
    let effectiveAbvPercent: number | null = null;
    if (input.category === 'fresh_herb' && input.herb_water_percent !== undefined) {
        const herbWaterMl = input.ingredient_weight_g * (input.herb_water_percent / 100);
        const totalVolume = solventMl + herbWaterMl;
        effectiveAbvPercent = Math.round((alcoholMl * (input.source_abv_percent / 100) / totalVolume) * 100 * 100) / 100;
    } else if (input.category === 'fruit' && input.fruit_sugar_percent !== undefined) {
        // Fruit water content estimated as 100 - sugar% - fiber% (approx 5% for fiber)
        const fruitWaterPercent = Math.max(0, 95 - (input.fruit_sugar_percent ?? 0));
        const fruitWaterMl = input.ingredient_weight_g * (fruitWaterPercent / 100);
        const totalVolume = solventMl + fruitWaterMl;
        effectiveAbvPercent = Math.round((alcoholMl * (input.source_abv_percent / 100) / totalVolume) * 100 * 100) / 100;
    }

    // ── Warnings ──
    const warnings = getSafetyWarnings(input.ingredient, input.category);

    if (input.category === 'fruit' || (input.category === 'fresh_herb' && effectiveAbvPercent !== null)) {
        if (effectiveAbvPercent !== null && effectiveAbvPercent < 20) {
            warnings.push(`⚠️ La gradazione effettiva dopo l'aggiunta dell'ingrediente scende a ~${effectiveAbvPercent}%. Sotto il 20% c'è rischio di contaminazione microbica. Ridurre la quantità di ingrediente o aumentare l'ABV iniziale.`);
        }
    }

    if (input.category === 'fruit' && input.fruit_sugar_percent && input.fruit_sugar_percent > 5) {
        warnings.push(`⚠️ La frutta contiene ~${input.fruit_sugar_percent}% zuccheri → possibile rifermentazione se aggiunta prima del packaging. Aggiungere solo a birra stabilizzata o in keg freddo.`);
    }

    if (targetAbv > 80) {
        warnings.push('⚠️ ABV > 80%: estrazione molto aggressiva, profilo potenzialmente resinoso. Non rappresentativo dell\'estrazione in birra.');
    }

    if (input.category === 'hop') {
        warnings.push('⚠️ Una tintura di luppolo NON sostituisce il dry hopping. Non riproduce biotrasformazione, mouthfeel, interazioni olio-proteine-polifenoli.');
    }

    if (extractionDays && extractionDays > 14 && ['seed_spice', 'fresh_herb', 'citrus_peel', 'chili'].includes(input.category)) {
        warnings.push('⚠️ Tempo di estrazione lungo (>14gg) per questa categoria: rischio aumento di tannino, amaro, note medicinali o terrose.');
    }

    return {
        ingredient: input.ingredient,
        categoryLabel: preset.label,
        category: input.category,
        targetAbvPercent: targetAbv,
        alcohol95Ml: alcoholMl,
        waterMl,
        solventVolumeMl: solventMl,
        ingredientWeightG: input.ingredient_weight_g,
        ingredientToSolventRatio: ratioLabel,
        extractionTime,
        extractionTempC: tempC,
        preparation,
        agitation,
        filtration,
        benchTrial,
        estimatedBatchDoseMl,
        alcoholContributionAbv,
        hasFermentables: preset.hasFermentables || (input.category === 'fruit' && (input.fruit_sugar_percent ?? 0) > 5),
        effectiveAbvPercent,
        warnings,
    };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatResults(input: TinctureCalculatorInput): string {
    const lines: string[] = [];
    lines.push(`# 🧪 Tintura Alcolica: ${input.ingredient}`);
    lines.push('');

    let plan: TincturePlan;
    try {
        plan = compute(input);
    } catch (e) {
        lines.push(`❌ **Errore:** ${e instanceof Error ? e.message : String(e)}`);
        return lines.join('\n');
    }

    const stateLabel: Record<string, string> = {
        fresh: 'Fresco', dried: 'Essiccato', pellet: 'Pellet',
        whole: 'Intero', ground: 'Macinato', crushed: 'Schiacciato',
        chips: 'Chips', cubes: 'Cubetti',
    };

    // ── Overview ──
    lines.push('## 📊 Parametri della tintura');
    lines.push('');
    lines.push('| Parametro | Valore |');
    lines.push('|---|---|');
    lines.push(`| Ingrediente | **${plan.ingredient}** |`);
    lines.push(`| Categoria | ${plan.categoryLabel} |`);
    lines.push(`| Stato | ${stateLabel[input.ingredient_state] ?? input.ingredient_state} |`);
    lines.push(`| Peso ingrediente | **${plan.ingredientWeightG} g** |`);
    lines.push(`| ABV target | **${plan.targetAbvPercent}%** |`);
    lines.push(`| Volume solvente | **${plan.solventVolumeMl} mL** |`);
    lines.push(`| Rapporto | ${plan.ingredientToSolventRatio} |`);
    lines.push(`| Tempo estrazione | ${plan.extractionTime} |`);
    lines.push(`| Temperatura | ${plan.extractionTempC} °C |`);
    lines.push('');

    // ── Solvent recipe ──
    lines.push('## 🧫 Ricetta del solvente');
    lines.push('');
    lines.push(`Per ottenere **${plan.solventVolumeMl} mL** al **${plan.targetAbvPercent}%** partendo da alcol a **${input.source_abv_percent}°**:`);
    lines.push('');
    lines.push('| Componente | Quantità |');
    lines.push('|---|---|');
    lines.push(`| Alcol ${input.source_abv_percent}° | **${plan.alcohol95Ml} mL** |`);
    lines.push(`| Acqua demineralizzata | **${plan.waterMl} mL** |`);
    lines.push(`| Volume finale | **${plan.solventVolumeMl} mL** |`);
    lines.push('');
    lines.push('> Versare PRIMA l\'alcol, POI l\'acqua, quindi portare a volume. I volumi acqua–etanolo non sono perfettamente additivi.');
    lines.push('');

    if (plan.effectiveAbvPercent !== null) {
        lines.push(`> ⚠️ Gradazione effettiva stimata dopo l'aggiunta dell'ingrediente: **~${plan.effectiveAbvPercent}%** (diluizione da acqua dell'ingrediente).`);
        lines.push('');
    }

    // ── Warnings ──
    if (plan.warnings.length > 0) {
        lines.push('## ⚠️ Avvertenze');
        lines.push('');
        for (const w of plan.warnings) {
            lines.push(`- ${w}`);
        }
        lines.push('');
    }

    // ── Preparation ──
    lines.push('## 🔧 Preparazione');
    lines.push('');
    for (let i = 0; i < plan.preparation.length; i++) {
        lines.push(`${i + 1}. ${plan.preparation[i]!}`);
    }
    lines.push('');

    // ── Agitation ──
    lines.push('## 🔄 Agitazione');
    lines.push('');
    lines.push(plan.agitation);
    lines.push('');

    // ── Filtration ──
    lines.push('## 🫗 Filtrazione');
    lines.push('');
    for (let i = 0; i < plan.filtration.length; i++) {
        lines.push(`${i + 1}. ${plan.filtration[i]!}`);
    }
    lines.push('');

    // ── Bench trial ──
    lines.push('## 🧪 Bench Trial (OBBLIGATORIO)');
    lines.push('');
    lines.push('Preparare 5 campioni da 100 mL di birra finita:');
    lines.push('');
    lines.push('| Campione | Dose (mL/100mL) |');
    lines.push('|---|---|');
    for (const s of plan.benchTrial.samples) {
        lines.push(`| ${s.sample} | ${s.doseMl > 0 ? s.doseMl.toFixed(3) : '0'} |`);
    }
    lines.push('');
    lines.push('Mescolare, attendere 10–30 minuti, assaggiare alla temperatura di servizio.');
    lines.push(`- Per legno: attendere almeno 15–30 min nel campione prima di giudicare.`);
    lines.push(`- Per peperoncino: iniziare da 1 goccia e aumentare una goccia alla volta.`);
    lines.push('');

    // ── Batch dose ──
    if (plan.estimatedBatchDoseMl !== null && plan.alcoholContributionAbv !== null && input.beer_volume_l !== undefined) {
        lines.push('## 📐 Dose per il batch');
        lines.push('');
        lines.push(`Dose campione: **${input.test_dose_ml} mL** in **${input.test_sample_ml} mL** →`);
        lines.push('');
        lines.push('| Parametro | Valore |');
        lines.push('|---|---|');
        lines.push(`| Volume birra (effettivo) | **${input.beer_volume_l} L** |`);
        lines.push(`| Dose batch calcolata | **${plan.estimatedBatchDoseMl} mL** |`);
        lines.push(`| Dose consigliata (70-80%) | **${Math.round(plan.estimatedBatchDoseMl * 0.75 * 100) / 100} mL** |`);
        lines.push(`| Contributo ABV | **+${plan.alcoholContributionAbv}%** |`);
        lines.push('');

        if (plan.alcoholContributionAbv > 0.5) {
            lines.push(`> ⚠️ Il contributo alcolico non è trascurabile (+${plan.alcoholContributionAbv}% ABV). Consideralo nel calcolo ABV finale.`);
        }

        if (plan.hasFermentables) {
            lines.push('> ⚠️ L\'estratto contiene zuccheri fermentabili. Aggiungere solo a birra stabilizzata o in keg freddo per evitare rifermentazione.');
        }

        lines.push('');
        lines.push('**Procedura di aggiunta:**');
        lines.push(`1. Aggiungere il **70–80%** della dose calcolata (~${Math.round(plan.estimatedBatchDoseMl * 0.75 * 100) / 100} mL).`);
        lines.push('2. Miscelare delicatamente.');
        if (input.beer_volume_l <= 30) {
            lines.push('3. Se in keg: spurgare, trasferire in closed transfer, miscelare.');
            lines.push('4. Se in bottiglia: aggiungere al bottling bucket con la soluzione di priming, miscelare lentamente.');
        }
        lines.push('5. Assaggiare dopo 12–24 ore.');
        lines.push('6. Correggere con la parte restante SOLO SE necessaria.');
        lines.push('');

        // Dosing table for reference
        lines.push('## 📋 Tabella dosaggi di riferimento');
        lines.push('');
        lines.push('| Dose campione (mL/100mL) | Dose batch (mL) |');
        lines.push('|---|---|');
        for (const ml of [0.05, 0.10, 0.15, 0.20, 0.30, 0.50, 1.0]) {
            const batchDose = Math.round(ml * input.beer_volume_l * 10 * 100) / 100;
            lines.push(`| ${ml} | **${batchDose}** |`);
        }
        lines.push('');
    } else if (input.beer_volume_l !== undefined && (input.test_sample_ml === undefined || input.test_dose_ml === undefined)) {
        lines.push('## 📐 Dose per il batch');
        lines.push('');
        lines.push('⚠️ **Manca il bench trial.** Fornisci `test_sample_ml` e `test_dose_ml` per calcolare la dose batch.');
        lines.push('');
    }

    // ── Category-specific notes ──
    if (input.show_details) {
        lines.push('## 📝 Note specifiche');
        lines.push('');
        lines.push(CATEGORY_PRESETS[input.category === 'hop' && input.hop_variant === 'cold_short' ? 'hop_cold_short' : input.category]?.notes ?? CATEGORY_PRESETS.other!.notes);
        lines.push('');

        if (input.category === 'hop') {
            lines.push('### Quando usare la tintura di luppolo');
            lines.push('');
            lines.push('✅ **Adatta per:** correggere aroma insufficiente, confrontare varietà, costruire blend aromatici, aggiungere aroma al packaging, sperimentare senza perdere litri di birra.');
            lines.push('❌ **Non adatta come unica tecnica per:** NEIPA (biotrasformazione, mouthfeel), interazione lievito attivo, profilo complesso multi-stage dry hop.');
            lines.push('');
        }
    }

    // ── Safety checklist ──
    lines.push('## 🛡️ Checklist di sicurezza');
    lines.push('');
    lines.push('- [ ] Alcol alimentare NON denaturato');
    lines.push('- [ ] Acqua demineralizzata, osmotizzata o bollita e raffreddata');
    lines.push('- [ ] Contenitore in VETRO sanificato');
    lines.push('- [ ] Tappo resistente all\'alcol');
    lines.push('- [ ] Conservazione al BUIO');
    lines.push('- [ ] Ingrediente certificato per uso alimentare');
    lines.push('- [ ] NESSUNA fiamma, fornello o piastra vicino all\'alcol a 95°');
    lines.push('- [ ] Bench trial completato PRIMA di dosare il batch');
    lines.push('');

    lines.push('---');
    lines.push('*I preset sono punti di partenza basati su euristiche di estrazione. Varietà, lotto, freschezza e dimensione delle particelle modificano radicalmente il risultato. Il bench trial è sempre obbligatorio.*');

    return lines.join('\n');
}

// ── Tool ─────────────────────────────────────────────────────────────────────

const TINCTURE_CALCULATOR_PARAMETERS: Record<string, unknown> = {
    type: 'object',
    properties: {
        ingredient: { type: 'string', minLength: 1, description: 'Nome dell\'ingrediente. Es: "Luppolo Citra", "Quercia francese media tostatura", "Coriandolo", "Scorza d\'arancia", "Cannella Ceylon".' },
        category: { type: 'string', enum: CATEGORIES, description: 'Categoria dell\'ingrediente: hop, wood, seed_spice, bark_root, fresh_herb, dried_herb, citrus_peel, chili, coffee, cacao, vanilla, fruit, other.' },
        ingredient_weight_g: { type: 'number', exclusiveMinimum: 0, description: 'Peso dell\'ingrediente in grammi.' },
        ingredient_state: { type: 'string', enum: INGREDIENT_STATES, description: 'Stato fisico: fresh, dried, pellet, whole, ground, crushed, chips, cubes.' },
        source_abv_percent: { type: 'number', minimum: 1, maximum: 100, default: 95, description: 'Gradazione alcol di partenza (95° in Italia, 96° in altri paesi).' },
        target_abv_percent: { type: 'number', minimum: 1, maximum: 100, description: 'Gradazione target della tintura. Se omesso, si usa il preset della categoria.' },
        solvent_volume_ml: { type: 'number', exclusiveMinimum: 0, description: 'Volume solvente in mL. Se omesso, si calcola dal rapporto ingrediente/solvente.' },
        extraction_time_days: { type: 'number', exclusiveMinimum: 0, description: 'Tempo di estrazione in giorni. Se omesso, si usa il preset della categoria.' },
        extraction_temp_c: { type: 'number', minimum: 0, maximum: 40, description: 'Temperatura di estrazione in °C. Se omesso, si usa il preset.' },
        beer_volume_l: { type: 'number', exclusiveMinimum: 0, description: 'Volume EFFETTIVO della birra nel fermentatore/keg (NON il volume nominale della ricetta).' },
        test_sample_ml: { type: 'number', exclusiveMinimum: 0, description: 'Volume del campione per il bench trial (es. 100). Obbligatorio per calcolare la dose batch.' },
        test_dose_ml: { type: 'number', exclusiveMinimum: 0, description: 'Dose scelta nel campione (mL). Obbligatorio per calcolare la dose batch.' },
        hop_variant: { type: 'string', enum: ['standard', 'cold_short'], description: 'Solo per luppolo: "standard" (45-55%, 12-48h) o "cold_short" (60-70%, 4-12h, più selettivo).' },
        herb_water_percent: { type: 'number', minimum: 0, maximum: 100, description: 'Solo per erbe fresche: contenuto d\'acqua (g/100g). Stima la diluizione del solvente.' },
        fruit_sugar_percent: { type: 'number', minimum: 0, maximum: 100, description: 'Solo per frutta: zuccheri g/100g. Usato per avviso fermentabili.' },
        custom_ratio: { type: 'number', exclusiveMinimum: 0, description: 'Rapporto ingrediente/solvente personalizzato (g/mL). Sovrascrive il preset. Es. 0.1 = 1:10.' },
        show_details: { type: 'boolean', default: true },
    },
    required: ['ingredient', 'category', 'ingredient_weight_g', 'ingredient_state'],
    additionalProperties: false,
};

export class TinctureCalculatorTool implements BuiltinTool<TinctureCalculatorInput> {
    readonly name = 'tincture_calculator' as const;
    readonly description = [
        'Pianifica una tintura alcolica per birra: calcola la ricetta del solvente (alcol 95° + acqua → ABV target), proporzioni, tempo e temperatura di estrazione, procedura di preparazione e filtrazione, protocollo di bench trial, dose per il batch e contributo alcolico.',
        '',
        '⚠️ REGOLE FONDAMENTALI:',
        '- Il bench trial è OBBLIGATORIO prima di dosare il batch. Fornisci sempre test_sample_ml e test_dose_ml.',
        '- Una tintura di luppolo NON sostituisce il dry hopping: è uno strumento correttivo/sperimentale.',
        '- Usare SOLO alcol alimentare non denaturato, acqua demineralizzata, contenitori in vetro.',
        '- Mai riscaldare alcol 95° direttamente: estremamente infiammabile.',
        '- Legno: solo certificato alimentare, mai da falegnameria.',
        '- Il tool applica automaticamente avvertenze di sicurezza per ingredienti a rischio.',
        '',
        'Categorie supportate: hop, wood, seed_spice, bark_root, fresh_herb, dried_herb, citrus_peel, chili, coffee, cacao, vanilla, fruit, other.',
    ].join('\n');
    readonly parameters = TINCTURE_CALCULATOR_PARAMETERS;

    resolveExecution(rawArgs: TinctureCalculatorInput): ToolExecution {
        const parsed = TinctureCalculatorInputSchema.parse(rawArgs);
        const args = parsed as TinctureCalculatorInput;
        return {
            description: `Tintura: ${args.ingredient} (${args.category}) @ ${args.target_abv_percent ?? 'auto'}%`,
            approvalRule: this.name,
            execute: () => {
                try { return Promise.resolve({ output: formatResults(args) }); }
                catch (e) { return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) }); }
            },
        };
    }
}

registerTool(TinctureCalculatorTool);
