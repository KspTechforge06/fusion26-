# STEP 01 — Environment and Map Audit

## Summary

- **Audit date/time:** 2026-10-09 11:16:13 +05:30
- **Working directory:** `C:\Users\lakshya jain\OneDrive\Desktop\Robot`
- **Expected map count:** 33
- **Actual discovered map count:** 33 unique `.map` files
- **Total files inspected:** 33
- **Valid maps:** 33
- **Invalid maps:** 0
- **Files containing unexpected symbols:** 0
- **Final audit verdict:** **PASS**
- **Data validation status:** **PASS** — all discovered maps passed the required checks.

## Environment

| Tool | Result |
|---|---|
| Node.js | v24.15.0 |
| npm | 11.12.1 |
| Python | 3.12.10 |
| Git | 2.53.0.windows.1 |
| `package.json` | Not found |
| Application code | No application source files were present before the audit |

The workspace contains the supplied map files and no `maps/` subdirectory. All discovered maps are directly under the working directory. No packages were installed and no application code was created.

## Validation rules

Each file was independently checked using a reproducible PowerShell script. The validator required:

- exact `type octile`, `height N`, `width N`, and `map` header structure;
- positive integer dimensions;
- actual grid row count equal to declared height;
- every grid row length equal to declared width;
- only `.`, `@`, and `T` symbols;
- no truncated grid data;
- declared total cells equal to `height × width`;
- traversable count equal to the number of `.` cells;
- obstacle count equal to the number of `@` and `T` cells.

No invalid files and no unexpected symbols were found, so there are no invalid-map error records to list.

## Complete inventory

Columns: filename, relative path, bytes, SHA-256, height, width, declared total cells, actual rows, traversable cells, obstacle cells, unexpected characters, result.

| Filename | Relative path | Bytes | SHA-256 | Height | Width | Declared total | Actual rows | Traversable | Obstacles | Unexpected | Result |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| Berlin_1_256.map | Berlin_1_256.map | 65828 | c1be6a222e9b138e64d65ad50da92fca447f75191af9aa3022994fe3487abe56 | 256 | 256 | 65536 | 256 | 47540 | 17996 | — | VALID |
| Boston_0_256.map | Boston_0_256.map | 65829 | bc9c572a3d1c5b0273e17ca9af2faa3c685eff669dfbd2561b007c0340ae0e04 | 256 | 256 | 65536 | 256 | 47768 | 17768 | — | VALID |
| brc202d.map | brc202d.map | 255448 | ee4f1b89431452b6a07f7a56c6ca653edd7f9f9f32906ab8280fb1a76e4b8a24 | 481 | 530 | 254930 | 481 | 43151 | 211779 | — | VALID |
| den312d.map | den312d.map | 5381 | 1b3d72a358329a9a37d0aed62ad2668ee7882c4c745c73dc8b4f5d75493c79c4 | 81 | 65 | 5265 | 81 | 2445 | 2820 | — | VALID |
| den520d.map | den520d.map | 66086 | 06575cc259ea90e6dad003a72f891ab9f82cc9f5e5de4a5f46b90125a46e5f90 | 257 | 256 | 65792 | 257 | 28178 | 37614 | — | VALID |
| empty-16-16.map | empty-16-16.map | 307 | 27a570a564cf8de828619efa09d510df95f0cbfe2840376b7c3e63c96413689a | 16 | 16 | 256 | 16 | 256 | 0 | — | VALID |
| empty-32-32.map | empty-32-32.map | 1091 | 5b11a28f65d09a0ba260b77cb698bb22c73cfe1e1f5e159997de6108cd31bf68 | 32 | 32 | 1024 | 32 | 1024 | 0 | — | VALID |
| empty-48-48.map | empty-48-48.map | 2387 | 9d13ddc8f39d3e64f2cabea9a81c8d298d0f4a955b104589aea71b07b2606d4f | 48 | 48 | 2304 | 48 | 2304 | 0 | — | VALID |
| empty-8-8.map | empty-8-8.map | 105 | 42776e4904ec90689dd034fbd84524d671dc554472cc4221432b0c523d51f152 | 8 | 8 | 64 | 8 | 64 | 0 | — | VALID |
| ht_chantry.map | ht_chantry.map | 23020 | 0aa95f3f8701eea7938b8ed84a38fa17d4eb7fe0a727ecd43edf413f3774ccc0 | 141 | 162 | 22842 | 141 | 7461 | 15381 | — | VALID |
| ht_mansion_n.map | ht_mansion_n.map | 36217 | d0d82f6e8becb0d2c1e61bcbfd9d94ed6d061725e38107be2c9defc8dcbfd9b4 | 270 | 133 | 35910 | 270 | 8959 | 26951 | — | VALID |
| lak303d.map | lak303d.map | 37867 | 8f4bc6c57aff59ff9650683bbfc91e0c618e30f96ef72323369cb7a055a33b26 | 194 | 194 | 37636 | 194 | 14784 | 22852 | — | VALID |
| lt_gallowstemplar_n.map | lt_gallowstemplar_n.map | 45397 | dacdbfb8968bbdf0c4fce101301fc1c28aa5aa7a48c480c5c2a5a0745894adae | 180 | 251 | 45180 | 180 | 10021 | 35159 | — | VALID |
| maze-128-128-1.map | maze-128-128-1.map | 16549 | 9ef42dc6c43a2b07364c9678b7501a6a7ff1fc7e61215abae6d34000ba8e70c9 | 128 | 128 | 16384 | 128 | 8191 | 8193 | — | VALID |
| maze-128-128-10.map | maze-128-128-10.map | 16549 | 2281ef15df0c94efc79b7c62f0c60ce4cb22c43c2cc584226d307c7676d53986 | 128 | 128 | 16384 | 128 | 14818 | 1566 | — | VALID |
| maze-128-128-2.map | maze-128-128-2.map | 16549 | 9a22a1f6b63ac1914af03a24e4397e31000a3b4ffa85a6a4a813e04b5fa49bd1 | 128 | 128 | 16384 | 128 | 10858 | 5526 | — | VALID |
| maze-32-32-2.map | maze-32-32-2.map | 1091 | 5c549328775ce530072cb05eda8f9010235a7e29294806d6aebb0ad667479cd3 | 32 | 32 | 1024 | 32 | 666 | 358 | — | VALID |
| maze-32-32-4.map | maze-32-32-4.map | 1091 | 7ff67aa59f71933b8cf2605e12631b8a28d9ebcfb9b941de3afdc7dce3123fee | 32 | 32 | 1024 | 32 | 790 | 234 | — | VALID |
| orz900d.map | orz900d.map | 978790 | 22c335cd2022f6c1be19e240bade2488f65db5b962347c64279564d840a276c8 | 656 | 1491 | 978096 | 656 | 96603 | 881493 | — | VALID |
| ost003d.map | ost003d.map | 37867 | 2081e15b565f6285eb59308b3626a61843763a0df14756ff5906ab0bb8f34c3d | 194 | 194 | 37636 | 194 | 13214 | 24422 | — | VALID |
| Paris_1_256.map | Paris_1_256.map | 65829 | 85ec535004685c9fb474954a24bd14395a21cea338bdcfdf7d9a2f21c587f87d | 256 | 256 | 65536 | 256 | 47240 | 18296 | — | VALID |
| random-32-32-10.map | random-32-32-10.map | 1091 | 4240fddfa77d88b72ce779e02acf46a5ff056a3b04af5a4e35f7bc86cdfba3ec | 32 | 32 | 1024 | 32 | 922 | 102 | — | VALID |
| random-32-32-20.map | random-32-32-20.map | 1091 | 8c5a83498ab92a2579aeef91c5f42d9ecf9019ef038cf98e623061a15beb6f56 | 32 | 32 | 1024 | 32 | 819 | 205 | — | VALID |
| random-64-64-10.map | random-64-64-10.map | 4195 | b31c671228f884a113ca11c41b83630dc042e58e07f9b36da74ec508f82a5659 | 64 | 64 | 4096 | 64 | 3687 | 409 | — | VALID |
| random-64-64-20.map | random-64-64-20.map | 4195 | 0702bcc7df0529a819845c5d70050464c0946ae234881f27b9f4202b81f40c83 | 64 | 64 | 4096 | 64 | 3270 | 826 | — | VALID |
| room-32-32-4.map | room-32-32-4.map | 1091 | f107fefbf63c7a1a3753e4a033452301a1cdd7043cab7f45e4ed0e7dec1e90a9 | 32 | 32 | 1024 | 32 | 682 | 342 | — | VALID |
| room-64-64-16.map | room-64-64-16.map | 4195 | 983df5c9bf0c59799daa107feb1b2d3ed81c5d32bf4b23d019f06161d0be6092 | 64 | 64 | 4096 | 64 | 3646 | 450 | — | VALID |
| room-64-64-8.map | room-64-64-8.map | 4195 | 56946a2411a64631f4ab7ca8dd17439e619ad066fc1d2bf2fd19516fc24f28dc | 64 | 64 | 4096 | 64 | 3232 | 864 | — | VALID |
| w_woundedcoast.map | w_woundedcoast.map | 371691 | 25e2a6bf2cc1ec4905a8511617ca0e479c6d3165e4fbb8d2963165de153fc9bb | 578 | 642 | 371076 | 578 | 34020 | 337056 | — | VALID |
| warehouse-10-20-10-2-1.map | warehouse-10-20-10-2-1.map | 10242 | c8d1b2f24788ed6bd1ccf45065b96b4ce82d65f88c72de750e03e2758637bff0 | 63 | 161 | 10143 | 63 | 5699 | 4444 | — | VALID |
| warehouse-10-20-10-2-2.map | warehouse-10-20-10-2-2.map | 14400 | 4f06e82c2b87238daa8e308086afdba701112bf023e94e740e5bf9508a6adec3 | 84 | 170 | 14280 | 84 | 9776 | 4504 | — | VALID |
| warehouse-20-40-10-2-1.map | warehouse-20-40-10-2-1.map | 39643 | bd3bec2d1c20a8bbf900583cb4c2cf9dc16101470fbfae93b272ee0fb575d3ec | 123 | 321 | 39483 | 123 | 22599 | 16884 | — | VALID |
| warehouse-20-40-10-2-2.map | warehouse-20-40-10-2-2.map | 55961 | eae2a3f5298b1e113bfc32b5b4404f5de5105365d237df63cc9dc9e2d1c73713 | 164 | 340 | 55760 | 164 | 38756 | 17004 | — | VALID |

## Verification and integrity

### Inventory consistency

- Unique discovered files: 33.
- Files inspected: 33.
- Valid + invalid: 33 + 0 = 33.
- Every discovered map has exactly one inventory row.
- Every inventory row has one validation status.
- For every map, traversable + obstacles equals declared total cells.
- For every map, actual rows equals declared height and each row equals declared width.
- No unexpected-symbol files were found.
- A second recursive search still found 33 `.map` files.

### Original file integrity

SHA-256 hashes were computed for all 33 original files. A before/after comparison was performed around report creation:

- Before count: 33
- After count: 33
- Changed hashes: 0
- Deleted files: 0

Therefore, no original map file was modified during the audit.

### Checks performed

- Workspace inspection and absolute path query.
- Recursive `.map` inventory with unique physical paths.
- Independent per-file octile header, dimension, row, width, symbol, and cell-count validation.
- SHA-256 calculation for every map.
- Independent before/after SHA-256 comparison.
- Post-report recursive recount.
- Report existence/readability check.
- Inventory row and total consistency check.
- Package/application scope check: no `package.json`, no application code, no package installation.

### Checks not performed

- No runtime application test was applicable because application code was not present and Step 01 explicitly prohibits implementation.
- No Git repository status was available because the workspace is not a Git repository; Git itself is installed.
- A separate cryptographic snapshot file was not retained outside this report; the report records the complete before/after comparison result and all final hashes.

## Commands/scripts used

The following read-only commands were used:

```powershell
Get-Location
Get-Command node; node --version
Get-Command npm; npm --version
Get-Command python; python --version
Get-Command git; git --version
Get-ChildItem -Filter '*.map' -File -Recurse
Get-FileHash -Algorithm SHA256
```

A reproducible audit script was run from a separate scratch location. It used `Get-ChildItem`, `[IO.File]::ReadAllLines`, character-by-character grid checks, and `Get-FileHash`; it wrote only scratch audit output and did not write to any map file.

## Final verification

- Report exists and is readable at `reports/STEP_01_AUDIT.md`.
- Recursive recount after report creation: 33 map files.
- Report inventory rows: 33; each discovered filename appears exactly once.
- Inventory totals are internally consistent.
- Original map hashes remain unchanged.
- No original map file was modified.
- No application code or React components were created.
- No packages were installed.

## Remaining issues

None for Step 01. The workspace contains exactly the expected 33 maps, and all 33 pass the requested format and content validation.
