import { createHmac } from "node:crypto";
import type { PseudonymProvider } from "../ports.js";
export class HmacPseudonymProvider implements PseudonymProvider {
  constructor(private readonly secret: string) {}
  async get(lessonId: string): Promise<string> {
    return createHmac("sha256", this.secret).update(lessonId).digest("hex").slice(0, 16);
  }
}
