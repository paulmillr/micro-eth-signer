import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, ok, rejects, throws } from 'node:assert';
import {
  cidV1,
  createNftViewer,
  dataText,
  DEFAULT_GATEWAY,
  idText,
  ipfsPath,
  mediaSource,
  normalizeGateway,
  parseTokenId,
  tokenMetadata,
} from '../nft/core.js';

/*
Unit tests for examples/nft/core.js: the IPFS-by-default media policy (which
URIs load, from where), metadata sanitizing, and the viewer's off-chain fetch
wrapper against a stubbed fetch — nothing here touches the network.
*/

const V0 = 'QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq'; // BAYC metadata root
// the same CID as 4everland's /ipfs/ redirect spells it in its subdomain form
const V1 = 'bafybeihpjhkeuiq3k6nqa3fkgeigeri7iebtrsuyuey5y6vy36n345xmbi';

describe('nft core: media policy', () => {
  should('recognize every IPFS form, by CID', () => {
    deepStrictEqual(ipfsPath(`ipfs://${V0}/1`), `${V0}/1`);
    deepStrictEqual(ipfsPath(`ipfs://ipfs/${V0}/1`), `${V0}/1`); // legacy
    deepStrictEqual(ipfsPath(`ipfs://${V1}`), V1);
    deepStrictEqual(ipfsPath(`ipfs://${V0}/My Ape Ñ.png`), `${V0}/My%20Ape%20%C3%91.png`);
    deepStrictEqual(ipfsPath(`ipfs://${V0}/1.json#frag`), `${V0}/1.json`); // '#' starts a fragment
    // path gateways: the host is irrelevant, the query is dropped
    deepStrictEqual(
      ipfsPath(`https://chocolate-delicate-urial-980.mypinata.cloud/ipfs/${V1}/77?filename=x`),
      `${V1}/77`
    );
    deepStrictEqual(ipfsPath(`https://${V1}.ipfs.dweb.link/6972.json`), `${V1}/6972.json`);
    deepStrictEqual(ipfsPath(`https://${V1}.ipfs.dweb.link/`), V1);
    // look-alikes are not IPFS: spam airdrops use /ipfs/<not a CID> on their own hosts
    deepStrictEqual(
      ipfsPath('http://api.bayc-nft.xyz/ipfs/0000000000000000000000000001'),
      undefined
    );
    deepStrictEqual(ipfsPath('ipfs://not-a-cid/1.json'), undefined);
    deepStrictEqual(ipfsPath(`https://example.com/${V0}`), undefined);
    deepStrictEqual(ipfsPath(`ftp://x/ipfs/${V0}`), undefined);
    deepStrictEqual(ipfsPath(undefined), undefined);
  });

  should('rewrite IPFS onto the gateway; block other hosts unless allowed', () => {
    deepStrictEqual(mediaSource(`ipfs://${V0}/1`), {
      kind: 'ipfs',
      url: `${DEFAULT_GATEWAY}${V0}/1`,
    });
    deepStrictEqual(
      mediaSource(`https://gateway.pinata.cloud/ipfs/${V0}/1`, {
        gateway: 'https://gw.test/ipfs/',
      }),
      {
        kind: 'ipfs',
        url: `https://gw.test/ipfs/${V0}/1`,
      }
    );
    deepStrictEqual(mediaSource('https://api.poap.tech/metadata/1/2'), {
      kind: 'blocked',
      host: 'api.poap.tech',
    });
    deepStrictEqual(mediaSource('https://api.poap.tech/metadata/1/2', { allowHttp: true }), {
      kind: 'http',
      url: 'https://api.poap.tech/metadata/1/2',
      host: 'api.poap.tech',
    });
    deepStrictEqual(mediaSource('data:application/json,{}').kind, 'data');
    for (const uri of ['javascript:alert(1)', 'ar://abc', 'file:///etc/passwd', 'not a url', ''])
      deepStrictEqual(mediaSource(uri, { allowHttp: true }).kind, 'unsupported', uri);
  });

  should('normalize gateways', () => {
    deepStrictEqual(normalizeGateway(''), DEFAULT_GATEWAY);
    deepStrictEqual(normalizeGateway('ipfs.io'), 'https://ipfs.io/ipfs/');
    deepStrictEqual(normalizeGateway('https://dweb.link/ipfs'), 'https://dweb.link/ipfs/');
    deepStrictEqual(normalizeGateway('https://dweb.link///'), 'https://dweb.link/ipfs/');
    deepStrictEqual(normalizeGateway('127.0.0.1:8080'), 'http://127.0.0.1:8080/ipfs/');
    deepStrictEqual(normalizeGateway('localhost:8080/'), 'http://localhost:8080/ipfs/');
    throws(() => normalizeGateway('ftp://ipfs.io'), /Invalid IPFS gateway/);
  });

  should('convert CIDv0 to the base32 CIDv1 subdomain gateways need', () => {
    deepStrictEqual(cidV1(V0), V1);
    deepStrictEqual(cidV1(V1), V1);
  });
});

describe('nft core: metadata', () => {
  should('decode data: URIs', () => {
    const json = JSON.stringify({ name: 'Nöun ★' });
    deepStrictEqual(
      dataText(`data:application/json;base64,${Buffer.from(json).toString('base64')}`),
      json
    );
    deepStrictEqual(dataText(`data:application/json,${encodeURIComponent(json)}`), json);
    // unescaped JSON with a literal '%' (common on-chain) passes through raw
    deepStrictEqual(
      dataText('data:application/json;utf8,{"name":"100% on-chain"}'),
      '{"name":"100% on-chain"}'
    );
    throws(() => dataText('data:no-comma'), /malformed/);
  });

  should('keep display fields, inline art and attributes; drop active content', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    deepStrictEqual(
      tokenMetadata({
        name: 'Noun 1',
        description: 'x'.repeat(20_000),
        image: svg,
        external_url: 'javascript:alert(1)',
        animation_url: `ipfs://${V0}/a.mp4`,
        attributes: [
          { trait_type: 'Head', value: 'Crab' },
          { trait_type: 'Level', value: 7 },
          { value: true },
          { trait_type: 'Nested', value: { evil: 1 } },
          'junk',
          null,
        ],
      }),
      {
        name: 'Noun 1',
        description: 'x'.repeat(10_000),
        image: svg,
        animationUrl: `ipfs://${V0}/a.mp4`,
        attributes: [
          { trait: 'Head', value: 'Crab' },
          { trait: 'Level', value: '7' },
          { trait: '', value: 'true' },
        ],
      }
    );
    // inline HTML/script "images" never reach an <img>
    deepStrictEqual(tokenMetadata({ image: 'data:text/html,<script>1</script>' }), {});
    deepStrictEqual(tokenMetadata({ image_url: `https://x.test/1.png` }), {
      image: 'https://x.test/1.png',
    });
    deepStrictEqual(tokenMetadata(null), {});
    deepStrictEqual(tokenMetadata({ attributes: 'nope' }), {});
  });

  should('parse and shorten token ids', () => {
    deepStrictEqual(parseTokenId('42'), 42n);
    deepStrictEqual(parseTokenId('0x10'), 16n);
    deepStrictEqual(parseTokenId(` ${2n ** 256n - 1n} `), 2n ** 256n - 1n);
    for (const bad of ['-1', '1.5', 'abc', '', String(2n ** 256n), undefined])
      throws(() => parseTokenId(bad), /Invalid token id/, String(bad));
    deepStrictEqual(idText(6972n), '6972');
    deepStrictEqual(idText(2n ** 255n), '0x80000000…0000');
  });
});

// ---- the viewer's off-chain fetches, against a stubbed fetch ---------------

const RPC = 'http://rpc.test/';
const NFT = '0x2f1D6BbA8D2ce2F1B6aeD78f797096A6cC9E9FC9';
// ABI-encoded `string` return value
const abiString = (s: string) => {
  const hex = Buffer.from(s).toString('hex');
  const words = (n: number | bigint) => n.toString(16).padStart(64, '0');
  return `0x${words(32)}${words(hex.length / 2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;
};
type Handler = (url: string) => Response | Record<string, unknown> | Promise<Response>;
// Installs a fetch that answers tokenURI(id) eth_calls from `uris` and every
// other URL from `handler`; records each requested URL.
function stubNetwork(uris: Record<string, string>, handler: Handler) {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    if (url === RPC) {
      const body = JSON.parse(init.body);
      const answer = (call: any) => {
        const data: string = call.params[0].data;
        if (call.method !== 'eth_call' || !data.startsWith('0xc87b56dd'))
          return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'unexpected' } };
        const id = BigInt(`0x${data.slice(10)}`).toString();
        return { jsonrpc: '2.0', id: call.id, result: abiString(uris[id]) };
      };
      const res = Array.isArray(body) ? body.map(answer) : answer(body);
      return new Response(JSON.stringify(res), { headers: { 'content-type': 'application/json' } });
    }
    requested.push(url);
    return handler(url);
  }) as typeof fetch;
  return { requested, restore: () => void (globalThis.fetch = original) };
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('nft core: viewer fetches', () => {
  should('load IPFS through the gateway, inline data:, and never touch blocked hosts', async () => {
    const net = stubNetwork(
      {
        1: `ipfs://${V0}/1`,
        2: 'https://api.spam.test/meta/2',
        3: `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'On-chain 3' }))}`,
      },
      (url) => {
        if (url === `https://gw.test/ipfs/${V0}/1`)
          return json({ name: 'Ape 1', image: `ipfs://${V0}/1.png` });
        if (url === 'https://api.spam.test/meta/2')
          return json({ name: 'Free money', image: 'https://api.spam.test/px.png' });
        return new Response('nope', { status: 404 });
      }
    );
    try {
      const viewer = createNftViewer(RPC, { gateway: 'gw.test' });
      const ape = await viewer.metadata(NFT, 'ERC721', 1n);
      deepStrictEqual(ape.metadata.name, 'Ape 1');
      deepStrictEqual(ape.imageSource, { kind: 'ipfs', url: `https://gw.test/ipfs/${V0}/1.png` });
      const spam = await viewer.metadata(NFT, 'ERC721', 2n);
      deepStrictEqual(spam.error, 'metadata: non-IPFS host api.spam.test — not loaded');
      deepStrictEqual(spam.uriSource, { kind: 'blocked', host: 'api.spam.test' });
      const onChain = await viewer.metadata(NFT, 'ERC721', 3n);
      deepStrictEqual(onChain.metadata.name, 'On-chain 3');
      deepStrictEqual(net.requested, [`https://gw.test/ipfs/${V0}/1`]);
      // opting in loads the creator's host too
      viewer.setPolicy({ allowHttp: true });
      deepStrictEqual((await viewer.metadata(NFT, 'ERC721', 2n)).metadata.name, 'Free money');
      deepStrictEqual(net.requested.at(-1), 'https://api.spam.test/meta/2');
    } finally {
      net.restore();
    }
  });

  should('check every redirect hop: gateway subdomain yes, elsewhere no', async () => {
    const net = stubNetwork({ 1: `ipfs://${V0}/1`, 2: `ipfs://${V1}/2` }, (url) => {
      if (url === `https://gw.test/ipfs/${V0}/1`)
        return new Response(null, {
          status: 301,
          headers: { location: `https://${V1}.ipfs.gw.test/1` },
        });
      if (url === `https://${V1}.ipfs.gw.test/1`) return json({ name: 'via subdomain' });
      if (url === `https://gw.test/ipfs/${V1}/2`)
        return new Response(null, { status: 302, headers: { location: 'https://tracker.test/2' } });
      return json({ name: 'should never be fetched' });
    });
    try {
      const viewer = createNftViewer(RPC, { gateway: 'gw.test' });
      deepStrictEqual((await viewer.metadata(NFT, 'ERC721', 1n)).metadata.name, 'via subdomain');
      const bounced = await viewer.metadata(NFT, 'ERC721', 2n);
      ok(bounced.error, 'redirect off the gateway fails');
      ok(!net.requested.includes('https://tracker.test/2'), 'tracker never contacted');
    } finally {
      net.restore();
    }
  });

  should("fall back to the gateway's subdomain form on browser-hidden redirects", async () => {
    // what a browser hands micro-ftch for redirect: 'manual'
    const opaque = () => ({
      type: 'opaqueredirect',
      status: 0,
      ok: false,
      statusText: '',
      redirected: false,
      url: '',
      headers: new Headers(),
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const net = stubNetwork({ 1: `ipfs://${V0}/1.json`, 2: `ipfs://${V0}/2.json` }, (url) => {
      if (url.startsWith('https://gw.test/ipfs/')) return opaque();
      if (url === `https://${V1}.ipfs.gw.test/1.json`) return json({ name: 'one' });
      if (url === `https://${V1}.ipfs.gw.test/2.json`) return json({ name: 'two' });
      return new Response('nope', { status: 404 });
    });
    try {
      const viewer = createNftViewer(RPC, { gateway: 'gw.test' });
      deepStrictEqual((await viewer.metadata(NFT, 'ERC721', 1n)).metadata.name, 'one');
      // remembered: the second token goes straight to the subdomain form
      deepStrictEqual((await viewer.metadata(NFT, 'ERC721', 2n)).metadata.name, 'two');
      deepStrictEqual(net.requested, [
        `https://gw.test/ipfs/${V0}/1.json`,
        `https://${V1}.ipfs.gw.test/1.json`,
        `https://${V1}.ipfs.gw.test/2.json`,
      ]);
    } finally {
      net.restore();
    }
  });

  should('pause a rate-limited gateway until Retry-After', async () => {
    const net = stubNetwork(
      { 1: `ipfs://${V0}/1`, 2: `ipfs://${V0}/2` },
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } })
    );
    try {
      const viewer = createNftViewer(RPC, { gateway: 'gw.test' });
      const first = await viewer.metadata(NFT, 'ERC721', 1n);
      deepStrictEqual(first.error, 'gw.test rate-limited, retrying in 120s');
      ok(first.retryAt > Date.now() + 100_000);
      const second = await viewer.metadata(NFT, 'ERC721', 2n);
      ok(/rate-limited/.test(second.error));
      deepStrictEqual(net.requested.length, 1, 'no request while paused');
    } finally {
      net.restore();
    }
  });

  should('only turn image responses into blob: URLs', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const net = stubNetwork({}, (url) =>
      url.endsWith('/art.png')
        ? new Response(png, { headers: { 'content-type': 'image/png' } })
        : new Response('<html>gateway error</html>', { headers: { 'content-type': 'text/html' } })
    );
    try {
      const viewer = createNftViewer(RPC, { gateway: 'gw.test' });
      const url = await viewer.image(mediaSource(`ipfs://${V0}/art.png`, viewer.policy));
      ok(url.startsWith('blob:'));
      deepStrictEqual(new Uint8Array(await (await fetchBlob(url)).arrayBuffer()), png);
      await rejects(
        viewer.image(mediaSource(`ipfs://${V0}/page`, viewer.policy)),
        /unexpected text\/html/
      );
      await rejects(viewer.image({ kind: 'blocked', host: 'x.test' }), /not loaded/);
      deepStrictEqual(
        await viewer.image({ kind: 'data', url: 'data:image/png;base64,iVBO' }),
        'data:image/png;base64,iVBO'
      );
    } finally {
      net.restore();
    }
  });
});

// blob: URLs resolve through the Blob registry, not the network
async function fetchBlob(url: string) {
  const { resolveObjectURL } = await import('node:buffer');
  return resolveObjectURL(url)!;
}

should.runWhen(import.meta.url);
