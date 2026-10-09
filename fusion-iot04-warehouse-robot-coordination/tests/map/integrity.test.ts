import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMapFile } from '../../src/map/parseMap.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const expectedMaps: Readonly<Record<string, string>> = {
  'Berlin_1_256.map': 'c1be6a222e9b138e64d65ad50da92fca447f75191af9aa3022994fe3487abe56',
  'Boston_0_256.map': 'bc9c572a3d1c5b0273e17ca9af2faa3c685eff669dfbd2561b007c0340ae0e04',
  'Paris_1_256.map': '85ec535004685c9fb474954a24bd14395a21cea338bdcfdf7d9a2f21c587f87d',
  'brc202d.map': 'ee4f1b89431452b6a07f7a56c6ca653edd7f9f9f32906ab8280fb1a76e4b8a24',
  'den312d.map': '1b3d72a358329a9a37d0aed62ad2668ee7882c4c745c73dc8b4f5d75493c79c4',
  'den520d.map': '06575cc259ea90e6dad003a72f891ab9f82cc9f5e5de4a5f46b90125a46e5f90',
  'empty-16-16.map': '27a570a564cf8de828619efa09d510df95f0cbfe2840376b7c3e63c96413689a',
  'empty-32-32.map': '5b11a28f65d09a0ba260b77cb698bb22c73cfe1e1f5e159997de6108cd31bf68',
  'empty-48-48.map': '9d13ddc8f39d3e64f2cabea9a81c8d298d0f4a955b104589aea71b07b2606d4f',
  'empty-8-8.map': '42776e4904ec90689dd034fbd84524d671dc554472cc4221432b0c523d51f152',
  'ht_chantry.map': '0aa95f3f8701eea7938b8ed84a38fa17d4eb7fe0a727ecd43edf413f3774ccc0',
  'ht_mansion_n.map': 'd0d82f6e8becb0d2c1e61bcbfd9d94ed6d061725e38107be2c9defc8dcbfd9b4',
  'lak303d.map': '8f4bc6c57aff59ff9650683bbfc91e0c618e30f96ef72323369cb7a055a33b26',
  'lt_gallowstemplar_n.map': 'dacdbfb8968bbdf0c4fce101301fc1c28aa5aa7a48c480c5c2a5a0745894adae',
  'maze-128-128-1.map': '9ef42dc6c43a2b07364c9678b7501a6a7ff1fc7e61215abae6d34000ba8e70c9',
  'maze-128-128-10.map': '2281ef15df0c94efc79b7c62f0c60ce4cb22c43c2cc584226d307c7676d53986',
  'maze-128-128-2.map': '9a22a1f6b63ac1914af03a24e4397e31000a3b4ffa85a6a4a813e04b5fa49bd1',
  'maze-32-32-2.map': '5c549328775ce530072cb05eda8f9010235a7e29294806d6aebb0ad667479cd3',
  'maze-32-32-4.map': '7ff67aa59f71933b8cf2605e12631b8a28d9ebcfb9b941de3afdc7dce3123fee',
  'orz900d.map': '22c335cd2022f6c1be19e240bade2488f65db5b962347c64279564d840a276c8',
  'ost003d.map': '2081e15b565f6285eb59308b3626a61843763a0df14756ff5906ab0bb8f34c3d',
  'random-32-32-10.map': '4240fddfa77d88b72ce779e02acf46a5ff056a3b04af5a4e35f7bc86cdfba3ec',
  'random-32-32-20.map': '8c5a83498ab92a2579aeef91c5f42d9ecf9019ef038cf98e623061a15beb6f56',
  'random-64-64-10.map': 'b31c671228f884a113ca11c41b83630dc042e58e07f9b36da74ec508f82a5659',
  'random-64-64-20.map': '0702bcc7df0529a819845c5d70050464c0946ae234881f27b9f4202b81f40c83',
  'room-32-32-4.map': 'f107fefbf63c7a1a3753e4a033452301a1cdd7043cab7f45e4ed0e7dec1e90a9',
  'room-64-64-16.map': '983df5c9bf0c59799daa107feb1b2d3ed81c5d32bf4b23d019f06161d0be6092',
  'room-64-64-8.map': '56946a2411a64631f4ab7ca8dd17439e619ad066fc1d2bf2fd19516fc24f28dc',
  'w_woundedcoast.map': '25e2a6bf2cc1ec4905a8511617ca0e479c6d3165e4fbb8d2963165de153fc9bb',
  'warehouse-10-20-10-2-1.map': 'c8d1b2f24788ed6bd1ccf45065b96b4ce82d65f88c72de750e03e2758637bff0',
  'warehouse-10-20-10-2-2.map': '4f06e82c2b87238daa8e308086afdba701112bf023e94e740e5bf9508a6adec3',
  'warehouse-20-40-10-2-1.map': 'bd3bec2d1c20a8bbf900583cb4c2cf9dc16101470fbfae93b272ee0fb575d3ec',
  'warehouse-20-40-10-2-2.map': 'eae2a3f5298b1e113bfc32b5b4404f5de5105365d237df63cc9dc9e2d1c73713',
};

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

describe('original map integrity', () => {
  it('parses exactly the 33 committed maps and matches their raw-byte baseline hashes', () => {
    const actualNames = readdirSync(projectRoot).filter((name) => name.endsWith('.map')).sort();
    expect(actualNames).toEqual(Object.keys(expectedMaps).sort());
    for (const name of actualNames) {
      const filePath = join(projectRoot, name);
      const parsed = parseMapFile(filePath);
      expect(parsed.rows).toHaveLength(parsed.height);
      expect(sha256(filePath)).toBe(expectedMaps[name]);
    }
  });
});
