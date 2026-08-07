import { describe, expect, it } from 'vitest';

import { getAllReferenceRecipes } from '#/agent/brewing/reference-recipes';
import { ReferenceRecipeSearchTool } from '#/agent/brewing/reference-recipe-search';
import type { ExecutableToolContext } from '#/tool/toolContract';

const ctx: ExecutableToolContext = {
  turnId: 1,
  toolCallId: 'test',
  signal: new AbortController().signal,
};

describe('reference-recipes library', () => {
  it('exposes all 98 BJCP reference recipes', () => {
    const recipes = getAllReferenceRecipes();
    expect(recipes.length).toBe(98);
  });

  it('every recipe has the required fields', () => {
    const recipes = getAllReferenceRecipes();
    for (const r of recipes) {
      const d = r.data;
      expect(typeof d['nome'], `${r.code} nome`).toBe('string');
      expect(typeof d['stile'], `${r.code} stile`).toBe('string');
      expect(typeof d['codice_bjcp'], `${r.code} codice_bjcp`).toBe('string');
      expect(d['fonte'], `${r.code} fonte`).toBeTruthy();
      const fonte = d['fonte'] as Record<string, unknown>;
      expect(typeof fonte['url'], `${r.code} fonte.url`).toBe('string');
      expect(typeof fonte['verifica'], `${r.code} fonte.verifica`).toBe('string');
      expect(d['parametri'], `${r.code} parametri`).toBeTruthy();
    }
  });

  it('covers all BJCP 2021 style codes', () => {
    const recipes = getAllReferenceRecipes();
    const codes = new Set(recipes.map(r => r.data['codice_bjcp'] as string));
    const all = [
      '1A','1B','1C','1D','2A','2B','2C','3A','3B','3C','3D','4A','4B','4C',
      '5A','5B','5C','5D','6A','6B','6C','7A','7B','7C','8A','8B','9A','9B','9C',
      '10A','10B','10C','11A','11B','11C','12A','12B','12C','13A','13B','13C',
      '14A','14B','14C','15A','15B','15C','16A','16B','16C','16D','17A','17B','17C','17D',
      '18A','18B','19A','19B','19C','20A','20B','20C','21A','21B','21B1','21C',
      '22A','22B','22C','22D','23A','23B','23C','23D','23E','23F','23G',
      '24A','24B','24C','25A','25B','25C','26A','26B','26C','26D',
      '27A','27B','27C','28A','29A','30A','31A','32A','33A','34C',
    ];
    for (const code of all) {
      expect(codes.has(code), `missing ${code}`).toBe(true);
    }
  });
});

describe('ReferenceRecipeSearchTool', () => {
  const tool = new ReferenceRecipeSearchTool();

  it('finds a recipe by BJCP code', async () => {
    const exec = await tool.resolveExecution({ stile: '21A', dettaglio: false });
    if (exec.isError) throw new Error('unexpected error result');
    const result = await exec.execute(ctx);
    expect(result.isError).toBeFalsy();
    const output = result.output as string;
    expect(output).toContain('American IPA');
    expect(output).toContain('21A');
  });

  it('finds a recipe by style name', async () => {
    const exec = await tool.resolveExecution({ stile: 'American IPA', dettaglio: false });
    if (exec.isError) throw new Error('unexpected error result');
    const result = await exec.execute(ctx);
    expect(result.isError).toBeFalsy();
    expect(result.output as string).toContain('21A');
  });

  it('returns full detail when requested', async () => {
    const exec = await tool.resolveExecution({ stile: '21A', dettaglio: true });
    if (exec.isError) throw new Error('unexpected error result');
    const result = await exec.execute(ctx);
    expect(result.isError).toBeFalsy();
    const output = result.output as string;
    expect(output).toContain('Grist');
    expect(output).toContain('Luppolatura');
    expect(output).toContain('Lievito');
  });

  it('returns a helpful message when nothing matches', async () => {
    const exec = await tool.resolveExecution({ stile: 'zzz-non-esistente', dettaglio: false });
    if (exec.isError) throw new Error('unexpected error result');
    const result = await exec.execute(ctx);
    expect(result.isError).toBeFalsy();
    expect(result.output as string).toContain('Nessuna ricetta');
  });
});
