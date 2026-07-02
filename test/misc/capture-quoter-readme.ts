import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonrpc } from 'micro-ftch';
import { tokenFromSymbol } from '../../src/advanced/abi.ts';
import { ChainlinkQuoter, UniswapV2Quoter, UniswapV3Quoter, Web3Provider } from '../../src/net.ts';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixture = join(root, 'test', 'fixtures', 'rpc', 'quoter-readme.json');
const NODE_URL = 'https://NODE_URL/';
const MAX_CALLS = 10;
const SPACING_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const apiKey =
  process.env.ALCHEMY_API_KEY || readFileSync(join(root, 'etc', 'API_KEY.txt'), 'utf8').trim();
if (!apiKey) throw new Error('missing Alchemy API key');
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

const prov = new Web3Provider(jsonrpc(recordingFetch as typeof fetch, liveUrl));
const WETH = tokenFromSymbol('WETH')!.contract;
const USDC = tokenFromSymbol('USDC')!.contract;

const chainlink = new ChainlinkQuoter(prov);
const btc = await chainlink.coinPrice('BTC');
const bat = await chainlink.tokenPrice('BAT');
const v2 = await UniswapV2Quoter.fromTokens(prov, WETH, USDC);
const v3 = await UniswapV3Quoter.fromTokens(prov, WETH, USDC, 3000);
const ethV2 = await v2.coinPrice('ETH');
const ethV3 = await v3.coinPrice('ETH');

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
