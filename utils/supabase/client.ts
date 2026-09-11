import { createBrowserClient } from "@supabase/ssr";

import { publicSupabaseEnv } from "./env";

export const createClient = () => {
  const { url, key } = publicSupabaseEnv();
  return createBrowserClient(url, key);
};
