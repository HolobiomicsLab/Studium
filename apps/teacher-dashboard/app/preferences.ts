"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function updatePreferences(form: FormData) {
  const jar = await cookies();
  const locale = form.get("locale");
  const theme = form.get("theme");
  const options = { path: "/", sameSite: "lax" as const, maxAge: 365 * 24 * 60 * 60 };
  if (locale === "fr" || locale === "en") jar.set("studium-locale", locale, options);
  if (theme === "light" || theme === "dark" || theme === "system") jar.set("studium-theme", theme, options);
  revalidatePath("/", "layout");
}
