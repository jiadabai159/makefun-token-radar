// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every rankable pre-token protocol in the snapshot: the 40-protocol watchlist is
// the floor, never the ceiling, and every other pre-token protocol that is not an exchange and not a
// versioned pool joins it. A protocol is pre-token when its record carries no token (no market cap,
// no CoinGecko id, no symbol); live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board. Saying a protocol "records no token" is not saying it
// has none: the snapshot is a record, not proof.
//
// Implied value follows only from the snapshot's own figures, through one function that scores
// every protocol the same way. No protocol name is ever special-cased:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth    = 1 + 0.02 x min(max(chains - 1, 0), 5)    (distribution breadth, 1.00-1.10)
//   momentum   = 1.05 when the protocol is under a year old and growing over 20% in 7 days,
//                else 1.00 (fresh momentum: young and fast-growing)
//   implied    = max(1, round(base x growthMult x maturity x breadth x momentum))
//
// TVL is the size of the bet the market has already placed. Seven-day growth is the direction it
// is moving. Age with no token is the time the protocol has run without issuing one: the longer a
// large protocol runs pre-token, the more value a launch would have to recognise. Chain breadth
// is distribution: a protocol live on several chains reaches more farmers than one on a single
// chain. The constants are the model's, stated in the dashboard and changeable in one place.
//
// A readiness score (0-100) is also derived from the same figures, for display only: it blends
// maturity, growth and breadth so a reader can see at a glance which rows are closest to a launch
// window. It never changes the ranking: rank is by implied value alone.

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

/** The model's constants, as the dashboard states them and the page may show. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  momentum_boost: number;
  momentum_age_days: number;
  momentum_growth_pct: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
  momentum_boost: 1.05,
  momentum_age_days: 365,
  momentum_growth_pct: 20,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    momentum_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  momentum_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist: string[];
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  momentumMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const momentumMult =
    age !== null && age < model.momentum_age_days && growthPct > model.momentum_growth_pct
      ? model.momentum_boost
      : 1;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult * momentumMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, momentumMult, age };
}

/**
 * Readiness (0-100, display only, never the ranking): how close a protocol looks to a launch
 * window, from the same figures. Maturity carries half the weight (time served with no token),
 * growth three tenths (direction and speed), breadth two tenths (distribution).
 */
export function readinessScore(age: number | null, growthPct: number, chains: number): number {
  const ageForScore = age ?? 365;
  const maturityPart = Math.min(Math.max(ageForScore, 0), 1095) / 1095;
  const growthPart = Math.min(Math.max((growthPct + 60) / 180, 0), 1);
  const breadthPart = Math.min(Math.max(chains - 1, 0), 5) / 5;
  return Math.max(0, Math.min(100, Math.round(100 * (0.5 * maturityPart + 0.3 * growthPart + 0.2 * breadthPart))));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The categories of products that are not a protocol waiting on a launch of its own: a bridge
 * moves another chain's asset, a liquid-staking or restaking product wraps a token that trades,
 * and an exchange's own product is that exchange's. The watchlist rule says the same; the one
 * part of it this snapshot cannot carry is DefiLlama's parent protocol, so the name and category
 * rules below are the usable proxy for it.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word wrapped, staked or staking, in any case: a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name: that exchange's own product. */
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, not a bridge, staking or restaking
 * product, not an exchange or an exchange's product, and not a versioned pool of another
 * protocol. WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in a staking product, and
 * USDT0 is a bridged dollar: none of them is a protocol still waiting on a launch of its own,
 * and ranking one first would mistake a wrapped asset for a token to come.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n. The watchlist is the floor:
 * every slug in it is ranked. Every other rankable pre-token protocol joins too, whether it sits
 * above the floor and the watchlist left it out, or below the floor: the floor is never the whole
 * board, and the early rows are the radar's reason to exist.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    readiness: readinessScore(s.age, s.growthPct, s.p.chains.length),
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      momentum_multiplier: round4(s.momentumMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The weekly qualifying action for a category, so the plan reads like the protocol, not a template. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return 'Make one qualifying action each week: add collateral, borrow a small amount and repay it, or vote in governance.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return 'Make one qualifying action each week: add or rebalance liquidity, or run one swap through the pool.';
  if (c.includes('bridge'))
    return 'Make one qualifying action each week: bridge a small amount and use the bridged funds in the destination app.';
  if (c.includes('staking') || c.includes('restak'))
    return 'Make one qualifying action each week: top up the stake a little, or restake the rewards it pays.';
  if (c.includes('perpetual') || c.includes('derivative'))
    return 'Make one qualifying action each week: open and close one small hedged position, and keep the margin topped up.';
  if (c.includes('prediction'))
    return 'Make one qualifying action each week: place one small market position and settle it before it expires.';
  if (c.includes('curator') || c.includes('allocator'))
    return 'Make one qualifying action each week: deposit into a vault, or move a share between two of its vaults.';
  if (c.includes('stable'))
    return 'Make one qualifying action each week: mint, deposit or redeem a small amount of the stable asset.';
  if (c.includes('rwa'))
    return 'Make one qualifying action each week: mint a little of the yield asset, or claim and re-deposit its yield.';
  return 'Make one qualifying action each week: a deposit, a borrow, a swap or a vote in the protocol.';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every step names what it costs and how long it takes, and the last step says how to get
 * out again, because a farm with no exit is not a plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `To exit, unwind in the reverse order you entered, leave dust behind for gas, and keep the farm log for tax time.`,
      cost: `about $${gas} of gas to unwind`,
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    readiness: row.readiness,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist: snapshot.watchlist.slice(),
    rows: board.map(radarRow),
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
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** One self-check of the board: its name, whether it passed, and what it found. */
export interface AuditCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** The board's whole self-check: every check, and whether they all passed. */
export interface BoardAudit {
  passed: boolean;
  checks: AuditCheck[];
}

/**
 * The model's self-check, run by main.ts before anything is written and by the dashboard
 * in the reader's browser: recompute every row from the snapshot's own figures, and check
 * the ranks, the order, the watchlist, the farm plans and the readiness range. A board
 * that fails any of these is not handed in, and a dashboard that fails any of them says
 * so on the page instead of silently showing a stale table.
 */
export function auditBoard(board: BoardRow[], snapshot: Snapshot, model: ModelConstants = MODEL): BoardAudit {
  const index = bySlug(snapshot.protocols);
  const checks: AuditCheck[] = [];

  let mismatches = 0;
  let missing = 0;
  for (const row of board) {
    const p = index.get(row.slug);
    if (p === undefined) {
      missing += 1;
      continue;
    }
    if (impliedValue(p, snapshot.as_of, model).implied !== row.implied_value_usd) mismatches += 1;
  }
  checks.push({
    name: 'recompute',
    passed: mismatches === 0 && missing === 0,
    detail: `${board.length - mismatches - missing} of ${board.length} rows recompute to the implied value board.json carries`,
  });

  let ranksOk = board.length > 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) {
      ranksOk = false;
      break;
    }
  }
  checks.push({
    name: 'ranks',
    passed: ranksOk,
    detail: ranksOk ? `ranks run 1 to ${board.length} with no gap and no repeat` : 'ranks are not 1..n in order',
  });

  let ordered = true;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      ordered = false;
      break;
    }
  }
  checks.push({
    name: 'order',
    passed: ordered,
    detail: ordered ? 'implied value never rises going down the board' : 'a lower row outranks the row above it on implied value',
  });

  const slugs = new Set(board.map((r) => r.slug));
  const absent = snapshot.watchlist.filter((s) => !slugs.has(s));
  checks.push({
    name: 'watchlist',
    passed: absent.length === 0,
    detail:
      absent.length === 0
        ? `all ${snapshot.watchlist.length} watchlist protocols are on the board`
        : `${absent.length} watchlist slugs are missing: ${absent.slice(0, 5).join(', ')}`,
  });

  let badPlans = 0;
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      badPlans += 1;
      continue;
    }
    for (const s of row.farm_steps) {
      if (s.length < 20 || s.length > 600) {
        badPlans += 1;
        break;
      }
    }
  }
  checks.push({
    name: 'farm-plans',
    passed: badPlans === 0,
    detail:
      badPlans === 0
        ? 'every row carries 3 to 12 farm steps of 20 to 600 characters'
        : `${badPlans} rows carry a farm plan outside 3 to 12 steps of 20 to 600 characters`,
  });

  let badReadiness = 0;
  for (const row of board) {
    if (!Number.isFinite(row.readiness) || row.readiness < 0 || row.readiness > 100) badReadiness += 1;
  }
  checks.push({
    name: 'readiness',
    passed: badReadiness === 0,
    detail: badReadiness === 0 ? 'every readiness score sits between 0 and 100' : `${badReadiness} rows carry a readiness outside 0 to 100`,
  });

  const distinct = new Set(board.map((r) => r.implied_value_usd)).size;
  checks.push({
    name: 'spread',
    passed: board.length < 2 || distinct > 1,
    detail:
      distinct > 1
        ? `${distinct} distinct implied values across ${board.length} rows`
        : 'every row shares one implied value: the board ranks nothing',
  });

  return { passed: checks.every((c) => c.passed), checks };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
