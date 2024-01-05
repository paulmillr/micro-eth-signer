import * as abi from '../web3.js';
import { addHints } from './common.js';
import * as P from 'micro-packed';

// prettier-ignore
const ABI = [
  {type:"function",name:"getExpectedRate",inputs:[{name:"src",type:"address"},{name:"dest",type:"address"},{name:"srcQty",type:"uint256"}],outputs:[{name:"expectedRate",type:"uint256"},{name:"worstRate",type:"uint256"}]},{type:"function",name:"getExpectedRateAfterFee",inputs:[{name:"src",type:"address"},{name:"dest",type:"address"},{name:"srcQty",type:"uint256"},{name:"platformFeeBps",type:"uint256"},{name:"hint",type:"bytes"}],outputs:[{name:"expectedRate",type:"uint256"}]},{type:"function",name:"trade",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"platformWallet",type:"address"}],outputs:[{type:"uint256"}]},{type:"function",name:"tradeWithHint",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"walletId",type:"address"},{name:"hint",type:"bytes"}],outputs:[{type:"uint256"}]},{type:"function",name:"tradeWithHintAndFee",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"platformWallet",type:"address"},{name:"platformFeeBps",type:"uint256"},{name:"hint",type:"bytes"}],outputs:[{name:"destAmount",type:"uint256"}]}
] as const;

const hints = {
  tradeWithHintAndFee(v: any, opt: abi.HintOpt) {
    if (!opt.contracts) throw Error('Not enough info');
    const tokenInfo = (c: string) =>
      c === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        ? { symbol: 'ETH', decimals: 18 }
        : opt.contracts![c];
    const formatToken = (amount: bigint, info: any) =>
      `${P.coders.decimal(info.decimals).encode(amount)} ${info.symbol}`;
    const [srcInfo, destInfo] = [tokenInfo(v.src), tokenInfo(v.dest)];
    if (!srcInfo || !destInfo) throw Error('Not enough info');
    const destAmount =
      ((v.srcAmount as bigint) *
        (v.minConversionRate as bigint) *
        10n ** BigInt(destInfo.decimals!)) /
      10n ** (BigInt(srcInfo.decimals!) + 18n);
    const fee = formatToken((BigInt(v.platformFeeBps) * BigInt(v.srcAmount)) / 10000n, srcInfo);
    return `Swap ${formatToken(v.srcAmount, srcInfo)} For ${formatToken(
      destAmount,
      destInfo
    )} (with platform fee: ${fee})`;
  },
};

addHints(ABI, hints);

export default ABI;
