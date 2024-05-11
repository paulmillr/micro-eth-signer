import { Web3Provider, Web3CallArgs, hexToNumber } from '../utils.js';

export type FetchFn = (
  url: string,
  opt?: Record<string, any>
) => Promise<{ json: () => Promise<any> }>;
type Headers = Record<string, string>;
type NetworkOpts = {
  concurrencyLimit?: number;
  headers?: Headers;
};
type PromiseCb<T> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

export default class FetchProvider implements Web3Provider {
  private concurrencyLimit: number;
  private currentlyFetching: number;
  private headers: Headers;
  constructor(
    private fetchFunction: FetchFn,
    readonly rpcUrl: string,
    options: NetworkOpts = {}
  ) {
    this.concurrencyLimit = options.concurrencyLimit == null ? 0 : options.concurrencyLimit;
    this.currentlyFetching = 0;
    this.headers = options.headers || {};
    if (typeof this.headers !== 'object') throw new Error('invalid headers: expected object');
  }
  private async fetchJson(body: unknown) {
    const url = this.rpcUrl;
    const args = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify(body),
    };
    const res = await this.fetchFunction(url, args);
    return res.json();
  }
  private addToFetchQueue(body: unknown): Promise<any> {
    if (this.concurrencyLimit === 0) return this.fetchJson(body);
    const queue: ({ body: unknown } & PromiseCb<any>)[] = [];
    const process = () => {
      if (this.currentlyFetching >= this.concurrencyLimit) return;
      const next = queue.shift();
      if (!next) return;
      try {
        this.fetchJson(next.body)
          .then(next.resolve)
          .catch(next.reject)
          .finally(() => {
            this.currentlyFetching--;
            process();
          });
      } catch (e) {
        next.reject(e);
        this.currentlyFetching--;
      }
      this.currentlyFetching++;
    };
    return new Promise((resolve, reject) => {
      queue.push({ body, resolve, reject });
      process();
    });
  }
  private async rpc(method: string, ...params: any[]): Promise<string> {
    const body = {
      jsonrpc: '2.0',
      id: 0,
      method,
      params,
    };
    const json = await this.addToFetchQueue(body);
    if (json && json.error)
      throw new Error(`FetchProvider(${json.error.code}): ${json.error.message || json.error}`);
    return json.result;
  }

  ethCall(args: Web3CallArgs, tag = 'latest') {
    return this.rpc('eth_call', args, tag);
  }
  async estimateGas(args: Web3CallArgs, tag = 'latest') {
    return hexToNumber(await this.rpc('eth_estimateGas', args, tag));
  }
  call(method: string, ...args: any[]) {
    return this.rpc(method, ...args);
  }
}
