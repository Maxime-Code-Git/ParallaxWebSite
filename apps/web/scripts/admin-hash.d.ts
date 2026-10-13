export const ARGON2_HASH_OPTIONS: {
  algorithm: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

export function validatePasswordInput(
  password: unknown,
  confirmation: unknown
): { valid: boolean; error?: string };

export function hashAdminPassword(password: string): Promise<string>;

export function runCLI(
  input?: NodeJS.ReadableStream,
  output?: NodeJS.WritableStream
): Promise<void>;
