import { randomInt } from "node:crypto";
import { generateToken } from "@rapifix/shared";

/** Token criptográficamente aleatorio para el portal del cliente. */
export const secureToken = (length = 10) => generateToken(length, (n) => randomInt(n));
