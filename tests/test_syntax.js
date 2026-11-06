const fs = require('fs');
const files = ['js/config.js', 'js/utils.js', 'js/api.js', 'js/dashboard.js', 'js/client.js'];
let allOk = true;

for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  // Strip imports and exports to test function body syntax
  const clean = code
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+(async\s+function|function|const|let|var|default|class)\s+/g, '$1 ')
    .replace(/export\s*\{[\s\S]*?\};?/g, '');
  try {
    new Function(clean);
    console.log('[PASS]', f, 'syntax is 100% valid!');
  } catch (err) {
    allOk = false;
    console.error('[FAIL]', f, err.message);
  }
}

if (!allOk) process.exit(1);
console.log('ALL FILES SYNTAX VERIFIED SUCCESSFULLY!');
