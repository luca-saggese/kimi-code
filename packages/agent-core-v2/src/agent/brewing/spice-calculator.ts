/**
 * Spice calculator — estimate spice/adjunct dosage for brewing.
 *
 * Separates aromatic dose (volatile terpenes/phenols) from chemesthetic dose
 * (pungency, heat, cooling, astringency) because they behave differently.
 * Accounts for physical form, addition stage, contact time, temperature,
 * beer matrix (ABV, FG, IBU, roast, acidity), spice-spice interactions,
 * and freshness. Returns an interval with confidence level, risk flags, and
 * an incremental-adjustment protocol — never a single precise number.
 *
 * Key caveats: essential-oil content varies enormously with origin, cultivar,
 * harvest year, and storage. The database values are starting points; actual
 * potency depends on your specific lot. Bench trials and incremental dosing
 * are always recommended when precision matters.
 */

import { z } from 'zod';

import type { BuiltinTool, ToolExecution } from '#/tool/toolContract';
import { registerTool } from '#/agent/toolRegistry/toolContribution';

// ── Sensory profile ──────────────────────────────────────────────────────────

interface SpiceSensoryProfile {
    /** Volatile aroma intensity (0-1 scale). */
    aroma: number;
    /** Trigeminal heat / pungency / burning (0-1). */
    pungency: number;
    /** Bitterness (0-1). */
    bitterness: number;
    /** Mouth-drying / puckering astringency (0-1). */
    astringency: number;
    /** Cooling sensation (menthol, eucalyptol etc.) (0-1). */
    cooling: number;
}

// ── Spice database ───────────────────────────────────────────────────────────

interface SpiceDosageRange {
    /** Grams per 20L, for the reference form and method. */
    min: number;
    max: number;
    recommend: number;
}

interface SpiceInfo {
    id: string;
    name: string;
    aliases: string[];
    /** Default reference form for dosage ranges. */
    referenceForm: SpiceForm;
    /** Sensory vector. */
    profile: SpiceSensoryProfile;
    /** Empirical dosage range per intensity level (g per 20L, reference form). */
    low: SpiceDosageRange;
    medium: SpiceDosageRange;
    high: SpiceDosageRange;
    /** Key volatile compounds (for interaction matching). */
    keyVolatiles: string[];
    /** Key non-volatile active compounds. */
    keyActives: string[];
    /** Does pungency fade quickly or build over time? */
    pungencyProfile: 'immediate' | 'building' | 'persistent';
    /** Rough essential-oil range (% of dry weight) — for freshness modeling. */
    oilRangePercent?: [number, number];
    /** Known risks and pitfalls. */
    risks: string[];
    /** Special handling notes. */
    notes: string;
}

type SpiceForm =
    | 'whole'
    | 'cracked'
    | 'ground'
    | 'fresh'
    | 'dried'
    | 'tincture'
    | 'extract';

type AdditionStage =
    | 'mash'
    | 'boil'
    | 'whirlpool'
    | 'fermentation'
    | 'conditioning'
    | 'keg'
    | 'tincture';

type IntensityLevel = 'low' | 'medium' | 'high';

// ── Form extraction properties ───────────────────────────────────────────────

interface FormProperties {
    label: string;
    /** Multiplier for volatile extraction speed (higher = faster). */
    volatileExtractSpeed: number;
    /** Multiplier for non-volatile extraction speed. */
    nonVolatileExtractSpeed: number;
    /** Volatile loss multiplier during heat (higher = more loss). */
    volatileHeatLoss: number;
    /** How consistently this form doses across batches. */
    repeatability: 'low' | 'medium' | 'good' | 'very_good';
    /** Overdose risk. */
    overdoseRisk: 'low' | 'medium' | 'high';
    /** Can the spice be removed after steeping? */
    removable: boolean;
}

const FORMS: Record<SpiceForm, FormProperties> = {
    whole: { label: 'Intero', volatileExtractSpeed: 0.30, nonVolatileExtractSpeed: 0.25, volatileHeatLoss: 0.30, repeatability: 'low', overdoseRisk: 'low', removable: true },
    cracked: { label: 'Spezzato / schiacciato', volatileExtractSpeed: 0.65, nonVolatileExtractSpeed: 0.55, volatileHeatLoss: 0.50, repeatability: 'medium', overdoseRisk: 'low', removable: true },
    ground: { label: 'Macinato / polvere', volatileExtractSpeed: 1.0, nonVolatileExtractSpeed: 1.0, volatileHeatLoss: 0.80, repeatability: 'good', overdoseRisk: 'high', removable: false },
    fresh: { label: 'Fresco', volatileExtractSpeed: 0.80, nonVolatileExtractSpeed: 0.70, volatileHeatLoss: 0.60, repeatability: 'low', overdoseRisk: 'medium', removable: true },
    dried: { label: 'Essiccato', volatileExtractSpeed: 0.55, nonVolatileExtractSpeed: 0.50, volatileHeatLoss: 0.45, repeatability: 'medium', overdoseRisk: 'low', removable: true },
    tincture: { label: 'Tintura alcolica', volatileExtractSpeed: 1.0, nonVolatileExtractSpeed: 0.90, volatileHeatLoss: 0.0, repeatability: 'very_good', overdoseRisk: 'low', removable: false },
    extract: { label: 'Estratto standardizzato', volatileExtractSpeed: 1.0, nonVolatileExtractSpeed: 1.0, volatileHeatLoss: 0.05, repeatability: 'very_good', overdoseRisk: 'high', removable: false },
};

// ── Stage extraction properties ──────────────────────────────────────────────

interface StageProperties {
    label: string;
    /** Volatile extraction multiplier. */
    volatileExtract: number;
    /** Non-volatile extraction multiplier. */
    nonVolatileExtract: number;
    /** Volatile evaporation / degradation multiplier. */
    volatileEvaporation: number;
    /** Can the spice be removed post-extraction? */
    removable: boolean;
    /** Description for output. */
    tip: string;
}

const STAGES: Record<AdditionStage, StageProperties> = {
    mash: { label: 'Mash', volatileExtract: 0.40, nonVolatileExtract: 0.60, volatileEvaporation: 0.15, removable: true, tip: 'I volatili delicati sopravvivono poco al mash; meglio per spezie resinose o amare.' },
    boil: { label: 'Bollitura', volatileExtract: 0.90, nonVolatileExtract: 0.95, volatileEvaporation: 0.85, removable: false, tip: 'Massima estrazione ma forte perdita di volatili leggeri. Aggiungere a fine bollitura per preservare aromi.' },
    whirlpool: { label: 'Whirlpool (80-95°C)', volatileExtract: 0.75, nonVolatileExtract: 0.70, volatileEvaporation: 0.50, removable: true, tip: 'Buon compromesso: estrazione senza evaporazione estrema. 15-30 min tipicamente.' },
    fermentation: { label: 'Fermentazione', volatileExtract: 0.60, nonVolatileExtract: 0.50, volatileEvaporation: 0.40, removable: false, tip: 'Alcuni volatili vengono trascinati dalla CO₂. Aggiungere dopo la fase più attiva.' },
    conditioning: { label: 'Maturazione / dry-spice', volatileExtract: 0.55, nonVolatileExtract: 0.45, volatileEvaporation: 0.10, removable: true, tip: 'Metodo più controllabile. Assaggiare ogni 12-24 ore. Rimuovere quando soddisfatti.' },
    keg: { label: 'Fusto / serving tank', volatileExtract: 0.50, nonVolatileExtract: 0.40, volatileEvaporation: 0.05, removable: true, tip: 'Temperatura bassa = estrazione lenta. Usare sacchetto in acciaio per rimozione facile.' },
    tincture: { label: 'Tintura alcolica separata', volatileExtract: 0.95, nonVolatileExtract: 0.90, volatileEvaporation: 0.0, removable: false, tip: 'Massimo controllo. Aggiungere goccia a goccia su campione, poi scalare.' },
};

// ── Beer matrix effects ──────────────────────────────────────────────────────

interface BeerMatrixInput {
    abv: number;
    finalGravity?: number;
    ibu?: number;
    roastIntensity: number;       // 0-1
    hopAromaIntensity: number;    // 0-1
    acidity: number;              // 0-1 (0 = not sour, 1 = very sour)
}

/**
 * Compute per-dimension matrix factors, separated by mechanism:
 * - extractionFactor: how the beer medium affects physical extraction
 * - perceptionAmplification: how the beer amplifies perceived intensity
 * - maskingFactor: how the beer masks or suppresses perception
 */
function computeMatrixFactors(m: BeerMatrixInput) {
    const abv = m.abv;
    const fg = m.finalGravity ?? 1.012;

    // ABV: increases solubility of apolar compounds → higher extraction
    const abvExtraction = 1 + Math.max(0, (abv - 4.5) * 0.06);
    // ABV also amplifies warm/pungent sensation
    const abvPerceptionWarm = 1 + Math.max(0, (abv - 5) * 0.08);

    // FG: masks delicate aromas linearly but clamped to plausible range
    const fgAbove = Math.max(0, (fg - 1.008) * 1000);
    const fgMaskAroma = clamp(1 - fgAbove * 0.006, 0.50, 1.05);

    // IBU: additive bitterness risk
    const ibuRisk = Math.min(1, (m.ibu ?? 0) / 80);

    // Roast: masks delicate aromas, complements warm/resinous spices
    const roastMask = clamp(1 - m.roastIntensity * 0.4, 0.40, 1.0);
    const roastBoostWarm = 1 + m.roastIntensity * 0.3;

    // Hop aroma: terpene overlap risk (informational, not dose-changing)
    const hopOverlapRisk = m.hopAromaIntensity * 0.5;

    // Acidity: amplifies perceived brightness and heat/astringency
    const acidAmplifyBright = 1 + m.acidity * 0.25;
    const acidAmplifyHeat = 1 + m.acidity * 0.30;
    const acidAmplifyAstringency = 1 + m.acidity * 0.20;

    return {
        // Extraction: how the beer pulls compounds from the spice
        extractionFactor: abvExtraction,
        // Perception amplification per dimension
        perceptionAmplification: {
            aroma: acidAmplifyBright,
            pungency: abvPerceptionWarm * acidAmplifyHeat * roastBoostWarm,
            bitterness: abvExtraction * (1 + ibuRisk * 0.3),
            astringency: abvExtraction * acidAmplifyAstringency * (1 + ibuRisk * 0.15),
            cooling: acidAmplifyBright,
        },
        // Masking per dimension: <1 means the beer masks this dimension
        maskingFactor: {
            aroma: fgMaskAroma * roastMask,
            pungency: 1.0,   // pungency is rarely masked
            bitterness: 1.0,
            astringency: 1.0,
            cooling: 1.0,
        },
        hopOverlapRisk,
        roastMask,
    };
}

// ── Freshness / potency adjustment ───────────────────────────────────────────

/**
 * Potency factor: >1 = more potent than reference, <1 = less potent.
 * A more potent spice needs LESS grams → dose is DIVIDED by potencyFactor.
 */
function potencyMultiplier(freshness: Freshness): number {
    switch (freshness) {
        case 'freshly_cracked': return 1.15;  // more potent → lower dose
        case 'recent': return 1.0;
        case 'older': return 0.75;            // less potent → higher dose
        case 'unknown': return 1.0;           // neutral, confidence drops
    }
}

type Freshness = 'freshly_cracked' | 'recent' | 'older' | 'unknown';

// ── Spice database ───────────────────────────────────────────────────────────

const SPICES: SpiceInfo[] = [
    {
        id: 'coriander_seed', name: 'Coriandolo (seme)', aliases: ['coriandolo', 'coriander', 'coriander seed'],
        referenceForm: 'cracked',
        profile: { aroma: 0.80, pungency: 0.10, bitterness: 0.25, astringency: 0.20, cooling: 0.0 },
        low: { min: 4, max: 8, recommend: 6 },
        medium: { min: 8, max: 16, recommend: 12 },
        high: { min: 16, max: 30, recommend: 22 },
        keyVolatiles: ['linalool', 'α-pinene', 'γ-terpinene', 'camphor'],
        keyActives: ['linalool', 'geranyl acetate'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.18, 1.40],
        risks: ['Profilo saponoso/detergente se sovradosato con agrumi', 'Variabilità enorme tra lotti (olio 0.18-1.40%)'],
        notes: 'Schiacciare sempre prima dell\'uso. Le varietà indiane sono più agrumate, quelle europee più floreali.',
    },
    {
        id: 'black_pepper', name: 'Pepe nero', aliases: ['pepe nero', 'pepe', 'black pepper'],
        referenceForm: 'cracked',
        profile: { aroma: 0.65, pungency: 0.55, bitterness: 0.30, astringency: 0.40, cooling: 0.0 },
        low: { min: 1, max: 3, recommend: 2 },
        medium: { min: 3, max: 6, recommend: 4.5 },
        high: { min: 6, max: 10, recommend: 8 },
        keyVolatiles: ['β-caryophyllene', 'limonene', 'α-pinene', 'β-pinene', 'δ-3-carene'],
        keyActives: ['piperine'],
        pungencyProfile: 'immediate',
        oilRangePercent: [1.0, 3.5],
        risks: ['Piperina 2-9%: due pepi uguali in g/L possono essere molto diversi', 'Sovrapposizione terpenica con luppoli resinosi/agrumati', 'Nota legnosa oltre 7 giorni di contatto'],
        notes: 'Spezzare fresco prima dell\'uso. Tellicherry e Sarawak hanno profili molto diversi. Per dry-spice, rimuovere entro 5-7 giorni.',
    },
    {
        id: 'sichuan_pepper', name: 'Pepe di Sichuan', aliases: ['sichuan', 'sichuan pepper', 'pepe di sichuan', 'sancho'],
        referenceForm: 'cracked',
        profile: { aroma: 0.60, pungency: 0.50, bitterness: 0.15, astringency: 0.55, cooling: 0.45 },
        low: { min: 1, max: 3, recommend: 2 },
        medium: { min: 3, max: 6, recommend: 4.5 },
        high: { min: 6, max: 10, recommend: 8 },
        keyVolatiles: ['geraniol', 'limonene', 'citronellal', 'linalool'],
        keyActives: ['hydroxy-α-sanshool', 'hydroxy-β-sanshool'],
        pungencyProfile: 'immediate',
        oilRangePercent: [1.5, 4.0],
        risks: ['Effetto anestetizzante/tingling cumulativo con altre spezie pungenti', 'Sapore metallico se sovradosato'],
        notes: 'Aggiunge un effetto "buzz" unico. Si sposa bene con agrumi e coriandolo. Rimuovere dopo 3-5 giorni.',
    },
    {
        id: 'cinnamon', name: 'Cannella', aliases: ['cannella', 'cinnamon'],
        referenceForm: 'whole',
        profile: { aroma: 0.75, pungency: 0.30, bitterness: 0.35, astringency: 0.40, cooling: 0.0 },
        low: { min: 2, max: 5, recommend: 3.5 },
        medium: { min: 5, max: 10, recommend: 7.5 },
        high: { min: 10, max: 18, recommend: 14 },
        keyVolatiles: ['cinnamaldehyde', 'eugenol', 'linalool'],
        keyActives: ['cinnamaldehyde', 'coumarin'],
        risks: ['La cannella Cassia contiene cumarina (tossicità epatica ad alte dosi). Preferire Ceylon per dosaggi alti.', 'Astringenza fastidiosa oltre 10 g/20L in stecca', 'Può dominare tutto oltre i 15 g/20L'],
        notes: 'Usare stecche intere in infusione, rimuovere dopo 3-5 giorni. La polvere è difficile da rimuovere e torbida.',
        pungencyProfile: 'immediate',
    },
    {
        id: 'clove', name: 'Chiodo di garofano', aliases: ['chiodi di garofano', 'chiodo', 'clove', 'cloves'],
        referenceForm: 'whole',
        profile: { aroma: 0.95, pungency: 0.40, bitterness: 0.50, astringency: 0.70, cooling: 0.05 },
        low: { min: 0.2, max: 0.6, recommend: 0.4 },
        medium: { min: 0.6, max: 1.2, recommend: 0.9 },
        high: { min: 1.2, max: 2.0, recommend: 1.5 },
        keyVolatiles: ['eugenol', 'β-caryophyllene', 'eugenyl acetate'],
        keyActives: ['eugenol'],
        pungencyProfile: 'persistent',
        oilRangePercent: [14, 20],
        risks: ['CURVA RIPIDA: la distanza tra riconoscibile e dominante è minuscola', 'Può anestetizzare il palato mascherando altre spezie', 'Eugenolo dominante: copre aromi delicati'],
        notes: 'Dosare con estrema cautela. Per 20L, iniziare con 2-3 chiodi, assaggiare dopo 24 ore.',
    },
    {
        id: 'star_anise', name: 'Anice stellato', aliases: ['anice stellato', 'star anise', 'badiana'],
        referenceForm: 'whole',
        profile: { aroma: 0.85, pungency: 0.10, bitterness: 0.30, astringency: 0.45, cooling: 0.0 },
        low: { min: 0.5, max: 1.5, recommend: 1 },
        medium: { min: 1.5, max: 4, recommend: 2.5 },
        high: { min: 4, max: 8, recommend: 6 },
        keyVolatiles: ['anethole', 'estragole', 'limonene', 'linalool'],
        keyActives: ['anethole'],
        pungencyProfile: 'building',
        oilRangePercent: [5, 9],
        risks: ['CURVA RIPIDA come il chiodo di garofano', 'L\'anetolo è molto persistente e può coprire tutto', 'Sapore medicinale se sovradosato'],
        notes: '1-2 stelle per 20L come punto di partenza. Aggiungere in infusione rimovibile.',
    },
    {
        id: 'ginger', name: 'Zenzero', aliases: ['zenzero', 'ginger'],
        referenceForm: 'fresh',
        profile: { aroma: 0.55, pungency: 0.60, bitterness: 0.20, astringency: 0.25, cooling: 0.0 },
        low: { min: 10, max: 25, recommend: 18 },
        medium: { min: 25, max: 60, recommend: 40 },
        high: { min: 60, max: 120, recommend: 90 },
        keyVolatiles: ['zingiberene', 'β-sesquiphellandrene', 'α-curcumene', 'citral'],
        keyActives: ['gingerol', 'shogaol', 'zingerone'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.5, 3.0],
        risks: ['Pungenza cumulativa con pepe/peperoncino', 'Il fresco e il secco hanno profili molto diversi (gingerol vs shogaol)', 'Nota terrosa oltre 10 giorni di contatto'],
        notes: 'Fresco: sbucciare e affettare sottile. Secco in polvere: ~1/4 del peso fresco. Per dry-spice, rimuovere entro 5-7 giorni.',
    },
    {
        id: 'chili', name: 'Peperoncino', aliases: ['peperoncino', 'chili', 'chili pepper', 'chile'],
        referenceForm: 'dried',
        profile: { aroma: 0.35, pungency: 0.95, bitterness: 0.25, astringency: 0.30, cooling: 0.0 },
        low: { min: 0, max: 0, recommend: 0 },
        medium: { min: 0, max: 0, recommend: 0 },
        high: { min: 0, max: 0, recommend: 0 },
        keyVolatiles: ['variable by cultivar'],
        keyActives: ['capsaicin', 'dihydrocapsaicin'],
        pungencyProfile: 'building',
        oilRangePercent: [0.1, 1.0],
        risks: ['IMPOSSIBILE DOSARE SENZA SHU O VARIETÀ. Restituisce intervallo ampio e incerto.', 'Pungenza cumulativa con zenzero e pepe nero', 'La capsaicina è liposolubile: birra più alcolica = estrazione più efficiente'],
        notes: 'SENZA SHU o varietà il calcolo è puramente indicativo. Fornire capsaicinoids_mg_per_g o SHU per stima utile. Ancho/pasilla = poco piccante, habanero = estremamente piccante.',
    },
    {
        id: 'cardamom', name: 'Cardamomo verde', aliases: ['cardamomo', 'cardamom', 'cardamomo verde'],
        referenceForm: 'cracked',
        profile: { aroma: 0.70, pungency: 0.15, bitterness: 0.20, astringency: 0.25, cooling: 0.10 },
        low: { min: 1, max: 3, recommend: 2 },
        medium: { min: 3, max: 7, recommend: 5 },
        high: { min: 7, max: 12, recommend: 9 },
        keyVolatiles: ['1,8-cineole', 'α-terpinyl acetate', 'limonene', 'linalool'],
        keyActives: ['1,8-cineole'],
        pungencyProfile: 'immediate',
        oilRangePercent: [2.5, 8.0],
        risks: ['Può diventare medicinale/farmaceutico a dosi alte', 'L\'1,8-cineolo è dominante e può stancare'],
        notes: 'Schiacciare i baccelli, usare solo i semi. Aggiungere a whirlpool o in infusione post-fermento.',
    },
    {
        id: 'nutmeg', name: 'Noce moscata', aliases: ['noce moscata', 'nutmeg'],
        referenceForm: 'cracked',
        profile: { aroma: 0.60, pungency: 0.35, bitterness: 0.35, astringency: 0.40, cooling: 0.0 },
        low: { min: 0.5, max: 2, recommend: 1 },
        medium: { min: 2, max: 5, recommend: 3.5 },
        high: { min: 5, max: 10, recommend: 7 },
        keyVolatiles: ['myristicin', 'sabinene', 'α-pinene', 'β-pinene', 'terpinen-4-ol'],
        keyActives: ['myristicin', 'elemicin'],
        pungencyProfile: 'building',
        oilRangePercent: [5, 15],
        risks: ['La miristicina ha effetti psicotropi a dosi molto alte (>>10g)', 'Grattugiare fresco: la polvere pre-macinata perde aroma in giorni'],
        notes: 'Grattugiare al momento. Microplane o grattugia fine. In infusione, rimuovere dopo 3-5 giorni.',
    },
    {
        id: 'mace', name: 'Macis', aliases: ['macis', 'mace'],
        referenceForm: 'dried',
        profile: { aroma: 0.55, pungency: 0.25, bitterness: 0.30, astringency: 0.30, cooling: 0.0 },
        low: { min: 0.5, max: 1.5, recommend: 1 },
        medium: { min: 1.5, max: 4, recommend: 2.5 },
        high: { min: 4, max: 8, recommend: 6 },
        keyVolatiles: ['myristicin', 'α-pinene', 'sabinene', 'terpinen-4-ol'],
        keyActives: ['myristicin'],
        pungencyProfile: 'immediate',
        oilRangePercent: [4, 12],
        risks: ['Più delicato della noce moscata ma simile profilo di rischio', 'Può dare note legnose persistenti'],
        notes: 'Aroma più fine e floreale della noce moscata. Si sposa bene con birre chiare e speziate.',
    },
    {
        id: 'vanilla', name: 'Vaniglia', aliases: ['vaniglia', 'vanilla'],
        referenceForm: 'whole',
        profile: { aroma: 0.65, pungency: 0.0, bitterness: 0.10, astringency: 0.05, cooling: 0.0 },
        low: { min: 0.5, max: 1.5, recommend: 1 },
        medium: { min: 1.5, max: 4, recommend: 2.5 },
        high: { min: 4, max: 8, recommend: 6 },
        keyVolatiles: ['vanillin', '4-hydroxybenzaldehyde'],
        keyActives: ['vanillin'],
        pungencyProfile: 'immediate',
        oilRangePercent: [1.5, 3.5],
        risks: ['L\'estratto artificiale ha profilo piatto vs bacca intera', 'Aroma mascherato da malti tostati e luppoli intensi'],
        notes: 'Bacca intera: incidere longitudinalmente, infusione 7-14 giorni. Estratto: usare poche gocce, assaggiare. Tintura fatta in casa: 2 bacche in 50 mL alcool per 2 settimane.',
    },
    {
        id: 'fennel_seed', name: 'Finocchio (seme)', aliases: ['finocchio', 'fennel', 'fennel seed'],
        referenceForm: 'cracked',
        profile: { aroma: 0.70, pungency: 0.05, bitterness: 0.15, astringency: 0.20, cooling: 0.0 },
        low: { min: 2, max: 5, recommend: 3.5 },
        medium: { min: 5, max: 12, recommend: 8 },
        high: { min: 12, max: 20, recommend: 16 },
        keyVolatiles: ['anethole', 'estragole', 'fenchone', 'α-pinene'],
        keyActives: ['anethole'],
        pungencyProfile: 'immediate',
        oilRangePercent: [1.5, 6.0],
        risks: ['L\'anetolo è dominante e persistente', 'Sapore medicinale se sovradosato'],
        notes: 'Schiacciare leggermente. Si sposa bene con coriandolo in Witbier e Saison.',
    },
    {
        id: 'grains_of_paradise', name: 'Grani del paradiso / Maniguetta', aliases: ['grani del paradiso', 'maniguetta', 'grains of paradise', 'melegueta'],
        referenceForm: 'cracked',
        profile: { aroma: 0.55, pungency: 0.50, bitterness: 0.30, astringency: 0.35, cooling: 0.0 },
        low: { min: 1, max: 3, recommend: 2 },
        medium: { min: 3, max: 7, recommend: 5 },
        high: { min: 7, max: 12, recommend: 9 },
        keyVolatiles: ['paradol', 'gingerol', 'shogaol'],
        keyActives: ['paradol', 'gingerol'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.5, 2.0],
        risks: ['Pungenza cumulativa', 'Può dominare birre delicate'],
        notes: 'Sapore tra pepe e zenzero con note agrumate. Ottimo in Saison e Belgian ale.',
    },
    {
        id: 'allspice', name: 'Pimento / Pepe della Giamaica', aliases: ['pimento', 'pepe della giamaica', 'allspice', 'pimenta'],
        referenceForm: 'cracked',
        profile: { aroma: 0.70, pungency: 0.30, bitterness: 0.25, astringency: 0.35, cooling: 0.0 },
        low: { min: 1, max: 3, recommend: 2 },
        medium: { min: 3, max: 7, recommend: 5 },
        high: { min: 7, max: 12, recommend: 9 },
        keyVolatiles: ['eugenol', 'β-caryophyllene', 'methyl eugenol', 'cineole'],
        keyActives: ['eugenol'],
        pungencyProfile: 'immediate',
        oilRangePercent: [2.5, 4.5],
        risks: ['Ricorda cannella + chiodo + noce moscata: può creare ridondanza con queste spezie'],
        notes: 'Aroma complesso "tuttospezie". Ottimo in birre natalizie e stout speziate.',
    },
    {
        id: 'orange_peel', name: 'Scorza d\'arancia', aliases: ['scorza arancia', 'orange peel', 'bucce arancia', 'scorza d\'arancia'],
        referenceForm: 'dried',
        profile: { aroma: 0.70, pungency: 0.0, bitterness: 0.35, astringency: 0.20, cooling: 0.0 },
        low: { min: 3, max: 8, recommend: 5 },
        medium: { min: 8, max: 20, recommend: 14 },
        high: { min: 20, max: 40, recommend: 30 },
        keyVolatiles: ['limonene', 'citral', 'linalool', 'α-pinene'],
        keyActives: ['limonene'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.5, 3.0],
        risks: ['Profilo saponoso/detergente se sovradosata con coriandolo', 'L\'amaro della scorza può sommarsi agli IBU'],
        notes: 'Solo scorza, no albedo (parte bianca = amaro sgradevole). Se fresca, ~2x il peso del secco. Curacao = più aromatica, Valencia = più dolce.',
    },
    {
        id: 'lemon_peel', name: 'Scorza di limone', aliases: ['scorza limone', 'lemon peel', 'bucce limone'],
        referenceForm: 'dried',
        profile: { aroma: 0.70, pungency: 0.0, bitterness: 0.20, astringency: 0.15, cooling: 0.0 },
        low: { min: 3, max: 8, recommend: 5 },
        medium: { min: 8, max: 20, recommend: 14 },
        high: { min: 20, max: 40, recommend: 30 },
        keyVolatiles: ['limonene', 'citral', 'β-pinene', 'γ-terpinene'],
        keyActives: ['limonene', 'citral'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.5, 2.5],
        risks: ['Aroma meno persistente dell\'arancia in birra', 'Simile rischio saponoso con coriandolo'],
        notes: 'Solo scorza, no albedo. Eccellente in Witbier con coriandolo. Fresca ~2x il secco.',
    },
    {
        id: 'long_pepper', name: 'Pepe lungo', aliases: ['pepe lungo', 'long pepper', 'pippali'],
        referenceForm: 'cracked',
        profile: { aroma: 0.50, pungency: 0.70, bitterness: 0.30, astringency: 0.45, cooling: 0.0 },
        low: { min: 0.5, max: 2, recommend: 1 },
        medium: { min: 2, max: 5, recommend: 3.5 },
        high: { min: 5, max: 10, recommend: 7 },
        keyVolatiles: ['β-caryophyllene', 'piperine', 'piperlongumine'],
        keyActives: ['piperine', 'piperlongumine'],
        pungencyProfile: 'building',
        oilRangePercent: [1.0, 3.0],
        risks: ['Più potente del pepe nero: CURVA RIPIDA', 'Pungenza che si accumula lentamente ma intensamente'],
        notes: 'Usare con cautela. Più complesso e persistente del pepe nero. Ottimo in stout e porter.',
    },
    {
        id: 'tonka_bean', name: 'Fava tonka', aliases: ['fava tonka', 'tonka', 'tonka bean'],
        referenceForm: 'cracked',
        profile: { aroma: 0.60, pungency: 0.0, bitterness: 0.20, astringency: 0.25, cooling: 0.0 },
        low: { min: 0.3, max: 1, recommend: 0.5 },
        medium: { min: 1, max: 2, recommend: 1.5 },
        high: { min: 2, max: 4, recommend: 3 },
        keyVolatiles: ['coumarin', 'dihydrocoumarin'],
        keyActives: ['coumarin'],
        pungencyProfile: 'immediate',
        oilRangePercent: [1.0, 3.0],
        risks: ['Contiene cumarina (epatotossica ad alte dosi). Non superare 4 g/20L.', 'Aroma molto persistente. 1 fava per 20L può bastare.'],
        notes: 'Microplane o grattugia fine. Aroma tra vaniglia, mandorla e fieno. Attenzione: la cumarina è regolamentata in alcuni paesi.',
    },
    {
        id: 'juniper', name: 'Ginepro (bacche)', aliases: ['ginepro', 'juniper', 'bacche di ginepro'],
        referenceForm: 'cracked',
        profile: { aroma: 0.60, pungency: 0.25, bitterness: 0.30, astringency: 0.35, cooling: 0.0 },
        low: { min: 2, max: 6, recommend: 4 },
        medium: { min: 6, max: 15, recommend: 10 },
        high: { min: 15, max: 30, recommend: 22 },
        keyVolatiles: ['α-pinene', 'myrcene', 'limonene', 'terpinen-4-ol'],
        keyActives: ['α-pinene', 'myrcene'],
        pungencyProfile: 'immediate',
        oilRangePercent: [0.5, 2.5],
        risks: ['Può dominare birre delicate con note resinose/piney', 'Rischio di sovrapposizione con luppoli resinosi/terrosi'],
        notes: 'Schiacciare leggermente. Ottimo in Saison, Farmhouse e birre affumicate.',
    },
];

// ── Compatibility matrix ─────────────────────────────────────────────────────

interface Interaction {
    ingredientA: string;
    ingredientB: string;
    /** -1 (dissonance) to +1 (synergy). */
    aromaCompatibility: number;
    /** -1 (cancel) to +1 (synergize). */
    pungencySynergy: number;
    /** 0 (no risk) to 1 (high risk). */
    bitternessRisk: number;
    /** 0 (no risk) to 1 (high risk). */
    astringencyRisk: number;
    explanation: string;
}

/** Lookup key: two spice IDs sorted alphabetically. */
function interactKey(a: string, b: string): string {
    return [a, b].sort().join('::');
}

const INTERACTIONS: Record<string, Interaction> = {
    'black_pepper::coriander_seed': { ingredientA: 'black_pepper', ingredientB: 'coriander_seed', aromaCompatibility: 0.60, pungencySynergy: 0.20, bitternessRisk: 0.30, astringencyRisk: 0.25, explanation: 'Buona complementarità: coriandolo agrumato/floreale completa il pepe resinoso. Terpeni condivisi (pineni, limonene).' },
    'black_pepper::sichuan_pepper': { ingredientA: 'black_pepper', ingredientB: 'sichuan_pepper', aromaCompatibility: 0.40, pungencySynergy: 0.70, bitternessRisk: 0.30, astringencyRisk: 0.60, explanation: 'Alta sinergia pungente con effetto buzz amplificato. Rischio di sovraccarico trigeminale. Ridurre entrambi del 30%.' },
    'black_pepper::chili': { ingredientA: 'black_pepper', ingredientB: 'chili', aromaCompatibility: 0.20, pungencySynergy: 0.80, bitternessRisk: 0.25, astringencyRisk: 0.50, explanation: 'Pungenza cumulativa. Due fonti di calore si sommano in modo non lineare. Ridurre entrambi del 40% rispetto al dosaggio singolo.' },
    'black_pepper::ginger': { ingredientA: 'black_pepper', ingredientB: 'ginger', aromaCompatibility: 0.40, pungencySynergy: 0.60, bitternessRisk: 0.20, astringencyRisk: 0.35, explanation: 'Buona complementarità aromatica (terpeni condivisi) ma pungenza cumulativa. Ridurre ciascuno del 25%.' },
    'black_pepper::cinnamon': { ingredientA: 'black_pepper', ingredientB: 'cinnamon', aromaCompatibility: 0.50, pungencySynergy: 0.30, bitternessRisk: 0.40, astringencyRisk: 0.45, explanation: 'Classico abbinamento invernale. Il calore della cannella completa il pepe. Attenzione all\'astringenza cumulativa.' },
    'black_pepper::clove': { ingredientA: 'black_pepper', ingredientB: 'clove', aromaCompatibility: 0.20, pungencySynergy: 0.40, bitternessRisk: 0.60, astringencyRisk: 0.70, explanation: 'Rischio alto. Eugenolo + astringenza del pepe creano sensazione tannica aggressiva.' },
    'coriander_seed::orange_peel': { ingredientA: 'coriander_seed', ingredientB: 'orange_peel', aromaCompatibility: 0.70, pungencySynergy: 0.0, bitternessRisk: 0.40, astringencyRisk: 0.20, explanation: 'Alta affinità agrumata/floreale (linalolo + limonene). Rischio profilo saponoso/detergente se entrambi a dose alta.' },
    'coriander_seed::lemon_peel': { ingredientA: 'coriander_seed', ingredientB: 'lemon_peel', aromaCompatibility: 0.65, pungencySynergy: 0.0, bitternessRisk: 0.30, astringencyRisk: 0.15, explanation: 'Simile all\'arancia ma profilo più fresco e meno saponoso. Buona sinergia.' },
    'cinnamon::clove': { ingredientA: 'cinnamon', ingredientB: 'clove', aromaCompatibility: 0.50, pungencySynergy: 0.35, bitternessRisk: 0.60, astringencyRisk: 0.75, explanation: 'Entrambi ricchi di eugenolo: ridondanza e astringenza cumulativa. Meglio sceglierne uno solo come dominante.' },
    'cinnamon::vanilla': { ingredientA: 'cinnamon', ingredientB: 'vanilla', aromaCompatibility: 0.70, pungencySynergy: 0.0, bitternessRisk: 0.10, astringencyRisk: 0.20, explanation: 'Classico dessert. La vaniglia ammorbidisce il calore della cannella. Ottima sinergia.' },
    'cinnamon::nutmeg': { ingredientA: 'cinnamon', ingredientB: 'nutmeg', aromaCompatibility: 0.60, pungencySynergy: 0.25, bitternessRisk: 0.40, astringencyRisk: 0.45, explanation: 'Buona compatibilità invernale. Entrambi caldi e speziati ma con profili complementari.' },
    'clove::star_anise': { ingredientA: 'clove', ingredientB: 'star_anise', aromaCompatibility: 0.30, pungencySynergy: 0.30, bitternessRisk: 0.60, astringencyRisk: 0.70, explanation: 'Entrambi dominanti con curva ripida. Rischio molto alto di saturazione sensoriale. Meglio sceglierne uno.' },
    'chili::ginger': { ingredientA: 'chili', ingredientB: 'ginger', aromaCompatibility: 0.30, pungencySynergy: 0.75, bitternessRisk: 0.20, astringencyRisk: 0.35, explanation: 'Tre fonti di calore trigeminale (capsaicina + gingerolo). Rischio di aggressività: procedere con estrema cautela.' },
    'chili::sichuan_pepper': { ingredientA: 'chili', ingredientB: 'sichuan_pepper', aromaCompatibility: 0.25, pungencySynergy: 0.65, bitternessRisk: 0.20, astringencyRisk: 0.50, explanation: 'Fuoco + formicolio: effetto amplificato. Interessante ma pericoloso a dosi alte.' },
    'cardamom::orange_peel': { ingredientA: 'cardamom', ingredientB: 'orange_peel', aromaCompatibility: 0.55, pungencySynergy: 0.0, bitternessRisk: 0.25, astringencyRisk: 0.20, explanation: 'L\'1,8-cineolo del cardamomo completa gli agrumi. Buona sinergia floreale-agrumata.' },
    'cardamom::cinnamon': { ingredientA: 'cardamom', ingredientB: 'cinnamon', aromaCompatibility: 0.50, pungencySynergy: 0.20, bitternessRisk: 0.35, astringencyRisk: 0.30, explanation: 'Classico mediorientale. Il cardamomo aggiunge freschezza alla cannella calda.' },
    'vanilla::nutmeg': { ingredientA: 'vanilla', ingredientB: 'nutmeg', aromaCompatibility: 0.65, pungencySynergy: 0.0, bitternessRisk: 0.10, astringencyRisk: 0.15, explanation: 'La dolcezza della vaniglia bilancia la speziatura della noce moscata. Ottima compatibilità.' },
    'vanilla::cinnamon': { ingredientA: 'vanilla', ingredientB: 'cinnamon', aromaCompatibility: 0.70, pungencySynergy: 0.0, bitternessRisk: 0.10, astringencyRisk: 0.20, explanation: 'Vedi cinnamon::vanilla (simmetrico).' },
    'vanilla::clove': { ingredientA: 'vanilla', ingredientB: 'clove', aromaCompatibility: 0.45, pungencySynergy: 0.10, bitternessRisk: 0.35, astringencyRisk: 0.40, explanation: 'La vaniglia può ammorbidire il chiodo ma non eliminare l\'astringenza. Usare chiodo come nota di sfondo.' },
    'ginger::cinnamon': { ingredientA: 'ginger', ingredientB: 'cinnamon', aromaCompatibility: 0.55, pungencySynergy: 0.40, bitternessRisk: 0.25, astringencyRisk: 0.30, explanation: 'Caldo + caldo: buona compatibilità invernale. Attenzione alla pungenza cumulativa.' },
    'ginger::lemon_peel': { ingredientA: 'ginger', ingredientB: 'lemon_peel', aromaCompatibility: 0.60, pungencySynergy: 0.15, bitternessRisk: 0.15, astringencyRisk: 0.20, explanation: 'Lo zenzero citrato con limone è un classico rinfrescante. Ottimo in Saison e Witbier.' },
    'allspice::cinnamon': { ingredientA: 'allspice', ingredientB: 'cinnamon', aromaCompatibility: 0.55, pungencySynergy: 0.30, bitternessRisk: 0.35, astringencyRisk: 0.40, explanation: 'Ridondanza parziale (il pimento sa già di cannella). Se li usi entrambi, riduci ciascuno del 40%.' },
    'allspice::clove': { ingredientA: 'allspice', ingredientB: 'clove', aromaCompatibility: 0.40, pungencySynergy: 0.30, bitternessRisk: 0.55, astringencyRisk: 0.65, explanation: 'Alta ridondanza (eugenolo in entrambi). Meglio sceglierne uno solo.' },
    'juniper::coriander_seed': { ingredientA: 'juniper', ingredientB: 'coriander_seed', aromaCompatibility: 0.50, pungencySynergy: 0.15, bitternessRisk: 0.35, astringencyRisk: 0.35, explanation: 'Terpeni condivisi (pineni). Buona compatibilità resinosa-agrumata. Ottimo in Saison e Farmhouse.' },
    'juniper::black_pepper': { ingredientA: 'juniper', ingredientB: 'black_pepper', aromaCompatibility: 0.45, pungencySynergy: 0.40, bitternessRisk: 0.40, astringencyRisk: 0.50, explanation: 'Resinoso + resinoso: può diventare monotematico. Meglio con una terza spezia agrumata.' },
    'long_pepper::cinnamon': { ingredientA: 'long_pepper', ingredientB: 'cinnamon', aromaCompatibility: 0.45, pungencySynergy: 0.50, bitternessRisk: 0.40, astringencyRisk: 0.45, explanation: 'Calore complesso e persistente. Ottimo in stout invernali ma con cautela.' },
};

function findInteraction(a: string, b: string): Interaction | undefined {
    return INTERACTIONS[interactKey(a, b)];
}

// ── Matching ─────────────────────────────────────────────────────────────────

function normalizeName(value: string): string {
    return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

function findAllSpiceMatches(raw: string): SpiceInfo[] {
    const query = normalizeName(raw);
    const exact = SPICES.filter(s => s.id === query || normalizeName(s.name) === query || s.aliases.some(a => normalizeName(a) === query));
    if (exact.length > 0) return exact;
    const candidates = SPICES.filter(s => normalizeName(s.name).includes(query) || s.aliases.some(a => normalizeName(a).includes(query)));
    return candidates.sort((a, b) => Math.abs(a.name.length - raw.length) - Math.abs(b.name.length - raw.length));
}

function findSpice(raw: string): SpiceInfo | undefined {
    const matches = findAllSpiceMatches(raw);
    if (matches.length === 0) return undefined;
    return matches[0];
}

// ── Dose computation ─────────────────────────────────────────────────────────

interface SpiceCalcInput {
    spice_name: string;
    batch_liters: number;
    intensity: IntensityLevel;
    form: SpiceForm;
    stage: AdditionStage;
    contact_time_hours: number;
    temperature_celsius: number;
    freshness: Freshness;
    capsaicinoids_mg_per_g?: number;
    shu?: number;
    beer_matrix: BeerMatrixInput;
    /** Names of other spices already in the recipe (for interaction analysis). */
    other_spices: string[];
}

interface SpiceDoseOutput {
    /** Recommended dose in grams. */
    doseRecommendedG: number;
    /** Low end of operational range. */
    doseMinG: number;
    /** High end of operational range. */
    doseMaxG: number;
    /** Expected intensity on the 0-1 scale for each dimension. */
    contributions: {
        aroma: number;
        pungency: number;
        bitterness: number;
        astringency: number;
        cooling: number;
    };
    /** How confident the model is (0-1). */
    confidence: number;
    /** Factors reducing confidence. */
    confidenceNotes: string[];
    /** Best addition method recommendation. */
    recommendedMethod: string;
    /** Incremental dosing protocol. */
    adjustmentProtocol: string;
    /** Risk flags. */
    risks: string[];
    /** Compatibility notes with other spices. */
    compatibilityNotes: string[];
    /** General brewing tips. */
    tips: string[];
}

function computeSpiceDose(input: SpiceCalcInput): SpiceDoseOutput {
    // ── 1. Find the spice ──
    const matches = findAllSpiceMatches(input.spice_name);
    if (matches.length === 0) {
        throw new Error(`Spezia "${input.spice_name}" non trovata nel database.`);
    }
    const spice = matches[0]!;

    // ── 2. Handle chili specially ──
    const isChili = spice.id === 'chili';

    // ── 3. Get reference dosage range ──
    const refRange = spice[input.intensity];
    if (isChili && !input.capsaicinoids_mg_per_g && !input.shu) {
        return buildChiliUnknownResult(spice, input);
    }

    // ── 4. Form: normalize vs referenceForm ──
    const form = FORMS[input.form];
    const refForm = FORMS[spice.referenceForm];

    // Relative extraction: >1 = extracts more than reference → need LESS grams
    const relativeVolatileExtract = form.volatileExtractSpeed / Math.max(0.01, refForm.volatileExtractSpeed);
    const relativeNonVolatileExtract = form.nonVolatileExtractSpeed / Math.max(0.01, refForm.nonVolatileExtractSpeed);

    // ── 5. Stage + time + temperature — saturating extraction model ──
    const stage = STAGES[input.stage];
    const timeHours = clamp(input.contact_time_hours, 0.05, 720);
    const tempC = Math.max(0, input.temperature_celsius);

    // Temperature-dependent rate constant k (per hour)
    // Reference k at 20°C: ~0.03/h for volatiles, ~0.02/h for non-volatiles
    const tempKMultiplier = Math.pow(1.8, (tempC - 20) / 10); // milder than Q10=2
    const kVolatile = 0.03 * tempKMultiplier;
    const kNonVolatile = 0.02 * tempKMultiplier;

    // Saturating extraction: fraction = 1 - exp(-k * t)
    const volatileExtractFraction = 1 - Math.exp(-kVolatile * timeHours);
    const nonVolatileExtractFraction = 1 - Math.exp(-kNonVolatile * timeHours);

    // Volatile retention: some are lost to evaporation/degradation (stage × form dependent)
    const effectiveHeatLoss = stage.volatileEvaporation * form.volatileHeatLoss;
    const volatileRetention = effectiveHeatLoss < 1
        ? Math.exp(-effectiveHeatLoss * 3 * volatileExtractFraction)
        : 0.05;

    // Effective extraction: what actually ends up in the beer
    const effectiveVolatileExtract = volatileExtractFraction * volatileRetention * stage.volatileExtract;
    const effectiveNonVolatileExtract = nonVolatileExtractFraction * stage.nonVolatileExtract;

    // Reference extraction (reference form at 20°C, 72h, conditioning stage)
    const refKVolatile = 0.03;
    const refKNonVolatile = 0.02;
    const refTimeHours = 72;
    const refVolatileFraction = 1 - Math.exp(-refKVolatile * refTimeHours);
    const refNonVolatileFraction = 1 - Math.exp(-refKNonVolatile * refTimeHours);
    const refStage = STAGES['conditioning'];
    const refVolatileRetention = Math.exp(-refStage.volatileEvaporation * 3 * refVolatileFraction);
    const refEffectiveVolatile = refVolatileFraction * refVolatileRetention * refStage.volatileExtract;
    const refEffectiveNonVolatile = refNonVolatileFraction * refStage.nonVolatileExtract;

    // Dose = referenceDose / (relativeExtraction × relativeForm)
    // More extraction → divide → less grams
    const volatileDoseDivisor = (effectiveVolatileExtract / Math.max(0.01, refEffectiveVolatile)) * relativeVolatileExtract;
    const nonVolatileDoseDivisor = (effectiveNonVolatileExtract / Math.max(0.01, refEffectiveNonVolatile)) * relativeNonVolatileExtract;

    // ── 6. Potency / freshness ──
    const potencyFactor = potencyMultiplier(input.freshness);

    // ── 7. Matrix factors ──
    const matrix = computeMatrixFactors(input.beer_matrix);

    // Extraction factor: ABV affects physical extraction
    const extractionBoost = matrix.extractionFactor;

    // Masking: roast & FG mask aroma perception → need MORE grams to compensate
    const aromaMasking = matrix.maskingFactor.aroma;
    // Perception amplification: >1 means the beer amplifies perceived intensity → need FEWER grams
    const aromaAmplification = matrix.perceptionAmplification.aroma;

    // ── 8. Blend aroma/pungency dose divisors ──
    const aromaWeight = spice.profile.aroma / (spice.profile.aroma + spice.profile.pungency + 0.01);
    const pungencyWeight = spice.profile.pungency / (spice.profile.aroma + spice.profile.pungency + 0.01);

    // Aroma dose: reference / (extraction * form * potency * extractionBoost * amplification * masking)
    // masking < 1 → divisor shrinks → dose increases (correct: need more grams when beer masks aroma)
    const aromaDoseDivisor = volatileDoseDivisor * potencyFactor * extractionBoost * aromaAmplification * Math.max(0.4, aromaMasking);
    const pungencyDoseDivisor = nonVolatileDoseDivisor * potencyFactor * extractionBoost * matrix.perceptionAmplification.pungency;
    const blendedDoseDivisor = aromaDoseDivisor * aromaWeight + pungencyDoseDivisor * pungencyWeight;

    // ── 9. Chili: intensity-aware SHU-based reference ──
    let refMin = refRange.min;
    let refMax = refRange.max;
    let refRec = refRange.recommend;

    if (isChili) {
        // Empirical baseline: 1 g dried chili @ 40,000 SHU in 20L ≈ medium intensity
        // (assumes ~65% extraction; actual perception depends on matrix)
        const CHILI_REFERENCE_SHU = 40_000;
        const chiliIntensityFactor = { low: 0.4, medium: 1.0, high: 1.8 }[input.intensity];
        if (input.shu) {
            const shuScale = CHILI_REFERENCE_SHU / Math.max(100, input.shu);
            refRec = 1.0 * shuScale * chiliIntensityFactor;
            refMin = refRec * 0.6;
            refMax = refRec * 1.8;
        } else if (input.capsaicinoids_mg_per_g) {
            // Capsaicinoids in mg/g → approximate SHU: 1 mg/g ≈ 15,000 SHU
            const approxShu = input.capsaicinoids_mg_per_g * 15000;
            const shuScale = CHILI_REFERENCE_SHU / Math.max(1500, approxShu);
            refRec = 1.0 * shuScale * chiliIntensityFactor;
            refMin = refRec * 0.6;
            refMax = refRec * 1.8;
        }
    }

    // ── 10. Scale from 20L reference to actual batch size, divide by efficiency ──
    const batchScale = input.batch_liters / 20;
    const safeDivisor = Math.max(0.15, blendedDoseDivisor);
    const doseRecommendedG = refRec * batchScale / safeDivisor;
    const doseMinG = refMin * batchScale / safeDivisor;
    const doseMaxG = refMax * batchScale / safeDivisor;

    // ── 11. Compute sensory contributions from actual dose ──
    // effectiveDose_gL = dose × extraction × relativeForm × potency × extractionBoost / volume
    // Must match the same factors used to scale the dose, so perceived intensity is consistent
    const effectiveVolatileDoseGL = doseRecommendedG * effectiveVolatileExtract * relativeVolatileExtract * potencyFactor * extractionBoost / input.batch_liters;
    const effectiveNonVolatileDoseGL = doseRecommendedG * effectiveNonVolatileExtract * relativeNonVolatileExtract * potencyFactor * extractionBoost / input.batch_liters;

    // Half-saturation doses (g/L effective) — the dose where perception reaches 50%
    const halfSatVolatileGL = 0.5;   // 0.5 g/L effective volatiles = 50% perceived aroma
    const halfSatNonVolatileGL = 0.3;

    // Hill-type saturation curve: intensity = dose^n / (ec50^n + dose^n)
    // Use n=1 (Michaelis-Menten) for most; n=2 (sigmoid) for steep-curve spices
    const hillNAroma = spice.pungencyProfile === 'persistent' ? 2 : 1;
    const hillNPungency = spice.pungencyProfile === 'building' ? 2 : 1;

    const rawAroma = Math.pow(effectiveVolatileDoseGL, hillNAroma) /
        (Math.pow(halfSatVolatileGL, hillNAroma) + Math.pow(effectiveVolatileDoseGL, hillNAroma));
    const rawPungency = Math.pow(effectiveNonVolatileDoseGL, hillNPungency) /
        (Math.pow(halfSatNonVolatileGL, hillNPungency) + Math.pow(effectiveNonVolatileDoseGL, hillNPungency));

    // Apply perception amplification and masking to the raw intensity
    const contributions = {
        aroma: clamp01(rawAroma * spice.profile.aroma * aromaAmplification * aromaMasking),
        pungency: clamp01(rawPungency * spice.profile.pungency * matrix.perceptionAmplification.pungency),
        bitterness: clamp01(rawPungency * spice.profile.bitterness * matrix.perceptionAmplification.bitterness),
        astringency: clamp01(rawPungency * spice.profile.astringency * matrix.perceptionAmplification.astringency),
        cooling: clamp01(rawAroma * spice.profile.cooling * matrix.perceptionAmplification.cooling),
    };

    // ── 12. Confidence ──
    let confidence = 0.80;
    const confidenceNotes: string[] = [];

    if (isChili) {
        if (input.shu) {
            confidence -= 0.10;
            confidenceNotes.push('Variabilità SHU: il valore nominale può differire dal lotto reale fino al 30%.');
        }
        if (input.capsaicinoids_mg_per_g) {
            confidence -= 0.05;
        }
        if (!input.shu && !input.capsaicinoids_mg_per_g) {
            confidence = 0.30;
            confidenceNotes.push('Nessun SHU o capsaicinoidi dichiarati: intervallo ampio e incerto.');
        }
    }

    if (input.form === 'ground') {
        confidence -= 0.05;
        confidenceNotes.push('Forma macinata: estrazione rapida ma difficile da rimuovere e dosare con precisione.');
    }
    if (input.form === 'fresh') {
        confidence -= 0.10;
        confidenceNotes.push('Fresco: contenuto d\'acqua e potenza variabili con cultivar e stagione.');
    }
    if (input.freshness === 'unknown') {
        confidence -= 0.10;
        confidenceNotes.push('Freschezza sconosciuta: l\'olio essenziale potrebbe essere degradato.');
    }
    if (input.freshness === 'older') {
        confidence -= 0.15;
        confidenceNotes.push('Spezia non fresca: perdita significativa di volatili attesa.');
    }
    if (input.contact_time_hours > 168) {
        confidence -= 0.05;
        confidenceNotes.push('Contatto prolungato (>7gg): possibile estrazione di tannini e note legnose.');
    }
    if (input.temperature_celsius > 80 && input.stage !== 'boil') {
        confidence -= 0.05;
        confidenceNotes.push('Temperatura >80°C: possibile degradazione termica di alcuni volatili.');
    }

    // Oil range variability
    const oilRange = spice.oilRangePercent;
    if (oilRange && oilRange[0] > 0 && oilRange[1] > 0 && oilRange[1] / oilRange[0] > 3) {
        confidence -= 0.10;
        confidenceNotes.push(`Forte variabilità dell'olio essenziale (${oilRange[0].toFixed(1)}-${oilRange[1].toFixed(1)}%): due lotti possono differire significativamente.`);
    }

    confidence = clamp(confidence, 0.1, 0.95);

    // ── 13. Method recommendation ──
    const practicallyRemovable = stage.removable && form.removable;
    const recommendedMethod = input.stage === 'tincture'
        ? 'Tintura: aggiungere goccia a goccia su campione da 100 mL fino a intensità desiderata, poi scalare al volume totale.'
        : practicallyRemovable
            ? `${stage.label} (${form.label}): aggiungere in sacchetto/sacco per rimozione facile. Assaggiare ogni 12-24 ore. Rimuovere quando l'intensità raggiunge ~80% del target (continuerà a estrarre brevemente dopo la rimozione).`
            : `${stage.label} (${form.label}): metodo non rimovibile. Iniziare con il 70% della dose consigliata, assaggiare dopo 24 ore, aggiungere il resto se necessario.`;

    // ── 14. Adjustment protocol ──
    const sampleLiters = 0.2;
    const sampleDoseG = doseRecommendedG * sampleLiters / input.batch_liters;
    const isMicroscopicDose = sampleDoseG < 0.1;

    const adjustmentProtocol = input.stage === 'tincture'
        ? `1. Preparare tintura separata (${spice.name} in alcool neutro 40-50% per 7-14 giorni). 2. Prelevare 100 mL di birra. 3. Aggiungere tintura goccia a goccia, assaggiare. 4. Annotare gocce necessarie. 5. Scalare: (gocce × volume_totale / 100) = gocce totali.`
        : isMicroscopicDose
            ? `1. Preparare una tintura madre con 1,00 g di ${spice.name} in 100 mL di alcool neutro al 40-50%. ` +
              `2. Estrarre 7 giorni, agitando quotidianamente, quindi filtrare. ` +
              `3. La tintura rappresenta ~10 mg/mL di spezia caricata (non necessariamente estratta). ` +
              `4. Prelevare 200 mL di birra. ` +
              `5. Aggiungere ${(sampleDoseG * 100).toFixed(1)} mL di tintura. ` +
              `6. Mescolare, attendere 10-15 minuti e assaggiare. ` +
              `7. Ripetere a incrementi del 10-20%. ` +
              `Nota: il bench trial con tintura approssima il dosaggio aromatico, ma non necessariamente lo stesso rapporto aroma/amaro/astringenza del contatto diretto.`
            : `1. Preparare un bench trial: prelevare 200 mL di birra. 2. Aggiungere ${sampleDoseG.toFixed(1)} g di spezia. 3. Assaggiare dopo ${input.contact_time_hours <= 12 ? input.contact_time_hours : 12} ore. 4. Regolare la dose principale proporzionalmente. 5. Se possibile, usare infusione rimovibile e assaggiare ogni 12-24 ore.`;

    // ── 15. Risks ──
    const risks = [...spice.risks];
    if (contributions.pungency > 0.6) risks.push('Pungenza elevata. Ridurre del 25% e ri-assaggiare.');
    if (contributions.astringency > 0.5) risks.push('Astringenza significativa. Valutare rimozione anticipata o riduzione dose.');
    if (contributions.bitterness > 0.5 && input.beer_matrix.ibu && input.beer_matrix.ibu > 50) {
        risks.push('Possibile sommatoria sgradevole con amaro del luppolo (>50 IBU).');
    }
    if (matrix.hopOverlapRisk > 0.3 && spice.keyVolatiles.some(v => v.includes('pinene') || v.includes('caryophyllene') || v.includes('limonene'))) {
        risks.push('Rischio di sovrapposizione terpenica con luppoli (pineni, cariofillene, limonene). Può risultare confuso o "verde".');
    }

    // ── 16. Compatibility with other spices ──
    const compatibilityNotes: string[] = [];
    for (const otherName of input.other_spices) {
        const other = findSpice(otherName);
        if (!other || other.id === spice.id) continue;
        const ix = findInteraction(spice.id, other.id);
        if (ix) {
            const emoji = ix.aromaCompatibility > 0.4 ? '✅' : ix.aromaCompatibility > 0 ? '⚠️' : '❌';
            compatibilityNotes.push(`${emoji} **${other.name}**: ${ix.explanation}`);
            if (ix.pungencySynergy > 0.5) {
                risks.push(`Sinergia pungente con ${other.name}. Valutare una riduzione iniziale fino al ${Math.round(ix.pungencySynergy * 50)}% se l'altra spezia è già dosata a intensità media o alta.`);
            }
            if (ix.bitternessRisk > 0.5) {
                risks.push(`Rischio amaro cumulativo con ${other.name}. Considerare rimozione anticipata.`);
            }
            if (ix.astringencyRisk > 0.6) {
                risks.push(`Alta astringenza cumulativa con ${other.name}. Ridurre le dosi o scegliere una sola spezia dominante.`);
            }
        } else {
            compatibilityNotes.push(`ℹ️ **${other.name}**: nessun dato di interazione specifico. Procedere con bench trial.`);
        }
    }

    // ── 17. Tips ──
    const tips: string[] = [];
    if (input.stage === 'boil') tips.push('Bollitura: aggiungere a -5 minuti per preservare i volatili più delicati.');
    if (input.stage === 'whirlpool') tips.push('Whirlpool: 15-30 min a 80-90°C è il punto ottimale per molte spezie.');
    if (input.form === 'ground') tips.push('Polvere: difficile da rimuovere. Considerare filtrazione fine o cold crash prima del confezionamento.');
    if (input.form === 'whole' && input.stage !== 'boil') tips.push('Intero: schiacciare o spezzare leggermente prima dell\'uso per favorire l\'estrazione.');
    if (input.beer_matrix.roastIntensity > 0.3) tips.push('Malti tostati mascherano aromi delicati. Aumentare la dose del 10-15% o scegliere spezie più robuste.');
    if (input.beer_matrix.acidity > 0.3) tips.push('Birra acida: esalta freschezza e agrumi ma può rendere aggressivi zenzero, peperoncino e chiodo di garofano.');

    return {
        doseRecommendedG: Math.round(doseRecommendedG * 10) / 10,
        doseMinG: Math.round(doseMinG * 10) / 10,
        doseMaxG: Math.round(doseMaxG * 10) / 10,
        contributions: {
            aroma: Math.round(contributions.aroma * 100),
            pungency: Math.round(contributions.pungency * 100),
            bitterness: Math.round(contributions.bitterness * 100),
            astringency: Math.round(contributions.astringency * 100),
            cooling: Math.round(contributions.cooling * 100),
        },
        confidence,
        confidenceNotes,
        recommendedMethod,
        adjustmentProtocol,
        risks: [...new Set(risks)],
        compatibilityNotes,
        tips: [...new Set(tips)],
    };
}

function buildChiliUnknownResult(spice: SpiceInfo, input: SpiceCalcInput): SpiceDoseOutput {
    return {
        doseRecommendedG: 0,
        doseMinG: 0,
        doseMaxG: 0,
        contributions: { aroma: 0, pungency: 0, bitterness: 0, astringency: 0, cooling: 0 },
        confidence: 0.15,
        confidenceNotes: [
            'IMPOSSIBILE DOSARE senza SHU o capsaicinoidi_mg_per_g.',
            'La capsaicina varia di oltre 100× tra varietà (es. habanero vs ancho).',
            'Fornire il valore SHU della varietà o il contenuto di capsaicinoidi per una stima utile.',
        ],
        recommendedMethod: 'Bench trial obbligatorio: preparare una tintura o infusione separata e aggiungere goccia a goccia su un campione misurato.',
        adjustmentProtocol: '1. Identificare la varietà e il suo SHU. 2. Preparare tintura con 2-5 g di peperoncino secco in 50 mL alcool 50% per 7 gg. 3. Aggiungere goccia a goccia a 100 mL di birra. 4. Scalare dal numero di gocce.',
        risks: [
            ...spice.risks,
            'Senza SHU, anche un "peperoncino medio" può variare da impercettibile a incontrollabile.',
        ],
        compatibilityNotes: [],
        tips: [
            'Per birre commerciali, usare estratto standardizzato di capsaicina per ripetibilità.',
            'Ancho/pasilla/guajillo: poco piccanti, più aromatici.',
            'Cayenne/thai: mediamente piccanti.',
            'Habanero/scotch bonnet/ghost: estremamente piccanti.',
        ],
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function contributionLabel(v: number): string {
    if (v >= 75) return 'molto alto';
    if (v >= 55) return 'alto';
    if (v >= 35) return 'medio';
    if (v >= 15) return 'basso';
    return 'molto basso';
}

function confidenceLabel(c: number): string {
    if (c >= 0.75) return 'alta';
    if (c >= 0.50) return 'media';
    if (c >= 0.30) return 'bassa';
    return 'molto bassa';
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatSpiceResults(input: SpiceCalcInput): string {
    const lines: string[] = [];
    lines.push(`# 🌶️ Spice Calculator: ${input.spice_name} in ${input.batch_liters}L`);
    lines.push('');

    const matches = findAllSpiceMatches(input.spice_name);
    if (matches.length === 0) {
        lines.push(`⚠️ **"${input.spice_name}" non trovata.** Spezie disponibili:`);
        for (const s of SPICES) lines.push(`- ${s.name}`);
        return lines.join('\n');
    }

    const spice = matches[0]!;
    const ambiguous = matches.length > 1 ? matches.slice(1).map(s => s.name) : [];
    const result = computeSpiceDose(input);
    const formLabel = FORMS[input.form].label;
    const stageLabel = STAGES[input.stage].label;

    // ── Header ──
    lines.push('## 📊 Parametri');
    lines.push('');
    lines.push('| Parametro | Valore |');
    lines.push('|---|---|');
    lines.push(`| Spezia | **${spice.name}** |`);
    if (ambiguous.length > 0) lines.push(`| ⚠️ Ambiguità | Trovati anche: ${ambiguous.join(', ')}. Specifica il nome esatto. |`);
    lines.push(`| Intensità desiderata | **${input.intensity === 'low' ? 'Bassa' : input.intensity === 'medium' ? 'Media' : 'Alta'}** |`);
    lines.push(`| Forma | ${formLabel} |`);
    lines.push(`| Stadio | ${stageLabel} |`);
    lines.push(`| Tempo di contatto | ${input.contact_time_hours} ore |`);
    lines.push(`| Temperatura | ${input.temperature_celsius}°C |`);
    lines.push(`| Freschezza | ${input.freshness === 'freshly_cracked' ? 'Appena spezzata/macinata' : input.freshness === 'recent' ? 'Recente' : input.freshness === 'older' ? 'Non freschissima' : 'Sconosciuta'} |`);
    lines.push(`| Volume birra | ${input.batch_liters} L |`);
    lines.push(`| ABV | ${input.beer_matrix.abv}% |`);
    if (input.beer_matrix.finalGravity) lines.push(`| FG | ${input.beer_matrix.finalGravity.toFixed(3)} |`);
    if (input.beer_matrix.ibu) lines.push(`| IBU | ${input.beer_matrix.ibu} |`);
    if (input.beer_matrix.roastIntensity > 0) lines.push(`| Intensità tostato | ${(input.beer_matrix.roastIntensity * 100).toFixed(0)}% |`);
    if (input.beer_matrix.hopAromaIntensity > 0) lines.push(`| Aroma luppolo | ${(input.beer_matrix.hopAromaIntensity * 100).toFixed(0)}% |`);
    if (input.beer_matrix.acidity > 0) lines.push(`| Acidità | ${(input.beer_matrix.acidity * 100).toFixed(0)}% |`);
    if (isChiliInput(input)) {
        if (input.shu) lines.push(`| SHU | ${input.shu} |`);
        if (input.capsaicinoids_mg_per_g) lines.push(`| Capsaicinoidi | ${input.capsaicinoids_mg_per_g} mg/g |`);
    }
    if (input.other_spices.length > 0) lines.push(`| Altre spezie | ${input.other_spices.join(', ')} |`);
    lines.push('');

    // ── Dosage ──
    lines.push('## 🎯 Dosaggio consigliato');
    lines.push('');
    lines.push(`| | Grammi | g/L |`);
    lines.push(`|---|---|---|`);
    if (result.doseRecommendedG > 0) {
        lines.push(`| **Consigliato** | **${result.doseRecommendedG.toFixed(1)} g** | ${(result.doseRecommendedG / input.batch_liters).toFixed(2)} g/L |`);
        lines.push(`| Min | ${result.doseMinG.toFixed(1)} g | ${(result.doseMinG / input.batch_liters).toFixed(2)} g/L |`);
        lines.push(`| Max | ${result.doseMaxG.toFixed(1)} g | ${(result.doseMaxG / input.batch_liters).toFixed(2)} g/L |`);
    } else {
        lines.push(`| **Consigliato** | **NON DETERMINABILE** | — |`);
        lines.push(`| Min | NON DETERMINABILE | — |`);
        lines.push(`| Max | NON DETERMINABILE | — |`);
    }
    lines.push('');
    lines.push(`**Confidenza:** ${confidenceLabel(result.confidence)} (${(result.confidence * 100).toFixed(0)}%)`);
    lines.push('');
    lines.push('> ⚠️ Intervallo indicativo basato su euristiche sensoriali ed empiriche. La potenza reale dipende dal lotto specifico, dall\'origine e dalla cultivar. **Fare sempre un bench trial.**');

    if (result.confidenceNotes.length > 0) {
        lines.push('');
        lines.push('### Fattori che riducono la confidenza');
        for (const n of result.confidenceNotes) {
            lines.push(`- ${n}`);
        }
    }
    lines.push('');

    // ── Sensory contributions ──
    lines.push('## 👃 Contributi sensoriali attesi');
    lines.push('');
    lines.push('| Dimensione | Intensità |');
    lines.push('|---|---|');
    lines.push(`| Aroma | ${contributionLabel(result.contributions.aroma)} (${result.contributions.aroma}%) |`);
    lines.push(`| Pungenza / calore | ${contributionLabel(result.contributions.pungency)} (${result.contributions.pungency}%) |`);
    lines.push(`| Amaro | ${contributionLabel(result.contributions.bitterness)} (${result.contributions.bitterness}%) |`);
    lines.push(`| Astringenza | ${contributionLabel(result.contributions.astringency)} (${result.contributions.astringency}%) |`);
    lines.push(`| Raffrescante | ${contributionLabel(result.contributions.cooling)} (${result.contributions.cooling}%) |`);
    lines.push('');

    // ── Method recommendation ──
    lines.push('## 🔧 Metodo consigliato');
    lines.push('');
    lines.push(`> ${result.recommendedMethod}`);
    lines.push('');

    // ── Protocol ──
    lines.push('### Protocollo di aggiustamento');
    lines.push('');
    lines.push(result.adjustmentProtocol);
    lines.push('');

    // ── Compatibility ──
    if (result.compatibilityNotes.length > 0) {
        lines.push('## 🔗 Compatibilità con altre spezie');
        lines.push('');
        for (const c of result.compatibilityNotes) {
            lines.push(`- ${c}`);
        }
        lines.push('');
    }

    // ── Tips ──
    if (result.tips.length > 0) {
        lines.push('## 💡 Consigli');
        lines.push('');
        for (const t of result.tips) {
            lines.push(`- ${t}`);
        }
        lines.push('');
    }

    // ── Risks ──
    if (result.risks.length > 0) {
        lines.push('## ⚠️ Rischi');
        lines.push('');
        for (const r of result.risks) {
            lines.push(`- ${r}`);
        }
        lines.push('');
    }

    // ── Key compounds ──
    lines.push('## 🧪 Profilo chimico indicativo');
    lines.push('');
    lines.push(`**Volatili principali:** ${spice.keyVolatiles.join(', ')}`);
    lines.push(`**Attivi non volatili:** ${spice.keyActives.join(', ')}`);
    if (spice.oilRangePercent) {
        lines.push(`**Olio essenziale:** ~${spice.oilRangePercent[0].toFixed(1)}–${spice.oilRangePercent[1].toFixed(1)}% (variabile con origine e cultivar)`);
    } else {
        lines.push('**Olio essenziale:** dato non calibrato nel database');
    }
    if (spice.pungencyProfile === 'building') lines.push('**Profilo pungenza:** si accumula gradualmente — non giudicare dal primo assaggio.');
    if (spice.pungencyProfile === 'persistent') lines.push('**Profilo pungenza:** molto persistente — può dominare anche a dosi moderate.');
    lines.push('');

    // ── Sensory profile radar summary ──
    lines.push('### Profilo sensoriale di riferimento');
    lines.push('');
    const p = spice.profile;
    lines.push('```');
    lines.push(`Aroma:      ${'█'.repeat(Math.round(p.aroma * 20))}${'░'.repeat(20 - Math.round(p.aroma * 20))}`);
    lines.push(`Pungenza:   ${'█'.repeat(Math.round(p.pungency * 20))}${'░'.repeat(20 - Math.round(p.pungency * 20))}`);
    lines.push(`Amaro:      ${'█'.repeat(Math.round(p.bitterness * 20))}${'░'.repeat(20 - Math.round(p.bitterness * 20))}`);
    lines.push(`Astringenza:${'█'.repeat(Math.round(p.astringency * 20))}${'░'.repeat(20 - Math.round(p.astringency * 20))}`);
    lines.push(`Raffrescante:${'█'.repeat(Math.round(p.cooling * 20))}${'░'.repeat(20 - Math.round(p.cooling * 20))}`);
    lines.push('```');
    lines.push('');

    // ── All intensities table ──
    lines.push('## 📋 Tabella per tutte le intensità');
    lines.push('');
    lines.push('| Intensità | g (per 20L, forma di riferimento) | Note |');
    lines.push('|---|---|---|');
    lines.push(`| Bassa | ${spice.low.min}–${spice.low.max} g | ${spice.low.recommend > 0 ? `consigliato ~${spice.low.recommend} g` : 'non determinabile senza SHU'} |`);
    lines.push(`| Media | ${spice.medium.min}–${spice.medium.max} g | ${spice.medium.recommend > 0 ? `consigliato ~${spice.medium.recommend} g` : 'non determinabile senza SHU'} |`);
    lines.push(`| Alta | ${spice.high.min}–${spice.high.max} g | ${spice.high.recommend > 0 ? `consigliato ~${spice.high.recommend} g` : 'non determinabile senza SHU'} |`);
    lines.push('');
    lines.push(`*Forma di riferimento: ${FORMS[spice.referenceForm].label} — ${spice.notes}*`);
    lines.push('');

    lines.push('---');
    lines.push('*I dosaggi sono punti di partenza basati su euristiche sensoriali ed empiriche. La composizione chimica degli oli essenziali varia con origine, cultivar, annata e conservazione. Regola sempre in base al tuo lotto specifico e fai bench trial.*');

    return lines.join('\n');
}

function isChiliInput(input: SpiceCalcInput): boolean {
    const matches = findAllSpiceMatches(input.spice_name);
    return matches.length > 0 && matches[0]!.id === 'chili';
}

// ── Input schema ─────────────────────────────────────────────────────────────

export const SpiceCalculatorInputSchema = z.object({
    spice_name: z.string().trim().min(1).describe('Nome della spezia principale in italiano. Es: "Pepe nero", "Coriandolo", "Cannella".'),
    batch_liters: z.number().positive().describe('Volume della birra a cui aggiungere la spezia (L).'),
    intensity: z.enum(['low', 'medium', 'high']).default('medium').describe('Intensità desiderata: low, medium, high.'),
    form: z.enum(['whole', 'cracked', 'ground', 'fresh', 'dried', 'tincture', 'extract']).default('cracked').describe('Forma fisica della spezia.'),
    stage: z.enum(['mash', 'boil', 'whirlpool', 'fermentation', 'conditioning', 'keg', 'tincture']).default('conditioning').describe('Stadio di aggiunta.'),
    contact_time_hours: z.number().positive().default(72).describe('Tempo di contatto previsto in ore (es. 72 per 3 giorni).'),
    temperature_celsius: z.number().min(0).max(100).default(20).describe('Temperatura durante il contatto (°C).'),
    freshness: z.enum(['freshly_cracked', 'recent', 'older', 'unknown']).default('recent').describe('Freschezza della spezia.'),
    capsaicinoids_mg_per_g: z.number().positive().optional().describe('Solo per peperoncino: capsaicinoidi in mg/g.'),
    shu: z.number().positive().optional().describe('Solo per peperoncino: gradi Scoville (SHU).'),
    abv: z.number().min(0).max(20).default(5).describe('ABV della birra (%).'),
    final_gravity: z.number().min(1.000).max(1.200).optional().describe('Gravità finale (es. 1.012).'),
    ibu: z.number().min(0).max(200).optional().describe('IBU della birra.'),
    roast_intensity: z.number().min(0).max(1).default(0).describe('Intensità dei malti tostati (0-1).'),
    hop_aroma_intensity: z.number().min(0).max(1).default(0).describe('Intensità aromatica del luppolo (0-1).'),
    acidity: z.number().min(0).max(1).default(0).describe('Acidità percepita (0-1, 0=non acida).'),
    other_spices: z.array(z.string().trim().min(1)).default([]).describe('Altre spezie già presenti nella ricetta.'),
    show_details: z.boolean().default(true).describe('Mostra dettagli completi.'),
});

export type SpiceCalculatorInput = z.infer<typeof SpiceCalculatorInputSchema>;

// ── Tool ─────────────────────────────────────────────────────────────────────

const SPICE_CALCULATOR_PARAMETERS: Record<string, unknown> = {
    type: 'object',
    properties: {
        spice_name: { type: 'string', description: 'Nome della spezia principale in italiano. Es: "Pepe nero", "Coriandolo", "Cannella", "Zenzero", "Chiodo di garofano".' },
        batch_liters: { type: 'number', exclusiveMinimum: 0, description: 'Volume della birra a cui aggiungere la spezia (L).' },
        intensity: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium', description: 'Intensità desiderata: low (bassa), medium (media), high (alta).' },
        form: { type: 'string', enum: ['whole', 'cracked', 'ground', 'fresh', 'dried', 'tincture', 'extract'], default: 'cracked', description: 'Forma fisica: whole (intero), cracked (spezzato), ground (macinato), fresh (fresco), dried (essiccato), tincture (tintura), extract (estratto).' },
        stage: { type: 'string', enum: ['mash', 'boil', 'whirlpool', 'fermentation', 'conditioning', 'keg', 'tincture'], default: 'conditioning', description: 'Stadio di aggiunta: mash, boil (bollitura), whirlpool, fermentation, conditioning (maturazione/dry-spice), keg (fusto), tincture (tintura separata).' },
        contact_time_hours: { type: 'number', exclusiveMinimum: 0, default: 72, description: 'Tempo di contatto previsto in ore (es. 72 per 3 giorni).' },
        temperature_celsius: { type: 'number', minimum: 0, maximum: 100, default: 20, description: 'Temperatura durante il contatto (°C).' },
        freshness: { type: 'string', enum: ['freshly_cracked', 'recent', 'older', 'unknown'], default: 'recent', description: 'Freschezza: freshly_cracked (appena spezzata), recent (recente), older (non freschissima), unknown (sconosciuta).' },
        capsaicinoids_mg_per_g: { type: 'number', exclusiveMinimum: 0, description: 'Solo per peperoncino: contenuto di capsaicinoidi in mg/g.' },
        shu: { type: 'number', exclusiveMinimum: 0, description: 'Solo per peperoncino: gradi Scoville (SHU). Es: cayenna ~40000, habanero ~200000.' },
        abv: { type: 'number', minimum: 0, maximum: 20, default: 5, description: 'ABV della birra (%).' },
        final_gravity: { type: 'number', minimum: 1.000, maximum: 1.200, description: 'Gravità finale (es. 1.012). Opzionale.' },
        ibu: { type: 'number', minimum: 0, maximum: 200, description: 'IBU della birra. Opzionale.' },
        roast_intensity: { type: 'number', minimum: 0, maximum: 1, default: 0, description: 'Intensità dei malti tostati (0 = nessuno, 1 = molto tostato).' },
        hop_aroma_intensity: { type: 'number', minimum: 0, maximum: 1, default: 0, description: 'Intensità aromatica del luppolo (0 = nessuna, 1 = molto luppolata).' },
        acidity: { type: 'number', minimum: 0, maximum: 1, default: 0, description: 'Acidità percepita (0 = non acida, 1 = molto acida).' },
        other_spices: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            default: [],
            description: 'Altre spezie già presenti nella ricetta per analisi di compatibilità.',
        },
        show_details: { type: 'boolean', default: true, description: 'Mostra dettagli completi (contributi sensoriali, profilo chimico, rischi).' },
    },
    required: ['spice_name', 'batch_liters'],
    additionalProperties: false,
};

export class SpiceCalculatorTool implements BuiltinTool<SpiceCalculatorInput> {
    readonly name = 'spice_calculator' as const;
    readonly description = 'Stima il dosaggio di spezie e aromatizzanti per birra. Separa dose aromatica (volatili) dalla dose chemestetica (pungenza, calore). Considera forma fisica, stadio di aggiunta, tempo, temperatura, matrice della birra (ABV, FG, IBU, tostato, acidità), interazioni tra spezie e freschezza. Restituisce un intervallo con livello di confidenza, rischi e protocollo di aggiustamento incrementale. Supporta peperoncino con input SHU o capsaicinoidi.';
    readonly parameters = SPICE_CALCULATOR_PARAMETERS;

    resolveExecution(args: SpiceCalculatorInput): ToolExecution {
        return {
            description: `Spice calc: ${args.spice_name} @ ${args.intensity}`,
            approvalRule: this.name,
            execute: () => {
                try {
                    const input: SpiceCalcInput = {
                        spice_name: args.spice_name,
                        batch_liters: args.batch_liters,
                        intensity: args.intensity,
                        form: args.form,
                        stage: args.stage,
                        contact_time_hours: args.contact_time_hours,
                        temperature_celsius: args.temperature_celsius,
                        freshness: args.freshness,
                        capsaicinoids_mg_per_g: args.capsaicinoids_mg_per_g,
                        shu: args.shu,
                        beer_matrix: {
                            abv: args.abv,
                            finalGravity: args.final_gravity,
                            ibu: args.ibu,
                            roastIntensity: args.roast_intensity,
                            hopAromaIntensity: args.hop_aroma_intensity,
                            acidity: args.acidity,
                        },
                        other_spices: args.other_spices ?? [],
                    };
                    return Promise.resolve({ output: formatSpiceResults(input) });
                } catch (e) {
                    return Promise.resolve({ isError: true, output: e instanceof Error ? e.message : String(e) });
                }
            },
        };
    }
}

registerTool(SpiceCalculatorTool);
