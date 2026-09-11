// Generated 2026-09-11 with stellar-cli 26.1.0 against Stellar mainnet (https://mainnet.sorobanrpc.com):
//   stellar contract info interface --id CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T \
//     --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"
// Do not edit. Re-generate and diff when Circle or LayerZero announce a contract upgrade.

#[soroban_sdk::contractargs(name = "Args")]
#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn pause(env: soroban_sdk::Env);
    fn paused(env: soroban_sdk::Env) -> bool;
    fn unpause(env: soroban_sdk::Env);
    fn upgrade(
        env: soroban_sdk::Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        operator: soroban_sdk::Address,
    );
    fn get_admin(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn get_owner(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn get_pauser(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn get_rescuer(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn accept_admin(env: soroban_sdk::Env);
    fn rescue_sep41(
        env: soroban_sdk::Env,
        token_contract: soroban_sdk::Address,
        to: soroban_sdk::Address,
        amount: i128,
    );
    fn __constructor(env: soroban_sdk::Env, params: CctpForwarderContractInitParams);
    fn update_pauser(env: soroban_sdk::Env, new_pauser: soroban_sdk::Address);
    fn transfer_admin(
        env: soroban_sdk::Env,
        new_admin: soroban_sdk::Address,
        expires_in_ledgers: u32,
    );
    fn update_rescuer(env: soroban_sdk::Env, new_rescuer: soroban_sdk::Address);
    fn accept_ownership(env: soroban_sdk::Env);
    fn mint_and_forward(
        env: soroban_sdk::Env,
        message: soroban_sdk::Bytes,
        attestation: soroban_sdk::Bytes,
    );
    fn get_pending_admin(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn get_pending_owner(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn transfer_ownership(
        env: soroban_sdk::Env,
        new_owner: soroban_sdk::Address,
        expires_in_ledgers: u32,
    );
    fn get_message_transmitter(env: soroban_sdk::Env) -> soroban_sdk::Address;
    fn get_token_messenger_minter(env: soroban_sdk::Env) -> soroban_sdk::Address;
    fn get_expected_message_version(env: soroban_sdk::Env) -> u32;
    fn get_expected_burn_msg_version(env: soroban_sdk::Env) -> u32;
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct CctpForwarderContractInitParams {
    pub admin: soroban_sdk::Address,
    pub expected_burn_message_version: u32,
    pub expected_message_version: u32,
    pub message_transmitter: soroban_sdk::Address,
    pub owner: soroban_sdk::Address,
    pub pauser: soroban_sdk::Address,
    pub rescuer: soroban_sdk::Address,
    pub token_messenger_minter: soroban_sdk::Address,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SwapMinterConfig {
    pub allow_asset: soroban_sdk::Address,
    pub swap_minter: soroban_sdk::Address,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TokenDecimalConfig {
    pub canonical_decimals: u32,
    pub local_decimals: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleKey {
    pub role: soroban_sdk::Symbol,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleAccountKey {
    pub index: u32,
    pub role: soroban_sdk::Symbol,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum CctpForwarderStorageKey {
    MessageTransmitter,
    TokenMessengerMinter,
    ExpectedMessageVersion,
    ExpectedBurnMessageVersion,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum AttestableStorageKey {
    SignatureThreshold,
    EnabledAttesters,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum TokenControllerStorageKey {
    BurnLimit(soroban_sdk::Address),
    RemoteTokenToLocal((u32, soroban_sdk::BytesN<32>)),
    TokenDecimalConfig(soroban_sdk::Address),
    SwapMinterConfig(soroban_sdk::Address),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MinFeeControllerStorageKey {
    MinFeeByBurnToken(soroban_sdk::Address),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RemoteTokenMessengerStorageKey {
    RemoteTokenMessenger(u32),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum ManageableStorageKey {
    PendingAdmin,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MerkleDistributorStorageKey {
    Root,
    Claimed(u32),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Rounding {
    Floor,
    Ceil,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum PausableStorageKey {
    Paused,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum AccessControlStorageKey {
    RoleAccounts(RoleAccountKey),
    HasRole(soroban_sdk::Address, soroban_sdk::Symbol),
    RoleAccountsCount(soroban_sdk::Symbol),
    RoleAdmin(soroban_sdk::Symbol),
    Admin,
    PendingAdmin,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OwnableStorageKey {
    Owner,
    PendingOwner,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum CctpForwarderError {
    HookDataTooShort = 7300,
    InvalidMintRecipient = 7301,
    InvalidRecipient = 7302,
    InvalidMessageFormat = 7303,
    UnsupportedMessageVersion = 7304,
    InvalidBurnMessageFormat = 7305,
    UnsupportedBurnMessageVersion = 7306,
    InvalidForwardRecipient = 7307,
    MessageTransmitterNotSet = 7308,
    TokenMessengerMinterNotSet = 7309,
    ExpectedMessageVersionNotSet = 7310,
    ExpectedBurnMessageVersionNotSet = 7311,
    LocalTokenNotResolved = 7312,
    InvalidHookVersion = 7313,
    NoTokensMinted = 7314,
    MessageTransmitterAlreadySet = 7315,
    TokenMessengerMinterAlreadySet = 7316,
    ExpectedMessageVersionAlreadySet = 7317,
    ExpectedBurnMessageVersionAlreadySet = 7318,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum AttestationError {
    InvalidAttestationLength = 6000,
    InvalidSignatureOrder = 6001,
    SignerNotAttester = 6002,
    SignatureRecoveryFailed = 6003,
    InvalidSignatureThreshold = 6004,
    AttesterAlreadyEnabled = 6005,
    AttesterAlreadyDisabled = 6006,
    AttesterIndexOutOfBounds = 6007,
    InvalidAttesterAddress = 6008,
    TooFewEnabledAttesters = 6009,
    SignatureThresholdTooHigh = 6010,
    SignatureThresholdAlreadySet = 6011,
    SignatureThresholdNotSet = 6012,
    InvalidRecoveryId = 6013,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum DenylistError {
    AccountDenylisted = 6100,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum TokenControllerError {
    TokenPairAlreadyLinked = 6300,
    TokenPairNotLinked = 6301,
    TokenDecimalConfigNotSet = 6302,
    BurnTokenNotSupported = 6303,
    BurnAmountExceedsLimit = 6304,
    SwapMinterConfigNotSet = 6305,
    InvalidBurnLimit = 6306,
    InvalidDecimalScale = 6307,
    TokenDecimalConfigAlreadySet = 6308,
    InvalidLocalToken = 6309,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MinFeeControllerError {
    MinFeeControllerNotSet = 6200,
    MinFeeTooHigh = 6201,
    AmountTooLow = 6202,
    MinFeeComputationOverflow = 6203,
    MinFeeNegative = 6204,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RemoteTokenMessengerError {
    TokenMessengerAlreadySet = 6400,
    NoTokenMessengerSet = 6401,
    ZeroAddress = 6402,
    RemoteTokenMessengerNotRegistered = 6403,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum ManageableError {
    AdminNotSet = 7200,
    AdminAlreadySet = 7201,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RoleError {
    RoleNotSet = 7000,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum UpgradeableError {
    MigrationNotAllowed = 1100,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MerkleDistributorError {
    RootNotSet = 1300,
    IndexAlreadyClaimed = 1301,
    InvalidProof = 1302,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SorobanFixedPointError {
    ZeroDenominator = 1500,
    PhantomOverflow = 1501,
    ResultOverflow = 1502,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum CryptoError {
    MerkleProofOutOfBounds = 1400,
    MerkleIndexOutOfBounds = 1401,
    HasherEmptyState = 1402,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum PausableError {
    EnforcedPause = 1000,
    ExpectedPause = 1001,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RoleError {
    RoleNotSet = 7000,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RoleTransferError {
    NoPendingTransfer = 2200,
    InvalidLiveUntilLedger = 2201,
    InvalidPendingAccount = 2202,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum AccessControlError {
    Unauthorized = 2000,
    AdminNotSet = 2001,
    IndexOutOfBounds = 2002,
    AdminRoleNotFound = 2003,
    RoleCountIsNotZero = 2004,
    RoleNotFound = 2005,
    AdminAlreadySet = 2006,
    RoleNotHeld = 2007,
    RoleIsEmpty = 2008,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OwnableError {
    OwnerNotSet = 2100,
    TransferInProgress = 2101,
    OwnerAlreadySet = 2102,
}
#[soroban_sdk::contractevent(export = false, topics = ["mint_and_forward"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MintAndForward {
    pub forward_recipient: soroban_sdk::MuxedAddress,
    pub token: soroban_sdk::Address,
    pub amount: i128,
}
#[soroban_sdk::contractevent(export = false, topics = ["attester_enabled"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AttesterEnabled {
    #[topic]
    pub attester: soroban_sdk::BytesN<20>,
}
#[soroban_sdk::contractevent(export = false, topics = ["attester_disabled"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AttesterDisabled {
    #[topic]
    pub attester: soroban_sdk::BytesN<20>,
}
#[soroban_sdk::contractevent(export = false, topics = ["attester_manager_updated"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AttesterManagerUpdated {
    #[topic]
    pub previous_attester_manager: Option<soroban_sdk::Address>,
    #[topic]
    pub new_attester_manager: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["signature_threshold_updated"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignatureThresholdUpdated {
    pub old_signature_threshold: u32,
    pub new_signature_threshold: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["denylisted"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Denylisted {
    #[topic]
    pub account: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["un_denylisted"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct UnDenylisted {
    #[topic]
    pub account: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["denylister_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DenylisterChanged {
    #[topic]
    pub old_denylister: Option<soroban_sdk::Address>,
    #[topic]
    pub new_denylister: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["fee_recipient_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeeRecipientSet {
    pub fee_recipient: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["token_pair_linked"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TokenPairLinked {
    pub local_token: soroban_sdk::Address,
    pub remote_domain: u32,
    pub remote_token: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["token_pair_unlinked"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TokenPairUnlinked {
    pub local_token: soroban_sdk::Address,
    pub remote_domain: u32,
    pub remote_token: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["set_token_controller"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SetTokenController {
    pub token_controller: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["swap_minter_config_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SwapMinterConfigSet {
    #[topic]
    pub local_token: soroban_sdk::Address,
    pub swap_minter_config: SwapMinterConfig,
}
#[soroban_sdk::contractevent(export = false, topics = ["set_burn_limit_per_message"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SetBurnLimitPerMessage {
    #[topic]
    pub local_token: soroban_sdk::Address,
    pub burn_limit_per_message: i128,
}
#[soroban_sdk::contractevent(export = false, topics = ["swap_minter_config_removed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SwapMinterConfigRemoved {
    #[topic]
    pub local_token: soroban_sdk::Address,
    pub swap_minter_config: SwapMinterConfig,
}
#[soroban_sdk::contractevent(export = false, topics = ["token_decimal_config_added"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TokenDecimalConfigAdded {
    #[topic]
    pub local_token: soroban_sdk::Address,
    pub token_decimal_config: TokenDecimalConfig,
}
#[soroban_sdk::contractevent(export = false, topics = ["min_fee_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MinFeeSet {
    #[topic]
    pub burn_token: soroban_sdk::Address,
    pub min_fee: i128,
}
#[soroban_sdk::contractevent(export = false, topics = ["min_fee_controller_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MinFeeControllerSet {
    #[topic]
    pub new_min_fee_controller: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["remote_token_messenger_added"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RemoteTokenMessengerAdded {
    pub domain: u32,
    pub token_messenger: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(
    export = false,
    topics = ["remote_token_messenger_removed",
    ]
)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RemoteTokenMessengerRemoved {
    pub domain: u32,
    pub token_messenger: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["admin_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AdminChanged {
    pub old_admin: Option<soroban_sdk::Address>,
    pub new_admin: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["admin_change_started"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AdminChangeStarted {
    pub old_admin: Option<soroban_sdk::Address>,
    pub new_admin: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["pauser_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PauserChanged {
    pub new_address: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["rescuer_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RescuerChanged {
    pub new_rescuer: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["set_root"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SetRoot {
    pub root: soroban_sdk::Bytes,
}
#[soroban_sdk::contractevent(export = false, topics = ["set_claimed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SetClaimed {
    pub index: soroban_sdk::Val,
}
#[soroban_sdk::contractevent(export = false, topics = ["paused"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Paused {}
#[soroban_sdk::contractevent(export = false, topics = ["unpaused"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Unpaused {}
#[soroban_sdk::contractevent(export = false, topics = ["role_granted"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleGranted {
    #[topic]
    pub role: soroban_sdk::Symbol,
    #[topic]
    pub account: soroban_sdk::Address,
    pub caller: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["role_revoked"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleRevoked {
    #[topic]
    pub role: soroban_sdk::Symbol,
    #[topic]
    pub account: soroban_sdk::Address,
    pub caller: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["admin_renounced"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AdminRenounced {
    #[topic]
    pub admin: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["role_admin_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleAdminChanged {
    #[topic]
    pub role: soroban_sdk::Symbol,
    pub previous_admin_role: soroban_sdk::Symbol,
    pub new_admin_role: soroban_sdk::Symbol,
}
#[soroban_sdk::contractevent(export = false, topics = ["admin_transfer_completed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AdminTransferCompleted {
    #[topic]
    pub new_admin: soroban_sdk::Address,
    pub previous_admin: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["admin_transfer_initiated"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AdminTransferInitiated {
    #[topic]
    pub current_admin: soroban_sdk::Address,
    pub new_admin: soroban_sdk::Address,
    pub live_until_ledger: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_transfer"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipTransfer {
    pub old_owner: soroban_sdk::Address,
    pub new_owner: soroban_sdk::Address,
    pub live_until_ledger: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_renounced"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipRenounced {
    pub old_owner: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_transfer_completed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipTransferCompleted {
    pub new_owner: soroban_sdk::Address,
}

