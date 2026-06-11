import { createHmac } from "node:crypto";
import type { PseudonymProvider } from "../ports.js";
/** Per-learner salted pseudonym (#4): HMAC(secret, `${learnerId}:${lessonId}`). The learnerId salt
 * means distinct learners on the SAME lesson get distinct pseudonyms; the same learner+lesson is
 * stable; changing the secret rotates every pseudonym. */
export class HmacPseudonymProvider implements PseudonymProvider {
  constructor(private readonly secret: string) {}
  async get(learnerId: string, lessonId: string): Promise<string> {
    return createHmac("sha256", this.secret).update(`${learnerId}:${lessonId}`).digest("hex").slice(0, 16);
  }
}
