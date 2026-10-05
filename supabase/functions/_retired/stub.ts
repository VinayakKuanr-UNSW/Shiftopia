// Deployed in place of every function archived in this folder (2026-10-05).
// The originals ran with the service role and no authentication; see README.md.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ error: "This endpoint has been retired." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
