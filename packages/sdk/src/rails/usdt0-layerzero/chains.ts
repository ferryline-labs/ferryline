import type { ChainSlug } from "@ferryline/core";

/**
 * USDT0 on Stellar mainnet.
 * Sources (all checked 2026-09-11): developers.stellar.org/launch/usdt0, docs.usdt0.to deployments page,
 * LayerZero deployments metadata (eid). There is NO USDT0 deployment on Stellar testnet: not on
 * docs.usdt0.to, not in LayerZero's OFT list for stellar-testnet, and the only "USDT0" assets on
 * testnet Horizon are unrelated issuers. See packages/core/VERIFIED.md §2.
 */
export const USDT0_STELLAR_MAINNET = {
  eid: 30600,
  oft: "CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6",
  sac: "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF",
  assetCode: "USDT0",
  issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
  endpointV2: "CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
} as const;

export interface EvmUsdt0Chain {
  readonly chain: ChainSlug;
  readonly chainId: number;
  /** LayerZero V2 endpoint id. */
  readonly eid: number;
  /** The OFT (adapter) contract `send` / `quoteSend` are called on. */
  readonly oft: `0x${string}`;
  /** The ERC-20 actually debited. Equals the OFT on chains where USDT0 is itself the OFT. */
  readonly innerToken: `0x${string}`;
  /** Whether `innerToken.approve(oft, amount)` must precede `send`. */
  readonly approvalRequired: boolean;
  readonly localDecimals: 6;
}

/**
 * The USDT0 mesh that Stellar mainnet is peered with, as published by LayerZero's metadata API
 * (GET metadata.layerzero-api.com/v1/metadata/experiment/ofts/list?symbols=USDT0, the entry whose
 * polygon deployment is 0x6ba1…, which is the receiver LayerZero Scan reports for real Stellar sends).
 * Endpoint ids from GET metadata.layerzero-api.com/v1/metadata/deployments. Recorded 2026-09-11 at
 * packages/core/verified/experiments/evidence/usdt0-mesh.layerzero-metadata.json.
 */
export const USDT0_EVM_CHAINS: readonly EvmUsdt0Chain[] = [
  {
    chain: "arbitrum",
    chainId: 42161,
    eid: 30110,
    oft: "0x14e4a1b13bf7f943c8ff7c51fb60fa964a298d92",
    innerToken: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "bera",
    chainId: 80094,
    eid: 30362,
    oft: "0x3dc96399109df5ceb2c226664a086140bd0379cb",
    innerToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "ethereum",
    chainId: 1,
    eid: 30101,
    oft: "0x6c96de32cea08842dcc4058c14d3aaad7fa41dee",
    innerToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    approvalRequired: true,
    localDecimals: 6,
  },
  {
    chain: "flare",
    chainId: 14,
    eid: 30295,
    oft: "0x567287d2a9829215a37e3b88843d32f9221e7588",
    innerToken: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "hyperliquid",
    chainId: 999,
    eid: 30367,
    oft: "0x904861a24f30ec96ea7cfc3be9ea4b476d237e98",
    innerToken: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "ink",
    chainId: 57073,
    eid: 30339,
    oft: "0x1cb6de532588fca4a21b7209de7c456af8434a65",
    innerToken: "0x0200c29006150606b650577bbe7b6248f58470c1",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "mp1",
    chainId: 21000000,
    eid: 30331,
    oft: "0x3f82943338a8a76c35bfa0c1828aa27fd43a34e4",
    innerToken: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "optimism",
    chainId: 10,
    eid: 30111,
    oft: "0xf03b4d9ac1d5d1e7c4cef54c2a313b9fe051a0ad",
    innerToken: "0x01bff41798a0bcf287b996046ca68b395dbc1071",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "polygon",
    chainId: 137,
    eid: 30109,
    oft: "0x6ba10300f0dc58b7a1e4c0e41f5dabb7d7829e13",
    innerToken: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "rootstock",
    chainId: 30,
    eid: 30333,
    oft: "0x1a594d5d5d1c426281c1064b07f23f57b2716b61",
    innerToken: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "sei",
    chainId: 1329,
    eid: 30280,
    oft: "0x56fe74a2e3b484b921c447357203431a3485cc60",
    innerToken: "0x9151434b16b9763660705744891fa906f660ecc5",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "unichain",
    chainId: 130,
    eid: 30320,
    oft: "0xc07be8994d035631c36fb4a89c918cefb2f03ec3",
    innerToken: "0x9151434b16b9763660705744891fa906f660ecc5",
    approvalRequired: false,
    localDecimals: 6,
  },
  {
    chain: "xlayer",
    chainId: 196,
    eid: 30274,
    oft: "0x94bcca6bdfd6a61817ab0e960bfede4984505554",
    innerToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    approvalRequired: false,
    localDecimals: 6,
  },
];

export function evmUsdt0Chain(chain: ChainSlug): EvmUsdt0Chain | undefined {
  return USDT0_EVM_CHAINS.find((c) => c.chain === chain);
}
