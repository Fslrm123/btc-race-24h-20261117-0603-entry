// DipBuyer v5: a long-only dip-buying bot for the cbBTC 24h race.
//
// Round 2 finding: the dev window is flat/ranging on short horizons (net
// +49 bps over 24h, median 1-bar move ~3 bps), so short-lookback dip
// buying tops out near +$18 and micro-scalping loses money after the ~35
// bps full-size round-trip cost (4 bps fee, 2 bps slippage, ~11 bps of
// price impact per leg at the pool's ~$880k depth). The money in this
// window is in the multi-hour swings (e.g. a +169 bps hour followed by a
// -112 bps hour), so this bot waits for a deep dip against a SIX-HOUR
// rolling high — the close at least DROP_BPS below the highest close of
// the last LOOKBACK_BARS — buys with the full cash balance, and sells the
// whole position once the close has bounced BOUNCE_BPS above the entry
// close. If the bounce never comes the position is simply held to the end
// of the window, where the replay flattens it.
//
// The 150/170 bps region is a plateau, not a knife edge: 19 of 45 nearby
// (lookback, dip, bounce) combinations beat the v4 bot's +$17.64 on the
// dev window, and 6 clear +$25. This variant (360/170/170) is the best
// of the grid at +$30.01 in the offline replay, 2 trades, both wins,
// max drawdown 0.77%.
//
// One position at a time, full cash in, full position out. No shorts, no
// leverage, no randomness, no wall clock: every decision is a pure
// function of the bars seen so far, so the two official executions agree
// byte for byte.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK_BARS = 360;
const DROP_BPS = 170n;
const BOUNCE_BPS = 170n;
const MAX_SLIPPAGE_BPS = 100;
const MIN_NOTIONAL_UNITS = 1_000_000n; // 1 USDC, the replay's minimum

/** Closes seen so far, indexed by bar, for the rolling high. */
const closes: bigint[] = [];
/** Close the open position was bought at (null while flat). */
let entryClose: bigint | null = null;

function onBatch(state: BarsState, _batch: Batch): OrderInput[] {
  if (state.warmingUp) return [];
  const close = state.close(SYMBOL);
  if (close === null) return [];
  closes.push(close);

  const pos = state.positions.get(SYMBOL);
  const qty = pos?.qty ?? 0n;

  if (qty === 0n) {
    entryClose = null;
    if (closes.length <= LOOKBACK_BARS) return [];
    let high = closes[closes.length - 1]!;
    for (let i = closes.length - 2; i >= closes.length - LOOKBACK_BARS; i--) {
      if (closes[i]! > high) high = closes[i]!;
    }
    // A deep dip only: the close must sit DROP_BPS or more under the high.
    if ((high - close) * 10_000n < high * DROP_BPS) return [];
    const cash = state.cash;
    if (cash < MIN_NOTIONAL_UNITS) return [];
    const room = state.weightRoom(SYMBOL);
    const spend = cash < room ? cash : room;
    if (spend < MIN_NOTIONAL_UNITS) return [];
    entryClose = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  // Long: take the bounce target off the entry close, then wait flat.
  if (entryClose !== null && (close - entryClose) * 10_000n >= entryClose * BOUNCE_BPS) {
    entryClose = null;
    return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
