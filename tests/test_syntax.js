const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const jsDir = path.resolve(__dirname, '..', 'js');
const files = fs.readdirSync(jsDir)
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('js', f));

let allOk = true;

for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
    console.log(`[PASS] ${f} syntax is 100% valid!`);
  } catch (err) {
    allOk = false;
    console.error(`[FAIL] ${f}:`, err.stderr ? err.stderr.toString().trim() : err.message);
  }
}

if (!allOk) process.exit(1);
console.log('ALL FILES SYNTAX VERIFIED SUCCESSFULLY!');
