import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the build had no Supabase settings (the app then shows "not configured"). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export const SIGNED_URL_SECONDS = 60;
export const BUCKET = "papers";
