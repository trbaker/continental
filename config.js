/* CONTINENTAL — configuration & Supabase storage layer
   Edit the two constants below to point at your own Supabase project.
   Loaded first; game.js depends on it. */
'use strict';

/* ---------------- Supabase (multiplayer sync via a `games` table) ----------------
   Setup (once, ~5 minutes):
   1. Create a free project at supabase.com
   2. In the SQL Editor, run the script in supabase-setup.sql (creates the
      `games` table and open read/write policies for the anon key)
   3. Paste your Project URL and anon public key below (Settings → API)
   The game talks to Supabase's PostgREST endpoint directly with fetch —
   no client library needed. The anon key is safe to publish; it only
   grants what the table policies allow.
------------------------------------------------------------------------------- */
const SUPABASE_URL = 'https://dchovdwsvzacmbsdygrz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Vm7xumfNaObjGL-yP2EvtQ_kG__2NRT';

function supabaseConfigured(){
  return SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;
}
const SB_HEADERS = () => {
  const h = { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if(SUPABASE_ANON_KEY.startsWith('eyJ')) h['Authorization'] = 'Bearer ' + SUPABASE_ANON_KEY; // legacy JWT keys only
  return h;
};
async function storeGet(code){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/games?code=eq.${encodeURIComponent(code)}&select=data`,
      { headers: SB_HEADERS() });
    if(!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0].data : null;
  }catch(e){ return null; }
}
async function storeSet(code, obj){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/games?on_conflict=code`, {
      method:'POST',
      headers: { ...SB_HEADERS(), 'Prefer':'resolution=merge-duplicates' },
      body: JSON.stringify([{ code, data: obj, version: obj.version, updated_at: new Date().toISOString() }])
    });
    return res.ok;
  }catch(e){ return false; }
}
