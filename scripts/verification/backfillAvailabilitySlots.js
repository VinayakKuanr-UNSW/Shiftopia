/**
 * Backfill availability_slots for all existing availability_rules
 * Node.js version (no ts-node required)
 */

const SUPABASE_URL = "https://srfozdlphoempdattvtx.supabase.co";
const EDGE_FUNCTION_URL =
    "https://srfozdlphoempdattvtx.functions.supabase.co/expand-availability-slots";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

async function fetchAllRules() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/availability_rules?select=id`,
        {
            headers: {
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
        }
    );

    if (!res.ok) {
        throw new Error(`Failed to fetch rules: ${await res.text()}`);
    }

    return res.json();
}

async function ruleHasSlots(ruleId) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/availability_slots?rule_id=eq.${ruleId}&select=id&limit=1`,
        {
            headers: {
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
        }
    );

    if (!res.ok) {
        throw new Error(`Failed to check slots for rule ${ruleId}`);
    }

    const rows = await res.json();
    return rows.length > 0;
}

async function expandRule(ruleId) {
    const res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ rule_id: ruleId }),
    });

    if (!res.ok) {
        throw new Error(`Edge function failed: ${await res.text()}`);
    }
}

async function main() {
    console.log("Starting availability_slots backfill...");

    const rules = await fetchAllRules();
    console.log(`Found ${rules.length} rules`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const rule of rules) {
        try {
            const hasSlots = await ruleHasSlots(rule.id);

            if (hasSlots) {
                skipped++;
                continue;
            }

            await expandRule(rule.id);
            processed++;

            console.log(`✓ Expanded rule ${rule.id}`);
        } catch (err) {
            failed++;
            console.error(`✗ Failed rule ${rule.id}`, err.message);
        }
    }

    console.log("Backfill complete");
    console.log({
        total: rules.length,
        processed,
        skipped,
        failed,
    });
}

main().catch((err) => {
    console.error("Fatal error during backfill", err);
    process.exit(1);
});
