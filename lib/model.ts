// PreToken Radar: the valuation model, the board builder and the farm-plan generator.
//
// The radar ranks protocols that record no token yet by what a token would be worth if the protocol's
// record stayed as it is. Every number comes out of the sealed snapshot itself; no protocol name is
// special-cased anywhere in this file.
//
// The model, in one paragraph. Protocols that already trade give the market's own answer to "what is a
// dollar of TVL worth as token value": the ratio of market cap to TVL. Take the median of that ratio
// inside each category (Dexs, Lending, Yield, ...) over the snapshot's tokenized protocols, and a
// category with too few trading members falls back to the median over the whole snapshot. A pre-token
// protocol's base value is its TVL times its category's multiple. Three bounded adjustments follow,
// each computed from the row's own figures: a momentum factor from the seven-day TVL change (clamped,
// so one wild week cannot dominate), a track-record factor that grows logarithmically with the days
// the protocol has run with no token (capped at five years), and a small reach factor for each extra
// chain it runs on (capped at ten). The board is the watchlist in full plus the strongest pre-token
// protocols below the watchlist floor, ranked by the result.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's multiple: the median market-cap/TVL of its trading members, and where it came from. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  sample: number;
  source: 'category' | 'global';
}

/** A trading protocol the detail view names as a comparable for a pre-token row. */
export interface Comparable {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** The model's constants, stated in the dashboard so a reader can re-derive every row. */
export interface ModelSpec {
  min_category_sample: number;
  multiple_min: number;
  multiple_max: number;
  momentum_clamp_low: number;
  momentum_clamp_high: number;
  momentum_divisor: number;
  age_premium: number;
  age_cap_days: number;
  chain_step: number;
  chain_cap: number;
  extra_rows: number;
}

export const MODEL: ModelSpec = {
  min_category_sample: 4,
  multiple_min: 0.02,
  multiple_max: 3,
  momentum_clamp_low: -30,
  momentum_clamp_high: 60,
  momentum_divisor: 200,
  age_premium: 0.3,
  age_cap_days: 1825,
  chain_step: 0.02,
  chain_cap: 10,
  extra_rows: 180,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'pretoken-radar-1';

/** How many live-token protocols the dashboard's reference strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row's full model breakdown, as the detail view shows it. */
export interface ModelBreakdown {
  multiple: number;
  multiple_source: 'category' | 'global';
  multiple_sample: number;
  base_value_usd: number;
  momentum_factor: number;
  change_7d_used: number;
  age_factor: number;
  age_days: number | null;
  chain_factor: number;
  chain_count: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: ModelBreakdown;
  comparables: Comparable[];
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's fields, as data.js carries them. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the dashboard shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live reference set, and the model behind them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  spec: ModelSpec;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol already trades: the snapshot records a token for it. */
export function isTokenized(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The multiples table: for every category, the median market-cap/TVL of its trading members, with the
 * whole-snapshot median standing in for any category with fewer than the minimum sample. Multiples are
 * clamped to a sane band so one thin, wild category cannot price a board row at an absurd figure.
 */
export function categoryMultiples(snapshot: Snapshot): { table: CategoryMultiple[]; global: number; byCategory: Map<string, CategoryMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '(none)';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = clamp(median(allRatios), MODEL.multiple_min, MODEL.multiple_max);
  const table: CategoryMultiple[] = [];
  const byCategory = new Map<string, CategoryMultiple>();
  for (const category of [...ratiosByCategory.keys()].sort()) {
    const ratios = ratiosByCategory.get(category)!;
    const useOwn = ratios.length >= MODEL.min_category_sample;
    const entry: CategoryMultiple = {
      category,
      multiple: round4(useOwn ? clamp(median(ratios), MODEL.multiple_min, MODEL.multiple_max) : global),
      sample: ratios.length,
      source: useOwn ? 'category' : 'global',
    };
    table.push(entry);
    byCategory.set(category, entry);
  }
  return { table, global: round4(global), byCategory };
}

/** The multiple one protocol is priced with, and the sample behind it. */
function multipleFor(p: SnapshotProtocol, multiples: { global: number; byCategory: Map<string, CategoryMultiple> }): { multiple: number; source: 'category' | 'global'; sample: number } {
  const entry = p.category === null ? undefined : multiples.byCategory.get(p.category);
  if (entry !== undefined && entry.source === 'category') return { multiple: entry.multiple, source: 'category', sample: entry.sample };
  return { multiple: multiples.global, source: 'global', sample: entry?.sample ?? 0 };
}

/** The strongest trading members of a protocol's category, by market cap: the detail view's comparables. */
function comparablesFor(p: SnapshotProtocol, snapshot: Snapshot): Comparable[] {
  if (p.category === null) return [];
  return snapshot.protocols
    .filter((q) => q.category === p.category && q.mcap_usd !== null && q.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((q) => ({ name: q.name, mcap_usd: q.mcap_usd!, tvl_usd: q.tvl_usd, ratio: round4(q.mcap_usd! / q.tvl_usd) }));
}

/** The momentum factor: the seven-day TVL change, clamped, scaled to a bounded multiplier. */
function momentumFactor(change7d: number | null): { factor: number; used: number } {
  const raw = change7d ?? 0;
  const used = clamp(raw, MODEL.momentum_clamp_low, MODEL.momentum_clamp_high);
  return { factor: 1 + used / MODEL.momentum_divisor, used };
}

/** The track-record factor: a log-scaled premium for days run with no token, capped at five years. */
function ageFactor(age: number | null): number {
  if (age === null) return 1;
  return 1 + MODEL.age_premium * (Math.log1p(age) / Math.log1p(MODEL.age_cap_days));
}

/** The reach factor: a small premium per extra chain, capped. */
function chainFactor(chainCount: number): number {
  return 1 + MODEL.chain_step * Math.min(Math.max(chainCount - 1, 0), MODEL.chain_cap);
}

/** One protocol's implied value and the breakdown that produced it. */
export function impliedValue(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  multiples: { global: number; byCategory: Map<string, CategoryMultiple> },
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const m = multipleFor(p, multiples);
  const base = p.tvl_usd * m.multiple;
  const momentum = momentumFactor(p.change_7d);
  const ageF = ageFactor(age);
  const chainF = chainFactor(p.chains.length);
  const implied = clamp(Math.max(1, Math.round(base * momentum.factor * ageF * chainF)), 1, 100_000_000_000_000);
  return {
    implied,
    breakdown: {
      multiple: m.multiple,
      multiple_source: m.source,
      multiple_sample: m.sample,
      base_value_usd: Math.round(base),
      momentum_factor: round4(momentum.factor),
      change_7d_used: momentum.used,
      age_factor: round4(ageF),
      age_days: age,
      chain_factor: round4(chainF),
      chain_count: p.chains.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Board selection
// ---------------------------------------------------------------------------

/** Categories whose products are a wrapped, staked or bridged form of another protocol's token: the
 *  house's watchlist rule keeps them off, and the radar's extra rows follow the same line. */
const EXCLUDED_EXTRA_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word that marks a wrapped or staking product of a token that already trades. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a version marker: a later pool of a protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that begins with an exchange's name: the exchange's own product, not an independent protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a below-floor pre-token protocol may stand as one of the radar's early rows. */
function isEligibleExtra(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_EXTRA_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_OR_STAKED.test(p.name) || VERSIONED.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n and a farm plan on every row. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = categoryMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is a row, whatever its category or name.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early rows: pre-token protocols below the floor, scored by the same model, strongest first.
  const extras = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isEligibleExtra(p))
    .map((p) => ({ p, implied: impliedValue(p, snapshot, multiples).implied }))
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, MODEL.extra_rows);
  for (const e of extras) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot, multiples);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.age_days,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    model: s.breakdown,
    comparables: comparablesFor(s.p, snapshot),
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

/** The playbook family a category farms under. */
type Family = 'dex' | 'lending' | 'yield' | 'perps' | 'bridge' | 'staking' | 'rwa' | 'generic';

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex')) return 'dex';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic')) return 'perps';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('allocator') || c.includes('basis') || c.includes('index')) return 'yield';
  return 'generic';
}

/** Working capital for one farm position, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** A rough per-transaction gas figure for a chain: Ethereum mainnet is the dear one, the rest are not. */
function gasFor(chain: string): string {
  return chain === 'Ethereum' ? '$6-12' : '$1-3';
}

/** How long a position should be held, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const chainAt = (p: SnapshotProtocol, i: number): string => p.chains[i] ?? p.chains[0] ?? 'its main chain';

/** The playbook's core action, in words a farmer can follow, with its amount, cost and time inside. */
function coreStep(family: Family, p: SnapshotProtocol, cap: number): string {
  const name = p.name;
  const chain = chainAt(p, 0);
  const gas = gasFor(chain);
  switch (family) {
    case 'dex':
      return `Swap at least $${cap * 4} of volume through ${name} on ${chain} across four separate sessions, trading the deepest pairs (the chain's main stablecoin against its main asset) so the volume reads as real use, not wash. Cost: about ${gas} in gas plus roughly 0.1-0.3% in swap fees per session. Time: 15 minutes per session, spread over two weeks.`;
    case 'lending':
      return `Supply $${cap} of USDC (or the main stablecoin on ${chain}) to ${name} on ${chain} and leave it supplied; a supplied balance that stays put is the position most lending snapshots reward. Cost: about ${gas} in gas for the approval and the supply. Time: 10 minutes to set up.`;
    case 'yield':
      return `Deposit $${cap} of USDC or the chain's main stablecoin into ${name}'s highest-TVL vault on ${chain} and keep the vault shares in the same wallet. Cost: about ${gas} in gas for the approval and deposit. Time: 10 minutes to set up.`;
    case 'perps':
      return `Deposit $${cap} of USDC as margin on ${name} and trade at least $${cap * 6} of notional volume over two weeks with small, mostly hedged positions (long and short legs near-equal), so the volume is real but the market risk stays small. Cost: about ${gas} in gas plus maker/taker fees of roughly 0.02-0.05% of volume. Time: 20 minutes per session, four sessions.`;
    case 'bridge':
      return `Bridge $${cap} of USDC from ${chain} to ${chainAt(p, 1)} through ${name}, then bridge a similar amount back on a different day; round trips on separate days count as genuine cross-chain use. Cost: about ${gas} in gas on each side plus the bridge's own fee, usually under 0.1%. Time: 15 minutes per crossing, most of it waiting for finality.`;
    case 'staking':
      return `Stake $${cap} worth of the chain's staking asset through ${name} on ${chain} and hold the receipt token in the same wallet; do not sell or re-pledge the receipt during the qualifying window. Cost: about ${gas} in gas. Time: 10 minutes to set up.`;
    case 'rwa':
      return `Mint or buy $${cap} of ${name}'s yield-bearing asset on ${chain} through its own app and hold it untouched; RWA positions are usually counted by balance and holding time, not by transaction count. Cost: about ${gas} in gas, plus any mint fee the app states up front. Time: 15 minutes to set up.`;
    default:
      return `Put $${cap} of USDC to work in ${name}'s core product on ${chain} — a deposit, a mint or a position, whichever its app leads with — and leave it in place. Cost: about ${gas} in gas for the approvals and the action. Time: 15 minutes to set up.`;
  }
}

/** The playbook's second action: a second chain when the protocol runs on one, else a deeper first-chain step. */
function secondStep(family: Family, p: SnapshotProtocol, cap: number): string {
  const name = p.name;
  if (p.chains.length >= 2) {
    const chain = chainAt(p, 1);
    return `Repeat the core action on ${chain} with about half the amount ($${Math.round(cap / 2)}): ${name} runs on ${p.chains.length} chains, and activity on a second chain is the cheapest way to look like a real multi-chain user rather than a one-off. Cost: about ${gasFor(chain)} in gas plus the position itself. Time: 15 minutes.`;
  }
  const chain = chainAt(p, 0);
  const gas = gasFor(chain);
  switch (family) {
    case 'dex':
      return `Add $${Math.round(cap / 2)} of liquidity to ${name}'s busiest pool on ${chain} and leave it in range for the full holding window; liquidity that survives a few weeks is a stronger signal than swap volume alone. Cost: about ${gas} in gas. Time: 15 minutes to set up.`;
    case 'lending':
      return `Borrow about 40% of the supplied value on ${name} and re-supply it once — a single careful loop, never a leverage spiral — then repay before the holding window ends. Cost: about ${gas} in gas per leg, plus borrow interest of a few dollars over the window. Time: 15 minutes.`;
    case 'yield':
      return `Split a second $${Math.round(cap / 2)} into a different ${name} vault or strategy on ${chain} once the first deposit is a week old, so the wallet shows two distinct positions of different ages. Cost: about ${gas} in gas. Time: 10 minutes.`;
    case 'perps':
      return `Keep one small open position on ${name} overnight at least twice a week rather than opening and closing inside one session; open interest held across days is what perps points programs usually measure. Cost: funding payments of a few dollars a week on a $${cap} margin. Time: 5 minutes per check-in.`;
    case 'bridge':
      return `Add a second route: bridge $${Math.round(cap / 2)} to a third destination or back from ${chainAt(p, 1)} on a later week, building total bridged volume gradually instead of in one day. Cost: about ${gas} in gas per crossing plus the bridge fee. Time: 15 minutes per crossing.`;
    case 'staking':
      return `Claim and re-stake the rewards on ${name} once a week instead of letting them sit idle; a wallet that compounds is visibly an active staker. Cost: about ${gas} in gas per claim. Time: 5 minutes a week.`;
    case 'rwa':
      return `Add a second, smaller $${Math.round(cap / 2)} position in ${name} a few weeks after the first, so the wallet's holding history shows two separate entries rather than one test transaction. Cost: about ${gas} in gas. Time: 10 minutes.`;
    default:
      return `Make a second, distinct use of ${name} on ${chain} a week after the first — a different pool, market or product inside the same app — so the wallet's history is a pattern of use, not a single transaction. Cost: about ${gas} in gas. Time: 15 minutes.`;
  }
}

/**
 * A protocol's farm plan: six steps, generated from its category playbook and parameterised with its
 * own chains, TVL tier and age. Every step names the action, an amount or volume, a cost and a time.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const family = familyOf(p.category);
  const cap = capitalFor(p);
  const hold = holdDaysFor(age);
  const chain = chainAt(p, 0);
  return [
    `Set up one fresh wallet for ${p.name} alone and fund it on ${chain} with the working capital plus a little extra for gas; keep the seed phrase offline and never farm from a wallet that holds other assets. Cost: about ${gasFor(chain)} in gas for the first funding transaction. Time: 10 minutes.`,
    coreStep(family, p, cap),
    secondStep(family, p, cap),
    `Return once a week and make one small qualifying action on ${p.name} — a deposit, a swap, a claim or a vote, whichever its app counts — so the wallet never looks abandoned between snapshots. Cost: about ${gasFor(chain)} in gas a week. Time: 10 minutes a week.`,
    `Hold every position for at least ${hold} days before unwinding: ${p.name} has run ${age === null ? 'for an unrecorded span' : `for about ${age} days`} with no token, and airdrop snapshots for protocols of this age typically span several weeks of balances. Cost: the capital stays in the positions, earning or risking whatever the positions themselves do. Time: ${hold} days.`,
    `Before withdrawing anything, open ${p.name}'s own points or rewards page from the link its official site publishes — never from a search result or a message — and write the wallet, the dates and every transaction hash into a farm log. Cost: nothing to check, and never pay a fee to 'claim' an unannounced token. Time: 10 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// Live reference set, assembly, validation, serialisation
// ---------------------------------------------------------------------------

/** The live-token protocols, by market cap, for the dashboard's already-trading reference strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isTokenized(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const multiples = categoryMultiples(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    spec: MODEL,
    global_multiple: multiples.global,
    multiples: multiples.table,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string') : []);
    const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: strings(p.chains),
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it is: the gate's rows, checked locally. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!snapshotSlugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} trimmed characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
