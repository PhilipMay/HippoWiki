// The first password of a new user, which the admin passes on and the user replaces at the first login.
import { randomInt } from "node:crypto";

/** The length of a generated first password. */
export const FIRST_PASSWORD_LENGTH = 20;

/**
 * The characters of a generated first password: the letters and digits without the ones that are easy to confuse when
 * a password is read out or typed off a screen (`0` and `O`, `1`, `l` and `I`). 57 characters, so a password of 20 has
 * about 116 bits.
 */
export const FIRST_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random first password of 20 characters, drawn with the random numbers of `node:crypto`. */
export function generateFirstPassword(): string {
  let password = "";
  for (let position = 0; position < FIRST_PASSWORD_LENGTH; position += 1) {
    // `randomInt` draws without the bias that a remainder of random bytes would have.
    password += FIRST_PASSWORD_ALPHABET.charAt(randomInt(FIRST_PASSWORD_ALPHABET.length));
  }
  return password;
}
