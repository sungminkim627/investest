import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function toShortDescription(value, maxLength = 180) {
  const compact = compactText(value);
  if (!compact) return null;
  if (compact.length <= maxLength) return compact;
  const trimmed = compact.slice(0, maxLength - 1);
  const breakAt = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('; '), trimmed.lastIndexOf(', '), trimmed.lastIndexOf(' '));
  const safe = breakAt >= Math.floor(maxLength * 0.55) ? trimmed.slice(0, breakAt) : trimmed;
  return `${safe.trim()}...`;
}

loadEnvFromFile(path.join(root, '.env.local'));
loadEnvFromFile(path.join(root, '.env'));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tiingoKey = process.env.MARKET_DATA_API_KEY;
const tiingoBase = process.env.MARKET_DATA_BASE_URL ?? 'https://api.tiingo.com';
const enrichLimit = Math.max(1, Number(process.env.INSTRUMENT_ENRICH_LIMIT ?? 40));
const scanLimit = Math.max(enrichLimit, Number(process.env.INSTRUMENT_ENRICH_SCAN_LIMIT ?? 3000));
const delayMs = Math.max(250, Number(process.env.INSTRUMENT_ENRICH_DELAY_MS ?? 1200));

if (!supabaseUrl || !serviceRoleKey || !tiingoKey) {
  throw new Error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MARKET_DATA_API_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: candidates, error: candidatesError } = await supabase
  .from('instruments')
  .select('symbol,short_description,description,is_active')
  .eq('is_active', true)
  .order('symbol', { ascending: true })
  .limit(scanLimit);

if (candidatesError) {
  throw new Error(`Failed to load candidate symbols: ${candidatesError.message}`);
}

const targets = (candidates ?? [])
  .filter((row) => !compactText(row.short_description || row.description))
  .slice(0, enrichLimit)
  .map((row) => row.symbol);

if (targets.length === 0) {
  console.log('[sync-instrument-profiles] No missing descriptions found.');
  process.exit(0);
}

console.log(`[sync-instrument-profiles] Enriching ${targets.length} symbols (delay ${delayMs}ms/request)`);

let updated = 0;
let failed = 0;

for (let i = 0; i < targets.length; i += 1) {
  const symbol = targets[i];
  const url = new URL(`${tiingoBase}/tiingo/daily/${encodeURIComponent(symbol)}`);
  url.searchParams.set('token', tiingoKey);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      failed += 1;
      console.warn(`[sync-instrument-profiles] ${symbol}: metadata fetch failed (${response.status})`);
      await sleep(delayMs);
      continue;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      failed += 1;
      console.warn(`[sync-instrument-profiles] ${symbol}: invalid metadata payload`);
      await sleep(delayMs);
      continue;
    }

    const shortDescription = toShortDescription(payload.description);
    const patch = {
      symbol,
      name: compactText(payload.name || symbol) || symbol,
      exchange: compactText(payload.exchangeCode || 'N/A') || 'N/A',
      asset_type: compactText(payload.assetType || 'unknown') || 'unknown',
      description: shortDescription,
      short_description: shortDescription,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('instruments').upsert([patch], { onConflict: 'symbol' });
    if (error) {
      failed += 1;
      console.warn(`[sync-instrument-profiles] ${symbol}: upsert failed (${error.message})`);
      await sleep(delayMs);
      continue;
    }

    updated += 1;
    process.stdout.write(`\r[sync-instrument-profiles] Updated ${updated}/${targets.length}`);
  } catch (error) {
    failed += 1;
    console.warn(`[sync-instrument-profiles] ${symbol}: ${(error && error.message) || String(error)}`);
  }

  await sleep(delayMs);
}

console.log(`\n[sync-instrument-profiles] Complete: updated=${updated}, failed=${failed}`);
