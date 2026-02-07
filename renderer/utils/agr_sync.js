
// utils/agr_sync.js
// Frontend Logic for AGR Commission Automation

async function syncAGRCommissions(supabase) {
    console.log("🚀 [Auto-Sync] Starting AGR Commission Check...");
    // AGR RULE IMPLEMENTATION:
    // If the agent passed the AGR on the PRESENT month (Previous relative to the Release Month),
    // then the agent's NEXT month (Current Release Month) Receivable amount will be released to Withdrawable Balance.
    // Example: To release FEB commissions, we check JAN performance (AGR).

    // Helper: Cutoff Range
    function cutoffRange(year, month) {
        const Y = Number(year);
        const M = Number(month);
        const start = new Date(Y, M - 1, 7);
        const end = new Date(Y, M, 7);
        // Use local YYYY-MM-DD to avoid UTC shift
        const toLocal = d => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        return { gte: toLocal(start), lt: toLocal(end) };
    }

    // Helper: Get Previous Month
    function getPrevPeriod(y, m) {
        let py = y;
        let pm = m - 1;
        if (pm === 0) {
            pm = 12;
            py = y - 1;
        }
        return { year: py, month: pm };
    }

    // 1. Determine Target Period (Current Month)
    const now = new Date();
    const period_year = now.getFullYear();
    const period_month = now.getMonth() + 1;

    console.log(`[Auto-Sync] checking period: ${period_year}-${period_month}`);

    // FETCH ALL AGENTS
    const { data: agents, error: aErr } = await supabase
        .from('agents')
        .select('id');

    if (aErr || !agents) {
        console.error("[Auto-Sync] Error fetching agents:", aErr);
        return;
    }

    // Process EACH agent
    for (const agent of agents) {
        // Check if ALREADY released for this agent/month
        const { data: existing } = await supabase
            .from('agent_commission_rollups')
            .select('*')
            .eq('agent_id', agent.id)
            .eq('period_year', period_year)
            .eq('period_month', period_month)
            .maybeSingle();

        if (existing && existing.status === 'released') {
            continue; // Already paid
        }

        // Construct a virtual rollup object
        const rollup = existing || {
            agent_id: agent.id,
            period_year,
            period_month,
            status: 'unreleased'
        };

        await processRollup(supabase, rollup, cutoffRange, getPrevPeriod);
    }

    console.log("[Auto-Sync] Complete.");
}

async function processRollup(supabase, r, cutoffRange, getPrevPeriod) {
    const { agent_id, period_year, period_month } = r;

    // 2. Identify PREVIOUS Period (The Qualifier)
    const prev = getPrevPeriod(period_year, period_month);

    // 3. Check Eligibility in PREVIOUS Period
    const { gte, lt } = cutoffRange(prev.year, prev.month);

    // Fetch collections for PREV period
    const { data: colls, error: cErr } = await supabase
        .from('collections')
        .select('member_id, is_membership_fee, payment_for, payment')
        .eq('agent_id', agent_id)
        .gte('date_paid', gte)
        .lt('date_paid', lt);

    if (cErr) {
        console.error(`[Auto-Sync] Error fetching prev collections for Agent ${agent_id}:`, cErr.message);
        return;
    }

    // Logic Check (Rule A/B)
    const membershipCount = colls.filter(c => c.is_membership_fee).length;
    const byMember = {};
    colls.forEach(c => {
        if (!byMember[c.member_id]) byMember[c.member_id] = [];
        byMember[c.member_id].push(c);
    });
    let hasMix = false;
    for (const mId in byMember) {
        const pay = byMember[mId];
        const hasMem = pay.some(p => p.is_membership_fee);
        const hasReg = pay.some(p => !p.is_membership_fee && p.payment_for === 'regular');
        if (hasMem && hasReg) {
            hasMix = true;
            break;
        }
    }

    const isEligible = (membershipCount >= 3) || hasMix;

    if (!isEligible) {
        // console.log(`[Auto-Sync] Agent ${agent_id}: Not Eligible based on ${prev.year}-${prev.month}.`);
        return;
    }

    // 4. Calculate Receivable Amount for TARGET Period
    const targetRange = cutoffRange(period_year, period_month);

    const { data: comms } = await supabase
        .from('commissions')
        .select('amount, commission_type, is_receivable, override_commission')
        .eq('agent_id', agent_id)
        .gte('date_earned', targetRange.gte)
        .lt('date_earned', targetRange.lt);

    let receivableTotal = 0;
    comms.forEach(c => {
        const amt = Number(c.amount || 0);
        const type = c.commission_type;
        const ovr = Number(c.override_commission || 0);
        if (type === 'override' || type === 'recruiter_bonus') {
            receivableTotal += (ovr > 0 ? ovr : amt);
        } else if (c.is_receivable) {
            receivableTotal += amt;
        }
    });

    if (receivableTotal <= 0) {
        await markReleased(supabase, agent_id, period_year, period_month);
        return;
    }

    // 5. RELEASE
    console.log(`[Auto-Sync] 💰 TRANSFER: ₱${receivableTotal} to Agent ${agent_id} (Qualified via ${prev.month})`);

    const { error: wErr } = await supabase.rpc('increment_wallet', {
        p_agent_id: agent_id,
        p_amount: receivableTotal
    });

    if (wErr) {
        // Fallback Manual Update
        const { data: wData } = await supabase.from('agent_wallets').select('balance').eq('agent_id', agent_id).single();
        if (!wData) {
            await supabase.from('agent_wallets').insert([{ agent_id, balance: receivableTotal, lifetime_commission: receivableTotal }]);
        } else {
            const newBal = Number(wData.balance) + receivableTotal;
            await supabase.from('agent_wallets').update({ balance: newBal }).eq('agent_id', agent_id);
        }
    }

    await markReleased(supabase, agent_id, period_year, period_month);
}

async function markReleased(supabase, agentId, y, m) {
    await supabase
        .from('agent_commission_rollups')
        .update({ status: 'released' })
        .eq('agent_id', agentId)
        .eq('period_year', y)
        .eq('period_month', m);
}

// Expose to window if loaded via script tag
window.syncAGRCommissions = syncAGRCommissions;
