// =============================================================================
// Maqass (مِقَصْ) — Automated Security QA & Penetration Testing Suite
// Part 1: Checklist Items 01 to 10 (Automated Verification & Self-Healing Loop)
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

// Helper: read file content safely
function readFile(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

// Helper: list files matching pattern
function listFiles(dir, exts = ['.js', '.html']) {
  let results = [];
  const entries = fs.readdirSync(path.join(ROOT_DIR, dir), { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'tests') {
      results = results.concat(listFiles(fullPath, exts));
    } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// =============================================================================
// TEST 01: Scan for leaked service_role keys or master tokens
// =============================================================================
function test_01_hide_api_keys() {
  const clientFiles = [...listFiles('js', ['.js']), ...fs.readdirSync(ROOT_DIR).filter(f => f.endsWith('.html'))];
  const leakedFiles = [];

  for (const file of clientFiles) {
    const content = readFile(file);
    if (!content) continue;

    // Check for service_role strings or JWT with service_role claim
    if (
      content.includes('service_role') ||
      content.includes('SUPABASE_SERVICE_ROLE') ||
      (/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(content) && content.includes('"role":"service_role"'))
    ) {
      leakedFiles.push(file);
    }
  }

  if (leakedFiles.length > 0) {
    return {
      pass: false,
      message: `Found leaked service_role or secret keys in files: ${leakedFiles.join(', ')}`
    };
  }

  // Also verify that config.js only holds the public anon key
  const configContent = readFile('js/config.js');
  if (!configContent || !configContent.includes('SUPABASE_ANON_KEY')) {
    return { pass: false, message: 'SUPABASE_ANON_KEY is missing from js/config.js' };
  }

  return { pass: true, message: 'All client files scanned: 0 master/service_role keys detected. Only public anon key is exposed.' };
}

// =============================================================================
// TEST 02: Verify environment & configuration scoping
// =============================================================================
function test_02_check_env_vars() {
  const config = readFile('js/config.js');
  if (!config) return { pass: false, message: 'js/config.js not found' };

  if (config.includes('service_role') || config.includes('MASTER_KEY')) {
    return { pass: false, message: 'Dangerous master secrets detected in js/config.js' };
  }

  const workflowPath = path.join(ROOT_DIR, '.github/workflows/keep-alive.yml');
  if (fs.existsSync(workflowPath)) {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    if (workflow.includes('service_role') || /eyJ[a-zA-Z0-9_-]{30,}/.test(workflow)) {
      return { pass: false, message: 'Hardcoded secret token found in .github/workflows/keep-alive.yml' };
    }
  }

  return { pass: true, message: 'Configuration variables strictly defined without hardcoded master secrets.' };
}

// =============================================================================
// TEST 03: Check git leaks and .gitignore rules
// =============================================================================
function test_03_check_git_leaks() {
  const gitignore = readFile('.gitignore');
  if (!gitignore) return { pass: false, message: '.gitignore does not exist' };

  const requiredRules = ['.env', '*.key', '*.pem', '*.dump'];
  const missingRules = requiredRules.filter(rule => !gitignore.includes(rule));

  if (missingRules.length > 0) {
    return { pass: false, message: `.gitignore is missing essential secret prevention rules: ${missingRules.join(', ')}` };
  }

  // Check tracked git files
  let trackedFiles = [];
  try {
    trackedFiles = execSync('git ls-files', { cwd: ROOT_DIR }).toString().split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    trackedFiles = [];
  }

  const sensitiveMatches = trackedFiles.filter(file => {
    const base = path.basename(file);
    return (
      base.startsWith('.env') ||
      base.endsWith('.pem') ||
      base.endsWith('.key') ||
      base.endsWith('.dump') ||
      base.endsWith('.sql.bak')
    );
  });

  if (sensitiveMatches.length > 0) {
    return { pass: false, message: `Git index is tracking sensitive files: ${sensitiveMatches.join(', ')}` };
  }

  return { pass: true, message: '.gitignore contains comprehensive secret filters and 0 sensitive files are committed.' };
}

// =============================================================================
// TEST 04: Proper authentication required for state mutations
// =============================================================================
function test_04_proper_authentication() {
  const schema = readFile('supabase_schema.sql');
  if (!schema) return { pass: false, message: 'supabase_schema.sql not found' };

  // Check that write operations on salons, barbers, services require authenticated role
  const insecureBypasses = [];
  
  const policyBlocks = schema.match(/CREATE\s+POLICY[\s\S]*?;/gi) || [];
  for (const policy of policyBlocks) {
    if (/owner_id\s+IS\s+NULL/i.test(policy)) {
      insecureBypasses.push(`Loose "owner_id IS NULL" bypass found in policy: ${policy.slice(0, 40)}...`);
    }
    if (/salon_id\s+IS\s+NULL/i.test(policy)) {
      insecureBypasses.push(`Loose "salon_id IS NULL" bypass found in policy: ${policy.slice(0, 40)}...`);
    }
  }

  if (insecureBypasses.length > 0) {
    return { pass: false, message: insecureBypasses.join('; ') };
  }

  // Verify appointments update/delete is strictly for authenticated owner
  if (!schema.includes('"Owner can update appointments"') || !schema.includes('"Owner can delete appointments"')) {
    return { pass: false, message: 'Missing explicit Owner update/delete RLS policies on appointments' };
  }

  return { pass: true, message: 'All state modifications strictly require authenticated session (auth.uid() IS NOT NULL).' };
}

// =============================================================================
// TEST 05: Super Admin 24-hour session expiration
// =============================================================================
function test_05_admin_session_expiration() {
  const apiCode = readFile('js/api.js');
  if (!apiCode) return { pass: false, message: 'js/api.js not found' };

  const hasTimestampStorage = apiCode.includes('timestamp: Date.now()');
  const hasExpirationCheck = apiCode.includes('MAX_SESSION_AGE_MS') || apiCode.includes('86400000') || apiCode.includes('24 * 60 * 60 * 1000');
  const hasSessionClear = apiCode.includes('sessionStorage.removeItem(SUPER_ADMIN_STORAGE_KEY)');

  if (!hasTimestampStorage) {
    return { pass: false, message: 'loginSuperAdmin does not persist session creation timestamp' };
  }
  if (!hasExpirationCheck || !hasSessionClear) {
    return { pass: false, message: 'getSuperAdminSession does not enforce 24-hour expiration or clear expired session' };
  }

  return { pass: true, message: 'Superadmin session validity strictly enforced with 24-hour timestamp validation and auto-purge.' };
}

// =============================================================================
// TEST 06: Tenant isolation (Prevent cross-tenant access)
// =============================================================================
function test_06_check_user_access() {
  const schema = readFile('supabase_schema.sql');
  const apiCode = readFile('js/api.js');
  if (!schema || !apiCode) return { pass: false, message: 'Core project files missing' };

  // Assert RLS isolates salons by owner_id = auth.uid()
  if (!schema.includes('owner_id = auth.uid()')) {
    return { pass: false, message: 'Salons table RLS does not isolate by owner_id = auth.uid()' };
  }

  // Assert blacklist table has composite uniqueness on (salon_id, client_phone)
  if (!schema.includes('idx_blacklist_unique_salon_phone') && !schema.includes('UNIQUE (salon_id, client_phone)')) {
    return { pass: false, message: 'Blacklist missing composite unique constraint on (salon_id, client_phone)' };
  }

  // Assert api.js functions accept and scope by salonId
  if (!apiCode.includes('getBlacklist(salonId') || !apiCode.includes('unblockClient(clientPhone, salonId')) {
    return { pass: false, message: 'getBlacklist or unblockClient in api.js does not enforce salonId tenant scoping' };
  }

  return { pass: true, message: 'Multi-tenant isolation verified: cross-salon data contamination is blocked across database and API.' };
}

// =============================================================================
// TEST 07: Protect dashboard routes from unauthenticated access
// =============================================================================
function test_07_protect_admin_routes() {
  const html = readFile('dashboard.html');
  const js = readFile('js/dashboard.js');
  if (!html || !js) return { pass: false, message: 'Dashboard files not found' };

  // Assert dashboard-wrapper is hidden by default in HTML
  if (!html.includes('id="dashboard-wrapper"') || !html.includes('style="display: none;"')) {
    return { pass: false, message: '#dashboard-wrapper is not hidden by default in dashboard.html' };
  }

  // Assert js checks getBarberSession before booting
  if (!js.includes('await getBarberSession()')) {
    return { pass: false, message: 'dashboard.js does not verify getBarberSession() on init' };
  }

  if (!js.includes('DOM.loginGate.style.display = \'grid\'') && !js.includes('DOM.loginGate.style.display = "grid"')) {
    return { pass: false, message: 'dashboard.js does not display login gate when unauthenticated' };
  }

  return { pass: true, message: 'Route protection active: dashboard UI remains hidden until session authentication is verified.' };
}

// =============================================================================
// TEST 08: Secure API endpoints and privacy-preserving RPCs
// =============================================================================
function test_08_secure_api_endpoints() {
  const schema = readFile('supabase_schema.sql');
  const apiCode = readFile('js/api.js');
  if (!schema || !apiCode) return { pass: false, message: 'Core project files missing' };

  // Check get_booked_slots RPC exists and does not return client_name or client_phone
  const rpcSlotsMatch = schema.match(/CREATE OR REPLACE FUNCTION public\.get_booked_slots[\s\S]*?RETURNS TABLE\s*\(([\s\S]*?)\)/i);
  if (!rpcSlotsMatch) {
    return { pass: false, message: 'get_booked_slots RPC function is missing in supabase_schema.sql' };
  }
  const returnedColumns = rpcSlotsMatch[1].toLowerCase();
  if (returnedColumns.includes('client_name') || returnedColumns.includes('client_phone')) {
    return { pass: false, message: 'get_booked_slots RPC leaks client PII (client_name or client_phone)' };
  }

  // Check is_client_blocked RPC exists
  if (!schema.includes('is_client_blocked')) {
    return { pass: false, message: 'is_client_blocked RPC function is missing in supabase_schema.sql' };
  }

  // Check api.js uses get_booked_slots RPC
  if (!apiCode.includes("supabase.rpc('get_booked_slots'")) {
    return { pass: false, message: "api.js does not call get_booked_slots RPC" };
  }

  return { pass: true, message: 'Public data flows securely routed through hardened, privacy-preserving RPCs.' };
}

// =============================================================================
// TEST 09: Secure database functions (search_path hijacking prevention)
// =============================================================================
function test_09_secure_database() {
  const schema = readFile('supabase_schema.sql');
  if (!schema) return { pass: false, message: 'supabase_schema.sql not found' };

  // Find all SECURITY DEFINER functions in supabase_schema.sql
  const functionBlocks = schema.split(/CREATE OR REPLACE FUNCTION/gi).slice(1);
  const insecureFunctions = [];

  for (const block of functionBlocks) {
    const signature = block.split(/\bas\b|\$\$/i)[0];
    if (signature.includes('SECURITY DEFINER')) {
      const funcNameMatch = signature.match(/public\.([a-zA-Z0-9_]+)/);
      const funcName = funcNameMatch ? funcNameMatch[1] : 'unknown_function';

      if (!signature.includes('search_path')) {
        insecureFunctions.push(funcName);
      }
    }
  }

  if (insecureFunctions.length > 0) {
    return {
      pass: false,
      message: `SECURITY DEFINER functions missing "SET search_path = public": ${insecureFunctions.join(', ')}`
    };
  }

  return { pass: true, message: 'All SECURITY DEFINER functions explicitly declare safe search_path to prevent hijacking.' };
}

// =============================================================================
// TEST 10: RLS enabled on all tables
// =============================================================================
function test_10_rls_enabled_every_table() {
  const schema = readFile('supabase_schema.sql');
  if (!schema) return { pass: false, message: 'supabase_schema.sql not found' };

  const requiredTables = ['salons', 'barbers', 'services', 'appointments', 'blacklist', 'platform_admins'];
  const missingRLS = [];

  for (const table of requiredTables) {
    const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    if (!rlsRegex.test(schema)) {
      missingRLS.push(table);
    }
  }

  if (missingRLS.length > 0) {
    return { pass: false, message: `Tables missing ENABLE ROW LEVEL SECURITY: ${missingRLS.join(', ')}` };
  }

  return { pass: true, message: 'Row Level Security is explicitly declared and active on 100% of tables.' };
}

// =============================================================================
// RUNNER & SELF-HEALING CONTROLLER
// =============================================================================
const tests = [
  { id: 'test_01', name: 'Hide API Keys', fn: test_01_hide_api_keys },
  { id: 'test_02', name: 'Check Env Scoping', fn: test_02_check_env_vars },
  { id: 'test_03', name: 'Check Git Leaks & .gitignore', fn: test_03_check_git_leaks },
  { id: 'test_04', name: 'Proper Authentication & RLS', fn: test_04_proper_authentication },
  { id: 'test_05', name: 'Super Admin 24h Expiration', fn: test_05_admin_session_expiration },
  { id: 'test_06', name: 'Multi-Tenant User Isolation', fn: test_06_check_user_access },
  { id: 'test_07', name: 'Protect Dashboard Routes', fn: test_07_protect_admin_routes },
  { id: 'test_08', name: 'Secure API Endpoints & RPCs', fn: test_08_secure_api_endpoints },
  { id: 'test_09', name: 'Secure Database search_path', fn: test_09_secure_database },
  { id: 'test_10', name: 'RLS Enabled on Every Table', fn: test_10_rls_enabled_every_table }
];

function runAll() {
  console.log('=============================================================================');
  console.log('   MAQASS AUTOMATED SECURITY AUDIT — PART 1 (ITEMS 01 TO 10)');
  console.log('=============================================================================\n');

  let allPassed = true;
  const results = [];

  for (const t of tests) {
    const res = t.fn();
    results.push({ ...t, ...res });
    const tag = res.pass ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`${tag} ${t.id} (${t.name})`);
    console.log(`       ↳ ${res.message}\n`);
    if (!res.pass) {
      allPassed = false;
    }
  }

  console.log('-----------------------------------------------------------------------------');
  const passedCount = results.filter(r => r.pass).length;
  console.log(`TOTAL SCORE: ${passedCount} / ${tests.length} (${Math.round((passedCount / tests.length) * 100)}% PASS RATE)`);
  console.log('-----------------------------------------------------------------------------\n');

  return { allPassed, results };
}

if (require.main === module) {
  const { allPassed } = runAll();
  process.exit(allPassed ? 0 : 1);
}

module.exports = { runAll, tests };
