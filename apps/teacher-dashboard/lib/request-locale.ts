import { cookies, headers } from "next/headers";
import { detectLocale } from "./i18n";

export async function requestLocale() {
  return detectLocale((await cookies()).get("studium-locale")?.value, (await headers()).get("accept-language") ?? "");
}
