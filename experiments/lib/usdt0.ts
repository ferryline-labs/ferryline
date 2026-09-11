/** USDT0 on Stellar mainnet (developers.stellar.org/launch/usdt0, docs.usdt0.to deployments, 2026-09-11). */
export const USDT0_MAINNET = {
  eid: 30600,
  oft: "CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6",
  sac: "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF",
  assetCode: "USDT0",
  issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
} as const;

export const LAYERZERO_SCAN = "https://scan.layerzero-api.com";
export const LAYERZERO_OFT_LIST =
  "https://metadata.layerzero-api.com/v1/metadata/experiment/ofts/list";
export const LAYERZERO_DEPLOYMENTS = "https://metadata.layerzero-api.com/v1/metadata/deployments";

export interface OftDeployment {
  address: string;
  type: string;
  approvalRequired?: boolean;
  innerTokenAddress?: string;
  localDecimals?: number;
}

/** Whether USDT0 is deployed on the given LayerZero chain key, per LayerZero's public OFT list. */
export async function usdt0DeploymentOn(chainKey: string): Promise<OftDeployment | undefined> {
  const response = await fetch(
    `${LAYERZERO_OFT_LIST}?symbols=USDT0&chainNames=${encodeURIComponent(chainKey)}`,
  );
  const body = (await response.json()) as {
    USDT0?: { deployments: Record<string, OftDeployment> }[];
  };
  for (const entry of body.USDT0 ?? []) {
    const found = entry.deployments[chainKey];
    if (found) {
      return found;
    }
  }
  return undefined;
}

export async function stellarTestnetHasUsdt0(): Promise<{
  layerZeroList: boolean;
  horizonIssuers: string[];
}> {
  const list = await usdt0DeploymentOn("stellar-testnet");
  const horizon = (await (
    await fetch("https://horizon-testnet.stellar.org/assets?asset_code=USDT0&limit=50")
  ).json()) as {
    _embedded: { records: { asset_issuer: string }[] };
  };
  return {
    layerZeroList: list !== undefined,
    horizonIssuers: horizon._embedded.records.map((r) => r.asset_issuer),
  };
}
