import "server-only";

import { randomInt } from "node:crypto";

/**
 * A password Flo mints and a person hands over — to a cashier on
 * `/app/employees`, to an operator on `/admin/team`.
 *
 * The alphabet drops 0/1/I/L/O/U, the same way order references do — this
 * password gets read off a screen, typed into a phone, and often dictated down
 * a line with a generator running outside. A password nobody can transcribe is
 * a password somebody writes on the till in marker instead.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Three groups of four. Sixty bits from `randomInt`, which is the CSPRNG —
 * `Math.random()` here would be a password guessable from the one before it.
 */
export function generatePassword(): string {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

  return `${group()}-${group()}-${group()}`;
}
