import { bytesToHex } from '@noble/hashes/utils.js';
import * as P from 'micro-packed';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import * as snappy from 'snappyjs';
import * as SSZ from '../src/advanced/ssz.ts';

// Test-only ERA/E2Store parser for public Nimbus mainnet files.
// Local EIPs only reference this format at a high level: EIP-7927 names
// `e2store`, and EIP-7801 notes Era1's 8192-block range.
// Public index: https://mainnet.era.nimbus.team/
// Per-fork state samples to download into test/eras/ when verifying ERA parsing:
// - phase0:    https://mainnet.era.nimbus.team/mainnet-00000-4b363db9.era
// - altair:    https://mainnet.era.nimbus.team/mainnet-00290-f66bf737.era
// - bellatrix: https://mainnet.era.nimbus.team/mainnet-00566-19353898.era
// - capella:   https://mainnet.era.nimbus.team/mainnet-00758-a7552bde.era
// - deneb:     https://mainnet.era.nimbus.team/mainnet-01053-c4ee701c.era
// - electra:   https://mainnet.era.nimbus.team/mainnet-01422-566301aa.era
// - fulu:      https://mainnet.era.nimbus.team/mainnet-01607-7189debe.era
// - fulu:      https://mainnet.era.nimbus.team/mainnet-01769-138f7827.era
const E2_TYPES = {
  version: 0x3265,
  block: 1,
  state: 2,
  index: 0x3269,
} as const;
const U24LE = /* @__PURE__ */ P.int(3, true, false, true);
const U48LE = /* @__PURE__ */ P.int(6, true, false, true);
const E2_RECORD = /* @__PURE__ */ P.mappedTag(P.U16LE, {
  version: [E2_TYPES.version, P.bytes(U48LE)],
  block: [E2_TYPES.block, P.bytes(U48LE)],
  state: [E2_TYPES.state, P.bytes(U48LE)],
  index: [E2_TYPES.index, P.bytes(U48LE)],
});
const E2_FILE = /* @__PURE__ */ P.array(null, E2_RECORD);
const SNAPPY_MAGIC = /* @__PURE__ */ P.magicBytes('sNaPpY');
const SNAPPY_CHUNK = /* @__PURE__ */ P.struct({
  type: P.U8,
  len: U24LE,
  data: P.bytes('len'),
});
const SNAPPY_FRAME = /* @__PURE__ */ P.struct({
  identifier: P.struct({
    type: P.magic(P.U8, 0xff),
    len: P.magic(U24LE, 6),
    magic: SNAPPY_MAGIC,
  }),
  chunks: P.array(null, SNAPPY_CHUNK),
});
const STATE_HEAD = /* @__PURE__ */ P.struct({
  genesisTime: P.U64LE,
  genesisValidatorsRoot: P.bytes(32),
  slot: P.U64LE,
  fork: P.struct({
    previous: P.bytes(4),
    current: P.bytes(4),
    epoch: P.U64LE,
  }),
});
const FORKS = Object.entries(SSZ.ForkSlots).map(([name, slot]) => {
  const profile = name.toLowerCase() as keyof typeof SSZ.ETH2_PROFILES;
  const coders = SSZ.ETH2_PROFILES[profile];
  if (!coders) throw new Error(`era: missing SSZ profile for ${name}`);
  return { name: profile, slot: BigInt(slot), profile: coders };
}) as {
  name: keyof typeof SSZ.ETH2_PROFILES;
  slot: bigint;
  profile: { BeaconState: SSZ.SSZCoder<any>; SignedBeaconBlock: SSZ.SSZCoder<any> };
}[];

export type EraEntry = {
  pos: number;
  tag: keyof typeof E2_TYPES;
  type: number;
  payload: Uint8Array;
};
export type EraIndex = {
  startSlot: bigint;
  lastSlot: bigint;
  slots: number;
  skipped: number;
  firstTargetPos?: number;
  slotOffsets: (number | undefined)[];
};
export type EraState = {
  bytes: Uint8Array;
  slot: bigint;
  epoch: bigint;
  fork: { previous: string; current: string; epoch: bigint };
  profile: string;
  value: any;
};
export type EraBlock = {
  pos: number;
  bytes: Uint8Array;
  slot: bigint;
  profile: string;
  value: any;
};
export type EraBlocks = {
  count: number;
  firstSlot?: bigint;
  lastSlot?: bigint;
  profiles: Record<string, number>;
  values?: EraBlock[];
};
export type EraFile = {
  file: string;
  entries: EraEntry[];
  counts: Record<number, number>;
  version?: EraEntry;
  blockIndex?: EraIndex;
  stateIndex?: EraIndex;
  state?: EraState;
  blocks: EraBlocks;
};
type EraScan = {
  file: string;
  entries: EraEntry[];
  counts: Record<string, number>;
  version: EraEntry;
  stateEntry: EraEntry;
  blockIndex?: EraIndex;
  stateIndex: EraIndex;
};

const hx = (bytes: Uint8Array) => `0x${bytesToHex(bytes)}`;
const forkAt = (slot: bigint) => {
  let profile = FORKS[0];
  for (const fork of FORKS) {
    if (slot >= fork.slot) profile = fork;
  }
  return profile;
};
const entries = (bytes: Uint8Array) => {
  let pos = 0;
  const res: EraEntry[] = [];
  for (const ent of E2_FILE.decode(bytes)) {
    // Index offsets are relative to the enclosing E2 record start, not the payload reader.
    res.push({ pos, tag: ent.TAG, type: E2_TYPES[ent.TAG], payload: ent.data });
    pos += 8 + ent.data.length;
  }
  return res;
};
const framedSnappy = (payload: Uint8Array) => {
  const chunks: Uint8Array[] = [];
  for (const chunk of SNAPPY_FRAME.decode(payload).chunks) {
    if (chunk.type === 0xff) {
      SNAPPY_MAGIC.decode(chunk.data);
      continue;
    }
    // Snappy framing reserves 0x80..0xfe for skippable extension chunks.
    if (chunk.type >= 0x80) continue;
    if (chunk.type !== 0x00 && chunk.type !== 0x01)
      throw new Error(`era: unsupported snappy chunk type 0x${chunk.type.toString(16)}`);
    if (chunk.data.length < 4) throw new Error('era: snappy data chunk without checksum');
    chunks.push(
      chunk.type === 0x00 ? snappy.uncompress(chunk.data.subarray(4)) : chunk.data.subarray(4)
    );
  }
  return P.utils.concatBytes(...chunks);
};
const index = (ent: EraEntry): EraIndex => {
  const len = ent.payload.length;
  if (len < 16 || len % 8) throw new Error(`era: bad index len ${len}`);
  const count = Number(P.I64LE.decode(ent.payload.subarray(len - 8)));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`era: bad index count ${count}`);
  if (len !== 16 + 8 * count)
    throw new Error(`era: index len ${len} does not match count ${count}`);
  const startSlot = P.U64LE.decode(ent.payload.subarray(0, 8));
  const raw = P.array(count, P.I64LE).decode(ent.payload.subarray(8, len - 8));
  const slotOffsets = raw.map((offset) => {
    if (offset === -BigInt(ent.pos)) return;
    const pos = ent.pos + Number(offset);
    if (!Number.isSafeInteger(pos) || pos < 0) throw new Error(`era: bad index offset ${offset}`);
    return pos;
  });
  const firstTargetPos = slotOffsets.find((pos) => pos !== undefined);
  return {
    startSlot,
    lastSlot: startSlot + BigInt(count ? count - 1 : 0),
    slots: count,
    skipped: slotOffsets.filter((pos) => pos === undefined).length,
    firstTargetPos,
    slotOffsets,
  };
};
const signedBlockSlot = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const msg = view.getUint32(0, true);
  if (msg + 8 > bytes.length) throw new Error(`era: bad signed block message offset ${msg}`);
  return view.getBigUint64(msg, true);
};
const blocks = (
  es: EraEntry[],
  idx?: EraIndex,
  keep = false,
  cb?: (block: EraBlock) => void
): EraBlocks => {
  const out: EraBlocks = keep ? { count: 0, profiles: {}, values: [] } : { count: 0, profiles: {} };
  const byPos = new Map(es.map((ent) => [ent.pos, ent]));
  const seen = new Set<EraEntry>();
  const readBlock = (ent: EraEntry, expectedSlot?: bigint) => {
    const bytes = framedSnappy(ent.payload);
    const slot = signedBlockSlot(bytes);
    if (expectedSlot !== undefined && slot !== expectedSlot)
      throw new Error(`era: block slot ${slot} does not match index slot ${expectedSlot}`);
    const profile = forkAt(slot);
    const block = profile.profile.SignedBeaconBlock.decode(bytes);
    if (block.message.slot !== slot) throw new Error(`era: decoded block slot mismatch ${slot}`);
    seen.add(ent);
    out.count++;
    out.firstSlot = out.firstSlot === undefined || slot < out.firstSlot ? slot : out.firstSlot;
    out.lastSlot = out.lastSlot === undefined || slot > out.lastSlot ? slot : out.lastSlot;
    out.profiles[profile.name] = (out.profiles[profile.name] || 0) + 1;
    const value = { pos: ent.pos, bytes, slot, profile: profile.name, value: block };
    if (out.values) out.values.push(value);
    if (cb) cb(value);
  };
  if (idx) {
    for (let i = 0; i < idx.slotOffsets.length; i++) {
      const pos = idx.slotOffsets[i];
      if (pos === undefined) continue;
      const ent = byPos.get(pos);
      if (!ent || ent.tag !== 'block') throw new Error(`era: block index points to ${pos}`);
      readBlock(ent, idx.startSlot + BigInt(i));
    }
  } else {
    for (const ent of es) {
      if (ent.tag !== 'block') continue;
      readBlock(ent);
    }
  }
  for (const ent of es) {
    if (ent.tag === 'block' && !seen.has(ent))
      throw new Error(`era: unindexed block at ${ent.pos}`);
  }
  return out;
};
const state = (bytes: Uint8Array): EraState => {
  const head = STATE_HEAD.decode(bytes.subarray(0, STATE_HEAD.size));
  const fork = {
    previous: hx(head.fork.previous),
    current: hx(head.fork.current),
    epoch: head.fork.epoch,
  };
  const profile = forkAt(head.slot);
  return {
    bytes,
    slot: head.slot,
    epoch: head.slot / 32n,
    fork,
    profile: profile.name,
    value: profile.profile.BeaconState.decode(bytes),
  };
};
const scan = (file: string): EraScan => {
  const buf = readFileSync(file);
  // readFileSync returns Buffer; normalize once so decoded payloads inspect as plain Uint8Array.
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const es = entries(bytes);
  const counts: Record<string, number> = {};
  for (const ent of es) counts[ent.tag] = (counts[ent.tag] || 0) + 1;
  if (counts.block && (counts.index || 0) < 2)
    throw new Error('era: block records without block/state indexes');
  const stateEntry = es.find((ent) => ent.tag === 'state');
  const indexes = es.filter((ent) => ent.tag === 'index');
  // The genesis sample carries only a state record plus state index.
  // Later files have block records first.
  const blockIndex = counts.block ? indexes[0] : undefined;
  const stateIndex = counts.block ? indexes[1] : indexes[0];
  if (!stateEntry || !stateIndex) throw new Error('era: missing state or state index');
  const blockIdx = blockIndex ? index(blockIndex) : undefined;
  const stateIdx = index(stateIndex);
  if (stateIdx.slotOffsets[0] !== stateEntry.pos)
    throw new Error(`era: state index points to ${stateIdx.slotOffsets[0]}`);
  const version = es.find((ent) => ent.tag === 'version');
  if (!version || version.payload.length) throw new Error('era: bad version entry');
  return {
    file,
    entries: es,
    counts,
    version,
    stateEntry,
    blockIndex: blockIdx,
    stateIndex: stateIdx,
  };
};

export const parseEra = (file: string, keepBlocks = false): EraFile => {
  const era = scan(file);
  return {
    file: era.file,
    entries: era.entries,
    counts: era.counts,
    version: era.version,
    blockIndex: era.blockIndex,
    stateIndex: era.stateIndex,
    state: state(framedSnappy(era.stateEntry.payload)),
    blocks: blocks(era.entries, era.blockIndex, keepBlocks),
  };
};
export const eraSummary = (era: EraFile) => ({
  file: basename(era.file),
  counts: era.counts,
  blockIndex: era.blockIndex && {
    startSlot: era.blockIndex.startSlot.toString(),
    lastSlot: era.blockIndex.lastSlot.toString(),
    slots: era.blockIndex.slots,
    skipped: era.blockIndex.skipped,
    firstTargetPos: era.blockIndex.firstTargetPos,
  },
  stateIndex: era.stateIndex && {
    startSlot: era.stateIndex.startSlot.toString(),
    lastSlot: era.stateIndex.lastSlot.toString(),
    slots: era.stateIndex.slots,
    skipped: era.stateIndex.skipped,
    firstTargetPos: era.stateIndex.firstTargetPos,
  },
  blocks: {
    count: era.blocks.count,
    firstSlot: era.blocks.firstSlot?.toString(),
    lastSlot: era.blocks.lastSlot?.toString(),
    profiles: era.blocks.profiles,
  },
  state: era.state && {
    bytes: era.state.bytes.length,
    slot: era.state.slot.toString(),
    epoch: era.state.epoch.toString(),
    fork: {
      previous: era.state.fork.previous,
      current: era.state.fork.current,
      epoch: era.state.fork.epoch.toString(),
    },
    profile: era.state.profile,
    validators: era.state.value.validators.length,
    balances: era.state.value.balances.length,
    proposerLookahead: era.state.value.proposer_lookahead
      ? era.state.value.proposer_lookahead.length
      : undefined,
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const summary = args.includes('--summary');
  const files = args.filter((arg) => arg !== '--summary');
  for (const file of files) {
    if (summary) {
      console.log(JSON.stringify(eraSummary(parseEra(file))));
      continue;
    }
    const era = scan(file);
    console.log(
      inspect(
        {
          file: era.file,
          entries: era.entries,
          counts: era.counts,
          version: era.version,
          blockIndex: era.blockIndex,
          stateIndex: era.stateIndex,
        },
        { depth: null }
      )
    );
    console.log(inspect({ state: state(framedSnappy(era.stateEntry.payload)) }, { depth: null }));
    const res = blocks(era.entries, era.blockIndex, false, (block) =>
      console.log(inspect({ block }, { depth: null }))
    );
    console.log(inspect({ blocks: res }, { depth: null }));
  }
}
