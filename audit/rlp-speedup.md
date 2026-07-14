# RLP speedup (2026-07)

`src/core/rlp.ts` was rewritten from a declarative micro-packed coder into a direct
implementation. It is now the fastest of the compared libraries (@ethereumjs/rlp, ethers, viem)
on every apples-to-apples benchmark, at roughly 10x the previous speed. The public API is
unchanged; all 462 tests pass, including ethereum-tests invalid-RLP vectors and the ethers/viem
vector suites.

## What changed

- **Encoder**: two-pass. First pass measures the input tree (converting leaves to bytes and
  caching list payload sizes), second pass writes into a single pre-allocated buffer of the exact
  size. Previously every item went through micro-packed's bit-level Writer.
- **Decoder**: index-based cursor over the input, returning subarrays (same aliasing behavior as
  before). Previously items were parsed via bit-level tag reads into an intermediate tagged tree
  (`InternalRLP`) that was then converted to the output.
- **Numeric conversion**: number→bytes uses 32-bit halves with bitwise ops; bigints that fit in
  `Number.MAX_SAFE_INTEGER` (nonces, gas, chain ids) take the same path instead of
  hex-string round-tripping.
- `RLP` is still a frozen micro-packed `CoderType<RLPInput>`: `encodeStream`/`decodeStream` work
  mid-stream (used by tx envelope parsing in `tx-internal.ts`). `decodeStream` derives the item
  size from the prefix, consumes exactly that many bytes, and re-validates canonically.

Canonicity rules are preserved: shortest-form lengths, no leading zeros in lengths, single bytes
< 0x80 encoded without a prefix, no trailing bytes.

## API notes

- Removed: the exported `InternalRLP` type (the old coder's tagged intermediate tree, documented
  as internal). Nothing in src/ or test/ referenced it, but it was reachable via the
  `./core/rlp.js` subpath export — changelog-worthy.
- Tightened: `RLP.encode(3.5)` now throws explicitly ("invalid integer as argument") instead of
  misbehaving inside byte conversion.

## Security considerations (see also zst.md)

Concern: dropping micro-packed removes the machinery that mitigated the attacks in
[zst.md](./zst.md). Analysis:

**The zst.md attack class does not transfer to RLP.** All three ABI bugs (ZST recursion, scope
re-dereference, interleave amplification) exist because ABI has *pointers*, which let one input
byte contribute to the output many times. micro-packed's mitigation — the read-once bitset
(`markBytesBS`) — only activates when a pointer coder calls `_enablePointers()`. RLP is linear
and length-prefixed, so the old RLP coder never engaged it; its only re-read guard was the
Reader's monotonic cursor, and the new decoder has the same monotonic cursor. Amplification is
impossible by construction: every decoded item consumes at least one input byte (item count ≤
input length) and string values are zero-copy subarrays. The ABI coder in `src/advanced/abi.ts`
— where the attack class actually lives — still runs on micro-packed with the bitset untouched,
as does the outer tx envelope reader.

**Protections micro-packed did provide for RLP, and where they live now:**

- bounds checks (`Reader.bytes`) → explicit `pos >= boundary` / `itemEnd > boundary` per item;
- trailing-junk detection (`Reader.finish`; the "stealing keys with junk data" defense) →
  `RLP.decode` throws `unread bytes left` unless the item spans the whole input; `decodeStream`
  consumes exactly the prefix-derived size and the outer micro-packed reader still runs
  `finish()`;
- canonical-form enforcement (shortest length form, no leading zeros in lengths, single bytes
  < 0x80 unprefixed) → explicit checks; this makes decode a bijection on canonical encodings,
  which is the property that exposes injected data.

The honest cost: these invariants used to rest on a shared, separately-exercised Reader and now
rest on ~60 lines of hand-written cursor code — a modest increase in audit surface, compensated
by test pressure (below).

**Verification.** One-off differential fuzz of old (micro-packed) vs new implementation, 250k
cases: 50k random trees encoded byte-identically and decoded to identical values; 200k random
and mutated buffers (bitflips, truncations, appended junk) agreed 100% on accept-vs-reject with
identical values when accepted; `encode(decode(d)) === d` held for every accepted input. Deep
nesting fails as a catchable `RangeError` in both, and the new code tolerates deeper nesting
(old encoder overflowed at depth 5000, new handles 6000+). A deterministic, self-oracle version
of these properties (roundtrip, canonical bijection, prefix/junk rejection, mutation canonicity,
numeric-path agreement across the 2^53 boundary, recursion behavior) is now permanent in
`test/rlp.test.ts` under "properties (deterministic fuzz)" — it needs no reference library:
canonicity makes the coder its own oracle.

## Benchmarks

128-item lists, Node 24, jsbt bench. "before/after" are this library; competitors from
`benchmark/thirdparty`.

| case               | micro before | micro after | viem      | @ethereumjs/rlp | ethers |
| ------------------ | ------------ | ----------- | --------- | --------------- | ------ |
| encode bytes (32B) | 32k ops/s    | 374k        | 72k       | 88k             | 4.7k   |
| decode bytes (32B) | 41k          | 392k        | 60k       | 9.7k            | 9.8k   |
| encode numbers     | 27k          | 211k        | 200k \*   | 54k             | 24k \* |
| decode → bytes     | 41k          | ~400k       | 160–250k  | 12–19k          | 39–77k |
| encode 1MB buffers | 19           | ~600        | 1.6       | 390             | 0.5    |
| decode 1MB buffers | 9.8k         | 2.24M       | —         | 82              | crash  |

\* viem/ethers do not accept numbers or bigints; they were handed pre-converted byte trees, so
their numeric-input rows do none of the conversion work. On identical byte-tree inputs micro is
2–6x faster than viem everywhere; on bigint inputs the only comparable library is
@ethereumjs/rlp (beaten 3–4x). ethers `decodeRlp` stack-overflows on the 1MB case.

Transaction hot path (RLP is a fraction of it; keccak/validation dominate): `decodeTxHash`
19.2k → 22.3k ops/s, `decodeTx` 30.6k → 34k.

## Why the declarative version was slow (micro-packed analysis)

The gap was interpreter bookkeeping, not declarativeness itself. Line numbers from micro-packed
`src/index.ts`:

- **Writer small writes**: `Writer.byte()` (:883) allocates `new Uint8Array([b])` and pushes it
  into two arrays — per byte written. Every RLP prefix paid a heap allocation. `writeView`
  (:861) does a `slice` + `fill(0)` per numeric write. `finish()` (:892) concatenates the chunk
  list — a second full copy of the output.
- **Reader per-read bookkeeping**: every `byte()`/`bytes()` runs bitPos + `isNum` + bounds checks,
  then `markBytes` → `markBytesBS` (pointer-overlap machinery; disabled in the common case but
  still two calls and branches per read). `bits()` refills through `byte()` with all of that per
  byte.
- **Always-on diagnostics**: the path stack (`pushObj` per struct field) funds pretty error
  messages but is paid on every successful decode.
- **Intermediate trees**: `P.apply`/`P.tag`/`P.map` materialized a `{TAG, data}` object per item
  before any bytes moved.
- **Format mismatch**: RLP is byte-oriented; modeling its tags with `P.bits(1)`/`P.bits(7)`
  engaged the bit-buffer machinery on every item.

## How micro-packed itself could get fast (future work, `../micro-packed`)

Ideas that preserve the declarative API, roughly in order of value:

1. **Writer chunking** (no API change): coalesce small writes into a growing scratch chunk; keep
   only large caller-provided buffers by reference. The comment at :843 benched a single
   realloc'd buffer as slower, but that tested full realloc-copy, not hybrid chunking.
2. **Size pass + write-into**: optional `size(value)` / `encodeInto(buf, pos)` on `CoderType`,
   derived mechanically by combinators (struct = sum of fields, prefix = length + inner;
   fixed-size coders already have `Sized<T>`). Preallocate once, no chunk lists, no concat —
   exactly the structure of the handwritten RLP encoder, generalized. Fall back to the Writer
   when a coder can't compute size.
3. **Fast reader + replay-on-error diagnostics**: decode with a stripped-down cursor (inline
   bounds check only, pointer bitset enabled lazily); if it throws, re-decode with the
   instrumented reader to reconstruct the path-annotated error. Same errors, near-zero
   happy-path cost.
4. **Fused transforms**: avoid materializing intermediate trees in `apply`/`tag`/`map`
   (visitor-style composition; more invasive).
5. **Byte-aligned tag primitives**: for byte-oriented formats, avoid the bit engine entirely.

Ceiling: protobuf.js reaches handwritten parity via `new Function` codegen — off the table for
the audit/CSP story. An interpreted micro-packed with 1–3 should land within ~1.5–3x of
handwritten instead of 10x, fast enough that only the hottest formats warrant hand-rolling. The
handwritten RLP stays regardless: it is on the tx hot path and the direct version is as readable
as the tagged-tree one.
