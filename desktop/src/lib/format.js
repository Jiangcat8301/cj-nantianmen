// ponytail: shared token cost calc — (input-cached)*input_price + output*output_price + cached*cache_hit_price
// Avoids double-counting cached tokens that are already included in input_tokens (Anthropic protocol).
export function calcCost(r) {
  return ((r.input_tokens || 0) - (r.cached_tokens || 0)) * (r.input_price || 0) / 1_000_000
    + ((r.output_tokens || 0) * (r.output_price || 0)) / 1_000_000
    + ((r.cached_tokens || 0) * (r.cache_hit_price || 0)) / 1_000_000
}

// ponytail: shared token count formatter. 1000-based (LLM billing convention): K=1e3, M=1e6.
// M takes precedence over K so 1,500,000 renders as "1.5M" not "1500.0K" (#3).
export function formatToken(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 1 : 2) + 'K'
  return String(n)
}
