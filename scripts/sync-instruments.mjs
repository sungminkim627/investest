import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseDelimitedLine(line, delimiter) {
  if (delimiter === '\t') {
    return line.split('\t');
  }
  return parseCsvLine(line);
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

function parseSupportedTickersCsv(csvText) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const firstLine = lines[0].replace(/^\uFEFF/, '');
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(firstLine, delimiter).map((h) => h.trim());
  const col = (...names) =>
    headers.findIndex((h) => names.some((name) => h.toLowerCase() === name.toLowerCase()));

  const tickerIx = col('ticker', 'symbol');
  const nameIx = col('name', 'companyName', 'displayName');
  const exchIx = col('exchange', 'exchangeCode');
  const assetTypeIx = col('assetType', 'securityType', 'type');

  if (tickerIx < 0) {
    throw new Error(`Unsupported CSV format for supported_tickers.zip (headers=${headers.join('|')})`);
  }

  const now = new Date().toISOString();
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseDelimitedLine(lines[i], delimiter);
    const symbol = String(cols[tickerIx] ?? '').toUpperCase().trim();
    const name = String(nameIx >= 0 ? cols[nameIx] ?? symbol : symbol).trim() || symbol;
    if (!symbol) continue;

    rows.push({
      symbol,
      name,
      exchange: String(exchIx >= 0 ? cols[exchIx] ?? 'N/A' : 'N/A').trim() || 'N/A',
      asset_type: String(assetTypeIx >= 0 ? cols[assetTypeIx] ?? 'unknown' : 'unknown').trim() || 'unknown',
      description: null,
      short_description: null,
      is_active: true,
      updated_at: now
    });
  }

  return rows;
}

async function fetchJsonTickers(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return null;
  }

  const now = new Date().toISOString();
  return payload
    .map((item) => ({
      symbol: String(item.ticker ?? '').toUpperCase().trim(),
      name: String(item.name ?? '').trim(),
      exchange: String(item.exchangeCode ?? 'N/A').trim() || 'N/A',
      asset_type: String(item.assetType ?? 'unknown').trim() || 'unknown',
      description: toShortDescription(item.description),
      short_description: toShortDescription(item.description),
      is_active: true,
      updated_at: now
    }))
    .filter((row) => row.symbol && row.name);
}

async function fetchZipTickers(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`supported_tickers.zip download failed: ${response.status}`);
  }

  const arr = new Uint8Array(await response.arrayBuffer());
  const tmpZip = path.join(os.tmpdir(), `tiingo-supported-${Date.now()}.zip`);
  fs.writeFileSync(tmpZip, arr);

  try {
    const csv = execFileSync('unzip', ['-p', tmpZip], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    });
    return parseSupportedTickersCsv(csv);
  } catch (error) {
    throw new Error(`Failed to unzip supported_tickers.zip. Ensure 'unzip' is available. ${String(error)}`);
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
}

loadEnvFromFile(path.join(root, '.env.local'));
loadEnvFromFile(path.join(root, '.env'));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tiingoKey = process.env.MARKET_DATA_API_KEY;
const tiingoBase = process.env.MARKET_DATA_BASE_URL ?? 'https://api.tiingo.com';

if (!supabaseUrl || !serviceRoleKey || !tiingoKey) {
  throw new Error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MARKET_DATA_API_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let rows = null;

const jsonCandidates = [
  `${tiingoBase}/tiingo/daily/supported_tickers?token=${encodeURIComponent(tiingoKey)}`,
  `${tiingoBase}/tiingo/daily?token=${encodeURIComponent(tiingoKey)}`
];

for (const candidate of jsonCandidates) {
  console.log(`[sync-instruments] Trying JSON source ${candidate.replace(tiingoKey, '***')}`);
  rows = await fetchJsonTickers(candidate);
  if (rows && rows.length) {
    console.log(`[sync-instruments] JSON source succeeded with ${rows.length} rows`);
    break;
  }
}

if (!rows || rows.length === 0) {
  const zipUrl = 'https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip';
  console.log(`[sync-instruments] Falling back to ZIP source ${zipUrl}`);
  rows = await fetchZipTickers(zipUrl);
  console.log(`[sync-instruments] ZIP source succeeded with ${rows.length} rows`);
}

if (!rows.length) {
  throw new Error('No instruments were returned from Tiingo sources');
}

// Tiingo source can contain duplicate symbols; keep one canonical row per symbol
// so a single upsert statement never targets the same conflict key more than once.
const dedupedBySymbol = new Map();
for (const row of rows) {
  const existing = dedupedBySymbol.get(row.symbol);
  if (!existing) {
    dedupedBySymbol.set(row.symbol, row);
    continue;
  }

  const existingScore = (existing.exchange !== 'N/A' ? 1 : 0) + (existing.asset_type !== 'unknown' ? 1 : 0) + (existing.short_description ? 1 : 0);
  const nextScore = (row.exchange !== 'N/A' ? 1 : 0) + (row.asset_type !== 'unknown' ? 1 : 0) + (row.short_description ? 1 : 0);
  if (nextScore > existingScore) {
    dedupedBySymbol.set(row.symbol, row);
  }
}
rows = [...dedupedBySymbol.values()];
console.log(`[sync-instruments] Deduped to ${rows.length} unique symbols`);

const chunkSize = 500;
for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize);
  const { error } = await supabase
    .from('instruments')
    .upsert(chunk, { onConflict: 'symbol' });

  if (error) {
    throw new Error(`Supabase upsert failed at chunk ${i / chunkSize + 1}: ${error.message}`);
  }

  process.stdout.write(`\r[sync-instruments] Upserted ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
}

console.log('\n[sync-instruments] Complete');
