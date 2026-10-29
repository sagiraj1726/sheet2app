'use strict';
/**
 * scripts/generate-samples.js
 * Generate the sample Excel workbooks used for the demo and tests.
 * Run with:  npm run samples
 *
 * Output files are written to  samples/  in the project root.
 * These are checked in so first-time visitors can download them from the
 * /api/samples/:file route without needing an upload.
 */

const path = require('path');
const fs = require('fs/promises');
const samples = require('../src/services/samples');

const OUT_DIR = path.join(__dirname, '..', 'samples');

const FILES = {
  'employees.xlsx': ['employees'],
  'expenses.xlsx': ['expenses'],
  'inventory.xlsx': ['inventory'],
  'students.xlsx': ['students'],
  'leads.xlsx': ['leads'],
  'demo.xlsx': ['inventory', 'expenses', 'employees'],
};

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`Writing sample files to ${OUT_DIR}\n`);
  for (const [filename, names] of Object.entries(FILES)) {
    const buf = await samples.buildWorkbook(names);
    const dest = path.join(OUT_DIR, filename);
    await fs.writeFile(dest, buf);
    const kb = (buf.length / 1024).toFixed(1);
    console.log(`  ✓  ${filename}  (${kb} KB)  ← sheets: ${names.join(', ')}`);
  }
  console.log('\nDone. Sample files are ready.\n');
}

main().catch((err) => {
  console.error('Error generating samples:', err.message);
  process.exit(1);
});
