// Model prices and context windows, used for the cost estimate and the context gauge.
//
// Source: Anthropic's published model table (cached 2026-10-06). Prices are USD per million tokens.
// A model that is not in this table has no price: the app then shows no cost for it instead of guessing.
//
// `read` is the cache-read price when it is published for the model. When it is not listed we use the
// standard 0.1x of the input price. Cache writes are priced as 1.25x input for the 5-minute cache and
// 2x input for the 1-hour cache (standard multipliers; they are not listed per model).
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25, ctx: 1e6 },
  'claude-mythos-5-1': { in: 10, out: 50, read: 0.25, ctx: 1e6 },
  'claude-fable-5': { in: 10, out: 50, read: 0.25, ctx: 1e6 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2, ctx: 1e6 },
  'claude-opus-5': { in: 5, out: 25, ctx: 1e6 },
  'claude-opus-4-8': { in: 5, out: 25, ctx: 1e6 },
  'claude-opus-4-7': { in: 5, out: 25, ctx: 1e6 },
  'claude-opus-4-6': { in: 5, out: 25, ctx: 1e6 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2, ctx: 1e6 },
  'claude-sonnet-5': { in: 2, out: 10, ctx: 1e6 },
  'claude-sonnet-4-6': { in: 3, out: 15, ctx: 1e6 },
  // Haiku 5.5: these prices apply to prompts up to 100K tokens, `long` beyond that.
  'claude-haiku-5-5': { in: 0.1, out: 0.5, ctx: 1e6, tierAt: 100000, long: { in: 0.5, out: 2.5 } },
  'claude-haiku-4-5': { in: 1, out: 5, ctx: 200000 },
};

const DEFAULT_WINDOW = 200000;

// "claude-haiku-4-5-20251001" and "claude-opus-5-5[1m]" both resolve to the base model id.
function normalize(model) {
  return String(model || '').toLowerCase().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
}

function lookup(model) {
  return PRICES[normalize(model)] || null;
}

// Context window for a model. A session that has already used more than the table says is on a larger
// window (for example a 1M variant), so the observed size wins.
function windowFor(model, observedCtx) {
  const p = lookup(model);
  const w = p ? p.ctx : DEFAULT_WINDOW;
  return observedCtx && observedCtx > w ? 1e6 : w;
}

// Estimated cost in USD of one assistant message, or null when the model has no known price.
function costOf(model, u) {
  const p = lookup(model);
  if (!p) return null;
  const promptTokens = u.input + u.cacheRead + u.cache5m + u.cache1h;
  const tier = p.tierAt && promptTokens > p.tierAt ? p.long : p;
  const inPrice = tier.in;
  const outPrice = tier.out;
  const readPrice = tier === p && p.read !== undefined ? p.read : inPrice * 0.1;
  return (
    u.input * inPrice +
    u.output * outPrice +
    u.cacheRead * readPrice +
    u.cache5m * inPrice * 1.25 +
    u.cache1h * inPrice * 2
  ) / 1e6;
}

module.exports = { PRICES, normalize, lookup, windowFor, costOf };
