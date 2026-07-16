// ponytail: shared token cost calc — (input-cached)*input_price + output*output_price + cached*cache_hit_price
// Avoids double-counting cached tokens that are already included in input_tokens (Anthropic protocol).
export function calcCost(r) {
  return ((r.input_tokens || 0) - (r.cached_tokens || 0)) * (r.input_price || 0) / 1_000_000
    + ((r.output_tokens || 0) * (r.output_price || 0)) / 1_000_000
    + ((r.cached_tokens || 0) * (r.cache_hit_price || 0)) / 1_000_000
}
