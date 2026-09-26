/**
 * The capability catalogue — a leaf module (no imports), so migrations, seeds, access and tests can all read it.
 *
 * A route never asks "is this an admin"; it asks for a capability. Roles are bundles of capabilities, kept as rows
 * in the `roles` table, so a new role is a row and no change to any route. LEAST ACCESS: nobody holds anything their
 * role does not name. There is no '*' and no admin flag: the admin role, too, lists every capability one by one, and
 * a new capability reaches nobody by itself — it is handed to roles on purpose, in ROLE_CAPS below or by the admin.
 */
export const CAPABILITIES: Record<string, string> = {
  // every citizen: the game
  "hearts:mint": "Mint your own hearts, the daily income",
  "hearts:send": "Send hearts to another citizen",
  "city:create": "Found a city on a card of the planet",
  "coop:create": "Found a settlement or a coop on a cell of your city",
  "coop:invest": "Invest in a coop, and accept an invite into a settlement",
  "ledger:read": "See your own ledger",
  // founders: the makers
  "coop:manage": "Run the coops you founded",
  "intent:read": "See the makers' board: the intents",
  // the admin
  "roles:admin": "Manage roles: what each role holds, and who has which role",
  "ideas:admin": "Write down ideas and notes in the admin notebook",
};

/** Every capability, written out — the bundle of the admin role (never '*'). */
export const ALL_CAPS = Object.keys(CAPABILITIES);
/** What every player needs. */
export const CITIZEN_CAPS = ["hearts:mint", "hearts:send", "city:create", "coop:create", "coop:invest", "ledger:read"];

/** The role everyone is given when they sign up. */
export const DEFAULT_ROLE = "citizen";
/** The very first signup runs the city. */
export const FIRST_SIGNUP_ROLE = "admin";

/**
 * What each built-in role holds by DEFINITION. The roles are seeded from this on an empty database, and at every
 * boot a capability that is new here is handed, once, to the roles that name it (see reconcileRoleCaps). A cap the
 * admin took away on purpose stays away. A new capability a built-in role should hold is added HERE.
 */
export const ROLE_CAPS: Record<string, string[]> = {
  admin: ALL_CAPS,
  founder: [...CITIZEN_CAPS, "coop:manage", "intent:read"],
  citizen: CITIZEN_CAPS,
};

/** Roles that cannot be deleted: the one everybody gets, and the one that manages the rest. */
export const PROTECTED_ROLES = [DEFAULT_ROLE, FIRST_SIGNUP_ROLE];
