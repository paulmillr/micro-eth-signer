import { writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonrpc } from 'micro-ftch';
import { Quoter, RpcClient } from '../../src/net.ts';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixture = join(root, 'test', 'fixtures', 'rpc', 'quoter-readme.json');
const NODE_URL = 'https://NODE_URL/';
const MAX_CALLS = 10;
const SPACING_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) throw new Error('missing Alchemy API key in ALCHEMY_API_KEY env var');
const liveUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

const replay: Record<string, string> = {};
let calls = 0;
let queue = Promise.resolve();

const recordingFetch = async (url: string, opt: RequestInit): Promise<Response> => {
  const request = async () => {
    calls += 1;
    if (calls > MAX_CALLS) throw new Error(`refusing to exceed ${MAX_CALLS} RPC calls`);
    if (calls > 1) await sleep(SPACING_MS);
    const key = JSON.stringify({ url: NODE_URL, opt });
    const response = await fetch(url, opt);
    const body = await response.text();
    replay[key] = body;
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
  const next = queue.then(request, request);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return await next;
};

const prov = new RpcClient(jsonrpc(recordingFetch as typeof fetch, liveUrl));
const quoter = new Quoter(prov);
const btc = await quoter.coinPrice('BTC');
const bat = await quoter.tokenPrice('BAT');
const ethV2 = await quoter.coinPrice('ETH', 'uniswap-v2', {
  pairAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
});
const ethV3 = await quoter.coinPrice('ETH', 'uniswap-v3', {
  poolAddress: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
});

writeFileSync(fixture, `${JSON.stringify(replay, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      calls,
      fixture: relative(root, fixture),
      prices: { btc, bat, ethV2, ethV3 },
    },
    null,
    2
  )
);
