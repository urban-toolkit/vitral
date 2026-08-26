import crypto from "node:crypto";

/**
 * Password hashing on `node:crypto` alone.
 *
 * scrypt rather than bcrypt or argon2 because those are native addons: the backend image is
 * `node:25-alpine` with no build toolchain, so adding one means adding musl build deps to the
 * Dockerfile for a dependency Node already ships. scrypt is memory-hard, is what `crypto` offers,
 * and at these parameters costs ~100ms per attempt — which is the point.
 *
 * The parameters are stored in the hash string, so raising them later leaves existing accounts
 * verifiable against the parameters they were written with.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** `maxmem` must clear roughly `128 * N * r`; the default 32MB is under it at N=16384, r=8. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keylen: number, params: {
    N: number;
    r: number;
    p: number;
}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            password.normalize("NFKC"),
            salt,
            keylen,
            { ...params, maxmem: SCRYPT_MAXMEM },
            (error, derived) => {
                if (error) reject(error);
                else resolve(derived);
            },
        );
    });
}

/** `scrypt$N$r$p$<salt base64>$<hash base64>` */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return [
        "scrypt",
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString("base64"),
        derived.toString("base64"),
    ].join("$");
}

/**
 * Constant-time verification. Returns `false` for anything malformed rather than throwing, so a
 * corrupt row is a failed login and not a 500 that tells the caller the row is corrupt.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = String(stored ?? "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const N = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(parts[4], "base64");
        expected = Buffer.from(parts[5], "base64");
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;

    let derived: Buffer;
    try {
        derived = await scryptAsync(password, salt, expected.length, { N, r, p });
    } catch {
        return false;
    }

    // Lengths are equal by construction above, but `timingSafeEqual` throws on a mismatch rather
    // than returning false, so the guard stays.
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
}

export type CredentialProblem = { field: "username" | "password" | "email"; message: string };

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * The rules are deliberately mild — this is a research tool with a small, known set of users, and
 * a password policy that rejects a memorable passphrase buys nothing here. The upper bound on
 * length is a denial-of-service guard, not a strength rule: scrypt cost is paid by the server.
 */
export function validateCredentials(input: {
    username: string;
    password: string;
    email?: string | null;
}): CredentialProblem[] {
    const problems: CredentialProblem[] = [];
    const username = input.username.trim();

    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
        problems.push({
            field: "username",
            message: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`,
        });
    } else if (!USERNAME_PATTERN.test(username)) {
        problems.push({
            field: "username",
            message: "Username can use letters, numbers, dots, dashes and underscores.",
        });
    }

    if (input.password.length < PASSWORD_MIN_LENGTH) {
        problems.push({
            field: "password",
            message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
        });
    } else if (input.password.length > PASSWORD_MAX_LENGTH) {
        problems.push({
            field: "password",
            message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
        });
    }

    const email = String(input.email ?? "").trim();
    // Email is optional, so an empty one is never a problem — only a given one that cannot be an
    // address. The check is deliberately shallow: the only way to know an address is real is to
    // send to it, and nothing here does.
    if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        problems.push({ field: "email", message: "That does not look like an email address." });
    }

    return problems;
}
