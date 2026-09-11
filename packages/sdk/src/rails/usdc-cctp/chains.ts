import type { ChainSlug } from "@ferryline/core";

/**
 * CCTP on Stellar. Contract addresses from developers.circle.com/cctp/references/stellar-contracts,
 * USDC issuers from Circle's USDC address page, SAC ids derived with `stellar contract id asset`
 * (all checked 2026-09-11; see packages/core/VERIFIED.md §1.6 and §3b).
 */
export const CCTP_STELLAR = {
  mainnet: {
    domain: 27,
    tokenMessengerMinter: "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL",
    messageTransmitter: "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
    cctpForwarder: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    usdcSac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    irisBaseUrl: "https://iris-api.circle.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
  testnet: {
    domain: 27,
    tokenMessengerMinter: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
    messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
    cctpForwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    usdcSac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    irisBaseUrl: "https://iris-api-sandbox.circle.com",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
} as const;

export type CctpNetwork = keyof typeof CCTP_STELLAR;

export interface CctpEvmChain {
  readonly chain: ChainSlug;
  readonly network: CctpNetwork;
  readonly chainId: number;
  readonly domain: number;
  readonly tokenMessengerV2: `0x${string}`;
  readonly messageTransmitterV2: `0x${string}`;
  readonly usdc: `0x${string}`;
  readonly decimals: 6;
}

/**
 * CCTP V2 EVM deployments Ferryline serves. TokenMessengerV2 and MessageTransmitterV2 share one
 * address across these chains per developers.circle.com/cctp/references/contract-addresses; USDC
 * addresses from developers.circle.com/stablecoins/usdc-contract-addresses (both checked 2026-09-11).
 * Function selectors for these contracts were verified against the proxy implementation bytecode
 * on Base mainnet (see VERIFIED.md §3c).
 */
const MAINNET_TMM = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;
const MAINNET_MT = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;
const TESTNET_TMM = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
const TESTNET_MT = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

export const CCTP_EVM_CHAINS: readonly CctpEvmChain[] = [
  {
    chain: "ethereum",
    network: "mainnet",
    chainId: 1,
    domain: 0,
    tokenMessengerV2: MAINNET_TMM,
    messageTransmitterV2: MAINNET_MT,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  {
    chain: "arbitrum",
    network: "mainnet",
    chainId: 42161,
    domain: 3,
    tokenMessengerV2: MAINNET_TMM,
    messageTransmitterV2: MAINNET_MT,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
  },
  {
    chain: "base",
    network: "mainnet",
    chainId: 8453,
    domain: 6,
    tokenMessengerV2: MAINNET_TMM,
    messageTransmitterV2: MAINNET_MT,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  {
    chain: "polygon",
    network: "mainnet",
    chainId: 137,
    domain: 7,
    tokenMessengerV2: MAINNET_TMM,
    messageTransmitterV2: MAINNET_MT,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  {
    chain: "ethereum-sepolia",
    network: "testnet",
    chainId: 11155111,
    domain: 0,
    tokenMessengerV2: TESTNET_TMM,
    messageTransmitterV2: TESTNET_MT,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
  },
  {
    chain: "arbitrum-sepolia",
    network: "testnet",
    chainId: 421614,
    domain: 3,
    tokenMessengerV2: TESTNET_TMM,
    messageTransmitterV2: TESTNET_MT,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    decimals: 6,
  },
  {
    chain: "base-sepolia",
    network: "testnet",
    chainId: 84532,
    domain: 6,
    tokenMessengerV2: TESTNET_TMM,
    messageTransmitterV2: TESTNET_MT,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
  },
  {
    chain: "polygon-amoy",
    network: "testnet",
    chainId: 80002,
    domain: 7,
    tokenMessengerV2: TESTNET_TMM,
    messageTransmitterV2: TESTNET_MT,
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    decimals: 6,
  },
];

export function cctpEvmChain(network: CctpNetwork, chain: ChainSlug): CctpEvmChain | undefined {
  return CCTP_EVM_CHAINS.find((c) => c.network === network && c.chain === chain);
}

/** Circle's finality thresholds: 1000 = Fast Transfer, 2000 = Standard Transfer. */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;
