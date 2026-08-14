import { createClient } from "@supabase/supabase-js";

/**
 * Estas dos claves son seguras de tener aquí, visibles en el navegador:
 * la URL y la "publishable key" (equivalente a la antigua "anon key") no
 * dan acceso a nada por sí solas — toda la protección real la hacen las
 * políticas de Row Level Security (RLS) que se configuraron en cada tabla
 * de Supabase. Lo que NUNCA debe ir aquí es la "secret key".
 */
const SUPABASE_URL = "https://bqflwxrkvmpitbstqwku.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_n1Ox8eBNJDfuLHJ0w4q68Q_SFF5py8D";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
