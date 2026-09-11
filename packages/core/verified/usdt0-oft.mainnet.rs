// Generated 2026-09-11 with stellar-cli 26.1.0 against Stellar mainnet (https://mainnet.sorobanrpc.com):
//   stellar contract info interface --id CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6 \
//     --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"
// Do not edit. Re-generate and diff when Circle or LayerZero announce a contract upgrade.

#[soroban_sdk::contractargs(name = "Args")]
#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn set_rate_limit(
        env: soroban_sdk::Env,
        direction: Direction,
        eid: u32,
        config: Option<RateLimitConfig>,
        operator: soroban_sdk::Address,
    );
    fn rate_limit_config(
        env: soroban_sdk::Env,
        direction: Direction,
        eid: u32,
    ) -> Option<RateLimitConfig>;
    fn rate_limit_in_flight(
        env: soroban_sdk::Env,
        direction: Direction,
        eid: u32,
    ) -> i128;
    fn rate_limit_capacity(
        env: soroban_sdk::Env,
        direction: Direction,
        eid: u32,
    ) -> i128;
    fn set_default_fee_bps(
        env: soroban_sdk::Env,
        default_fee_bps: Option<u32>,
        operator: soroban_sdk::Address,
    );
    fn set_fee_bps(
        env: soroban_sdk::Env,
        dst_eid: u32,
        fee_bps: Option<u32>,
        operator: soroban_sdk::Address,
    );
    fn set_fee_deposit_address(
        env: soroban_sdk::Env,
        fee_deposit_address: Option<soroban_sdk::Address>,
        operator: soroban_sdk::Address,
    );
    fn default_fee_bps(env: soroban_sdk::Env) -> Option<u32>;
    fn fee_bps(env: soroban_sdk::Env, dst_eid: u32) -> Option<u32>;
    fn effective_fee_bps(env: soroban_sdk::Env, dst_eid: u32) -> u32;
    fn has_oft_fee(env: soroban_sdk::Env, dst_eid: u32) -> bool;
    fn fee_deposit_address(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn pause(env: soroban_sdk::Env, operator: soroban_sdk::Address);
    fn unpause(env: soroban_sdk::Env, operator: soroban_sdk::Address);
    fn is_paused(env: soroban_sdk::Env) -> bool;
    fn quote_oft(
        env: soroban_sdk::Env,
        from: soroban_sdk::Address,
        send_param: SendParam,
    ) -> (OFTLimit, soroban_sdk::Vec<OFTFeeDetail>, OFTReceipt);
    fn token(env: soroban_sdk::Env) -> soroban_sdk::Address;
    fn oft_version(env: soroban_sdk::Env) -> (u64, u64);
    fn shared_decimals(env: soroban_sdk::Env) -> u32;
    fn decimal_conversion_rate(env: soroban_sdk::Env) -> i128;
    fn approval_required(env: soroban_sdk::Env) -> bool;
    fn msg_inspector(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn set_msg_inspector(
        env: soroban_sdk::Env,
        inspector: Option<soroban_sdk::Address>,
        operator: soroban_sdk::Address,
    );
    fn quote_send(
        env: soroban_sdk::Env,
        from: soroban_sdk::Address,
        send_param: SendParam,
        pay_in_zro: bool,
    ) -> MessagingFee;
    fn send(
        env: soroban_sdk::Env,
        from: soroban_sdk::Address,
        send_param: SendParam,
        fee: MessagingFee,
        refund_address: soroban_sdk::Address,
    ) -> (MessagingReceipt, OFTReceipt);
    fn __constructor(
        env: soroban_sdk::Env,
        token: soroban_sdk::Address,
        shared_decimals: u32,
        oft_type: OftType,
        endpoint: soroban_sdk::Address,
        delegate: soroban_sdk::Address,
    );
    fn oft_type(env: soroban_sdk::Env) -> OftType;
    fn oapp_version(env: soroban_sdk::Env) -> (u64, u64);
    fn endpoint(env: soroban_sdk::Env) -> soroban_sdk::Address;
    fn peer(env: soroban_sdk::Env, eid: u32) -> Option<soroban_sdk::BytesN<32>>;
    fn set_peer(
        env: soroban_sdk::Env,
        eid: u32,
        peer: Option<soroban_sdk::BytesN<32>>,
        operator: soroban_sdk::Address,
    );
    fn set_delegate(
        env: soroban_sdk::Env,
        delegate: Option<soroban_sdk::Address>,
        operator: soroban_sdk::Address,
    );
    fn grant_role(
        env: soroban_sdk::Env,
        account: soroban_sdk::Address,
        role: soroban_sdk::Symbol,
        caller: soroban_sdk::Address,
    );
    fn revoke_role(
        env: soroban_sdk::Env,
        account: soroban_sdk::Address,
        role: soroban_sdk::Symbol,
        caller: soroban_sdk::Address,
    );
    fn renounce_role(
        env: soroban_sdk::Env,
        role: soroban_sdk::Symbol,
        caller: soroban_sdk::Address,
    );
    fn set_role_admin(
        env: soroban_sdk::Env,
        role: soroban_sdk::Symbol,
        admin_role: soroban_sdk::Symbol,
    );
    fn remove_role_admin(env: soroban_sdk::Env, role: soroban_sdk::Symbol);
    fn has_role(
        env: soroban_sdk::Env,
        account: soroban_sdk::Address,
        role: soroban_sdk::Symbol,
    ) -> Option<u32>;
    fn get_role_admin(
        env: soroban_sdk::Env,
        role: soroban_sdk::Symbol,
    ) -> Option<soroban_sdk::Symbol>;
    fn get_role_member_count(env: soroban_sdk::Env, role: soroban_sdk::Symbol) -> u32;
    fn get_role_member(
        env: soroban_sdk::Env,
        role: soroban_sdk::Symbol,
        index: u32,
    ) -> soroban_sdk::Address;
    fn get_existing_roles(
        env: soroban_sdk::Env,
    ) -> soroban_sdk::Vec<soroban_sdk::Symbol>;
    fn allow_initialize_path(env: soroban_sdk::Env, origin: Origin) -> bool;
    fn next_nonce(
        env: soroban_sdk::Env,
        src_eid: u32,
        sender: soroban_sdk::BytesN<32>,
    ) -> u64;
    fn lz_receive(
        env: soroban_sdk::Env,
        executor: soroban_sdk::Address,
        origin: Origin,
        guid: soroban_sdk::BytesN<32>,
        message: soroban_sdk::Bytes,
        extra_data: soroban_sdk::Bytes,
        value: i128,
    );
    fn is_compose_msg_sender(
        env: soroban_sdk::Env,
        origin: Origin,
        message: soroban_sdk::Bytes,
        sender: soroban_sdk::Address,
    ) -> bool;
    fn enforced_options(
        env: soroban_sdk::Env,
        eid: u32,
        msg_type: u32,
    ) -> Option<soroban_sdk::Bytes>;
    fn set_enforced_options(
        env: soroban_sdk::Env,
        options: soroban_sdk::Vec<EnforcedOptionParam>,
        operator: soroban_sdk::Address,
    );
    fn combine_options(
        env: soroban_sdk::Env,
        eid: u32,
        msg_type: u32,
        extra_options: soroban_sdk::Bytes,
    ) -> soroban_sdk::Bytes;
    fn upgrade(
        env: soroban_sdk::Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        operator: soroban_sdk::Address,
    );
    fn migrate(
        env: soroban_sdk::Env,
        migration_data: soroban_sdk::Bytes,
        operator: soroban_sdk::Address,
    );
    fn authorizer(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn owner(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn pending_owner(env: soroban_sdk::Env) -> Option<soroban_sdk::Address>;
    fn transfer_ownership(env: soroban_sdk::Env, new_owner: soroban_sdk::Address);
    fn begin_ownership_transfer(
        env: soroban_sdk::Env,
        new_owner: soroban_sdk::Address,
        ttl: u32,
    );
    fn accept_ownership(env: soroban_sdk::Env);
    fn renounce_ownership(env: soroban_sdk::Env);
    fn extend_instance_ttl(env: soroban_sdk::Env, threshold: u32, extend_to: u32);
    fn set_ttl_configs(
        env: soroban_sdk::Env,
        instance: Option<TtlConfig>,
        persistent: Option<TtlConfig>,
    );
    fn ttl_configs(env: soroban_sdk::Env) -> (Option<TtlConfig>, Option<TtlConfig>);
    fn freeze_ttl_configs(env: soroban_sdk::Env);
    fn is_ttl_configs_frozen(env: soroban_sdk::Env) -> bool;
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RateLimitConfig {
    pub limit: i128,
    pub mode: Mode,
    pub window_seconds: u64,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MessagingParams {
    pub dst_eid: u32,
    pub message: soroban_sdk::Bytes,
    pub options: soroban_sdk::Bytes,
    pub pay_in_zro: bool,
    pub receiver: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Origin {
    pub nonce: u64,
    pub sender: soroban_sdk::BytesN<32>,
    pub src_eid: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MessagingFee {
    pub native_fee: i128,
    pub zro_fee: i128,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MessagingReceipt {
    pub fee: MessagingFee,
    pub guid: soroban_sdk::BytesN<32>,
    pub nonce: u64,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MessageLibVersion {
    pub endpoint_version: u32,
    pub major: u64,
    pub minor: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Timeout {
    pub expiry: u64,
    pub lib: soroban_sdk::Address,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SetConfigParam {
    pub config: soroban_sdk::Bytes,
    pub config_type: u32,
    pub eid: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ResolvedLibrary {
    pub is_default: bool,
    pub lib: soroban_sdk::Address,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OutboundPacket {
    pub dst_eid: u32,
    pub guid: soroban_sdk::BytesN<32>,
    pub message: soroban_sdk::Bytes,
    pub nonce: u64,
    pub receiver: soroban_sdk::BytesN<32>,
    pub sender: soroban_sdk::Address,
    pub src_eid: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeeRecipient {
    pub amount: i128,
    pub to: soroban_sdk::Address,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeesAndPacket {
    pub encoded_packet: soroban_sdk::Bytes,
    pub native_fee_recipients: soroban_sdk::Vec<FeeRecipient>,
    pub zro_fee_recipients: soroban_sdk::Vec<FeeRecipient>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct EnforcedOptionParam {
    pub eid: u32,
    pub msg_type: u32,
    pub options: Option<soroban_sdk::Bytes>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SendParam {
    pub amount_ld: i128,
    pub compose_msg: soroban_sdk::Bytes,
    pub dst_eid: u32,
    pub extra_options: soroban_sdk::Bytes,
    pub min_amount_ld: i128,
    pub oft_cmd: soroban_sdk::Bytes,
    pub to: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OFTLimit {
    pub max_amount_ld: i128,
    pub min_amount_ld: i128,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OFTReceipt {
    pub amount_received_ld: i128,
    pub amount_sent_ld: i128,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OFTFeeDetail {
    pub description: soroban_sdk::Bytes,
    pub fee_amount_ld: i128,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TtlConfig {
    pub extend_to: u32,
    pub threshold: u32,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTFeeStorage {
    DefaultFeeBps,
    FeeBps(u32),
    FeeDepositAddress,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTPausableStorage {
    Paused,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Direction {
    Inbound,
    Outbound,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Mode {
    Net,
    Gross,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OftType {
    LockUnlock,
    MintBurn(soroban_sdk::Address),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MessageLibType {
    Send,
    Receive,
    SendAndReceive,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OAppCoreStorage {
    Endpoint,
    Peer(u32),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OAppOptionsType3Storage {
    EnforcedOptions(u32, u32),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum FeePayer {
    Unverified(soroban_sdk::Address),
    Verified(soroban_sdk::Address),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTStorage {
    DecimalsDiff,
    Token,
    MsgInspector,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MultiSigStorage {
    Signers,
    Threshold,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OwnableStorage {
    Owner,
    PendingOwner,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RbacStorage {
    ExistingRoles,
    RoleIndexToAccount(soroban_sdk::Symbol, u32),
    RoleAccountToIndex(soroban_sdk::Symbol, soroban_sdk::Address),
    RoleAccountsCount(soroban_sdk::Symbol),
    RoleAdmin(soroban_sdk::Symbol),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum TtlConfigStorage {
    Frozen,
    Instance,
    Persistent,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum UpgradeableStorage {
    Migrating,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTFeeError {
    InvalidFeeBps = 3100,
    InvalidFeeDepositAddress = 3101,
    SameValue = 3102,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTPausableError {
    Paused = 3110,
    PauseStatusUnchanged = 3111,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RateLimitError {
    ExceededRateLimit = 3120,
    InvalidAmount = 3121,
    InvalidTimestamp = 3122,
    InvalidConfig = 3123,
    SameValue = 3124,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum EndpointError {
    AlreadyRegistered = 1,
    ComposeExists = 2,
    ComposeNotFound = 3,
    DefaultReceiveLibUnavailable = 4,
    DefaultSendLibUnavailable = 5,
    InsufficientNativeFee = 6,
    InsufficientZroFee = 7,
    InvalidExpiry = 8,
    InvalidAmount = 9,
    InvalidIndex = 10,
    InvalidNonce = 11,
    InvalidPayloadHash = 12,
    InvalidReceiveLibrary = 13,
    OnlyNonDefaultLib = 14,
    OnlyReceiveLib = 15,
    OnlyRegisteredLib = 16,
    OnlySendLib = 17,
    PathNotInitializable = 18,
    PathNotVerifiable = 19,
    PayloadHashNotFound = 20,
    SameValue = 21,
    Unauthorized = 22,
    UnsupportedEid = 23,
    ZeroZroFee = 24,
    ZroUnavailable = 25,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OAppError {
    InvalidOptions = 2000,
    NoPeer = 2001,
    OnlyPeer = 2002,
    ZroTokenUnavailable = 2003,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OFTError {
    InvalidAddress = 3000,
    InvalidAmount = 3001,
    InvalidLocalDecimals = 3002,
    NotInitialized = 3003,
    Overflow = 3004,
    SlippageExceeded = 3005,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum BufferReaderError {
    InvalidLength = 1000,
    InvalidAddressPayload = 1001,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum BufferWriterError {
    InvalidAddressPayload = 1010,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum TtlConfigurableError {
    InvalidTtlConfig = 1020,
    TtlConfigFrozen = 1021,
    TtlConfigAlreadyFrozen = 1022,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum OwnableError {
    InvalidAuthorizer = 1030,
    InvalidPendingOwner = 1031,
    InvalidTtl = 1032,
    NoPendingTransfer = 1033,
    OwnerAlreadySet = 1034,
    OwnerNotSet = 1035,
    TransferInProgress = 1036,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum BytesExtError {
    LengthMismatch = 1040,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum UpgradeableError {
    InvalidMigrationData = 1050,
    MigrationNotAllowed = 1051,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum MultiSigError {
    AlreadyInitialized = 1060,
    InvalidAuthorizer = 1061,
    InvalidSigner = 1062,
    SignatureError = 1063,
    SignerAlreadyExists = 1064,
    SignerNotFound = 1065,
    TotalSignersLessThanThreshold = 1066,
    UnsortedSigners = 1067,
    ZeroThreshold = 1068,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum AuthError {
    AuthorizerNotFound = 1070,
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum RbacError {
    AdminRoleNotFound = 1080,
    IndexOutOfBounds = 1081,
    MaxRolesExceeded = 1082,
    RoleIsEmpty = 1083,
    RoleNotFound = 1084,
    RoleNotHeld = 1085,
    Unauthorized = 1086,
}
#[soroban_sdk::contractevent(export = false, topics = ["default_fee_bps_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DefaultFeeBpsSet {
    pub fee_bps: Option<u32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["fee_bps_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeeBpsSet {
    pub dst_eid: u32,
    pub fee_bps: Option<u32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["fee_deposit_address_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeeDepositAddressSet {
    pub fee_deposit_address: Option<soroban_sdk::Address>,
}
#[soroban_sdk::contractevent(export = false, topics = ["paused_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PausedSet {
    pub paused: bool,
}
#[soroban_sdk::contractevent(export = false, topics = ["rate_limit_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RateLimitSet {
    pub direction: Direction,
    pub eid: u32,
    pub config: Option<RateLimitConfig>,
}
#[soroban_sdk::contractevent(export = false, topics = ["packet_sent"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PacketSent {
    pub encoded_packet: soroban_sdk::Bytes,
    pub options: soroban_sdk::Bytes,
    pub send_library: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["packet_verified"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PacketVerified {
    #[topic]
    pub origin: Origin,
    #[topic]
    pub receiver: soroban_sdk::Address,
    pub payload_hash: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["packet_delivered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PacketDelivered {
    #[topic]
    pub origin: Origin,
    #[topic]
    pub receiver: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["lz_receive_alert"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct LzReceiveAlert {
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub executor: soroban_sdk::Address,
    #[topic]
    pub origin: Origin,
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    pub gas: i128,
    pub value: i128,
    pub message: soroban_sdk::Bytes,
    pub extra_data: soroban_sdk::Bytes,
    pub reason: soroban_sdk::Bytes,
}
#[soroban_sdk::contractevent(export = false, topics = ["zro_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ZroSet {
    pub zro: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["delegate_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DelegateSet {
    #[topic]
    pub oapp: soroban_sdk::Address,
    pub delegate: Option<soroban_sdk::Address>,
}
#[soroban_sdk::contractevent(export = false, topics = ["inbound_nonce_skipped"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct InboundNonceSkipped {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: soroban_sdk::BytesN<32>,
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub nonce: u64,
}
#[soroban_sdk::contractevent(export = false, topics = ["packet_nilified"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PacketNilified {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: soroban_sdk::BytesN<32>,
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub nonce: u64,
    pub payload_hash: Option<soroban_sdk::BytesN<32>>,
}
#[soroban_sdk::contractevent(export = false, topics = ["packet_burnt"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PacketBurnt {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: soroban_sdk::BytesN<32>,
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub nonce: u64,
    pub payload_hash: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["library_registered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct LibraryRegistered {
    pub new_lib: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["default_send_library_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DefaultSendLibrarySet {
    #[topic]
    pub dst_eid: u32,
    pub new_lib: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["default_receive_library_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DefaultReceiveLibrarySet {
    #[topic]
    pub src_eid: u32,
    pub new_lib: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(
    export = false,
    topics = ["default_receive_lib_timeout_set",
    ]
)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct DefaultReceiveLibTimeoutSet {
    #[topic]
    pub src_eid: u32,
    pub timeout: Option<Timeout>,
}
#[soroban_sdk::contractevent(export = false, topics = ["send_library_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SendLibrarySet {
    #[topic]
    pub sender: soroban_sdk::Address,
    #[topic]
    pub dst_eid: u32,
    pub new_lib: Option<soroban_sdk::Address>,
}
#[soroban_sdk::contractevent(export = false, topics = ["receive_library_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ReceiveLibrarySet {
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub src_eid: u32,
    pub new_lib: Option<soroban_sdk::Address>,
}
#[soroban_sdk::contractevent(export = false, topics = ["receive_library_timeout_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ReceiveLibraryTimeoutSet {
    #[topic]
    pub receiver: soroban_sdk::Address,
    #[topic]
    pub eid: u32,
    pub timeout: Option<Timeout>,
}
#[soroban_sdk::contractevent(export = false, topics = ["compose_sent"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ComposeSent {
    #[topic]
    pub from: soroban_sdk::Address,
    #[topic]
    pub to: soroban_sdk::Address,
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    #[topic]
    pub index: u32,
    pub message: soroban_sdk::Bytes,
}
#[soroban_sdk::contractevent(export = false, topics = ["compose_delivered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ComposeDelivered {
    #[topic]
    pub from: soroban_sdk::Address,
    #[topic]
    pub to: soroban_sdk::Address,
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    #[topic]
    pub index: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["lz_compose_alert"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct LzComposeAlert {
    #[topic]
    pub from: soroban_sdk::Address,
    #[topic]
    pub to: soroban_sdk::Address,
    #[topic]
    pub executor: soroban_sdk::Address,
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    #[topic]
    pub index: u32,
    pub gas: i128,
    pub value: i128,
    pub message: soroban_sdk::Bytes,
    pub extra_data: soroban_sdk::Bytes,
    pub reason: soroban_sdk::Bytes,
}
#[soroban_sdk::contractevent(export = false, topics = ["peer_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PeerSet {
    pub eid: u32,
    pub peer: Option<soroban_sdk::BytesN<32>>,
}
#[soroban_sdk::contractevent(export = false, topics = ["enforced_option_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct EnforcedOptionSet {
    pub enforced_options: soroban_sdk::Vec<EnforcedOptionParam>,
}
#[soroban_sdk::contractevent(export = false, topics = ["oft_sent"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OFTSent {
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    #[topic]
    pub dst_eid: u32,
    #[topic]
    pub from: soroban_sdk::Address,
    pub amount_sent_ld: i128,
    pub amount_received_ld: i128,
}
#[soroban_sdk::contractevent(export = false, topics = ["oft_received"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OFTReceived {
    #[topic]
    pub guid: soroban_sdk::BytesN<32>,
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub to: soroban_sdk::Address,
    pub amount_received_ld: i128,
}
#[soroban_sdk::contractevent(export = false, topics = ["msg_inspector_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct MsgInspectorSet {
    pub inspector: Option<soroban_sdk::Address>,
}
#[soroban_sdk::contractevent(export = false, topics = ["signer_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerSet {
    #[topic]
    pub signer: soroban_sdk::BytesN<20>,
    pub active: bool,
}
#[soroban_sdk::contractevent(export = false, topics = ["threshold_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ThresholdSet {
    pub threshold: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_transferred"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipTransferred {
    pub old_owner: soroban_sdk::Address,
    pub new_owner: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_transferring"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipTransferring {
    pub old_owner: soroban_sdk::Address,
    pub new_owner: soroban_sdk::Address,
    pub ttl: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_transfer_cancelled"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipTransferCancelled {
    pub owner: soroban_sdk::Address,
    pub cancelled_pending_owner: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["ownership_renounced"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct OwnershipRenounced {
    pub old_owner: soroban_sdk::Address,
}
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
#[soroban_sdk::contractevent(export = false, topics = ["role_admin_changed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RoleAdminChanged {
    #[topic]
    pub role: soroban_sdk::Symbol,
    pub previous_admin_role: Option<soroban_sdk::Symbol>,
    pub new_admin_role: Option<soroban_sdk::Symbol>,
}
#[soroban_sdk::contractevent(export = false, topics = ["ttl_configs_set"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TtlConfigsSet {
    pub instance: Option<TtlConfig>,
    pub persistent: Option<TtlConfig>,
}
#[soroban_sdk::contractevent(export = false, topics = ["ttl_configs_frozen"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TtlConfigsFrozen {}

