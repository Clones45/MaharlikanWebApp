require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const db = createClient(supabaseUrl, supabaseKey);

async function recompute() {
  console.log("🧹 Clearing old commissions...");
  const { error: delErr } = await db.from("commissions").delete().neq("id", 0);
  if (delErr) throw delErr;
  console.log("✅ All existing commissions deleted.");

  console.log("📦 Fetching collections, members, and agents...");

  // --- Fetch collections
  const { data: collections, error: collErr } = await db
    .from("collections")
    .select("id, member_id, maf_no, plan_type, payment, date_paid, outright_mode")
    .order("date_paid", { ascending: true });

  if (collErr) throw collErr;

  // --- Fetch members
  const { data: members, error: memErr } = await db
    .from("members")
    .select("id, agent_id, plan_type, plan_start_date, contracted_price");
  if (memErr) throw memErr;

  // --- Fetch agents
  const { data: agents, error: agErr } = await db
    .from("agents")
    .select("id, recruiter_id");
  if (agErr) throw agErr;

  console.log(`📊 Found ${collections.length} collections, ${members.length} members, and ${agents.length} agents`);

  // --- Commission plan reference
  const planMap = {
    A1: { monthly: 120, outright: 150, monthlyDue: 498 },
    A2: { monthly: 120, outright: 150, monthlyDue: 500 },
    B1: { monthly: 100, outright: 130, monthlyDue: 348 },
    B2: { monthly: 100, outright: 130, monthlyDue: 350 },
    MEMBERSHIP: { monthly: 120, outright: 150, monthlyDue: 500 },
  };

  const insertedRows = [];

  for (const col of collections) {
  const planType = (col.plan_type || "").toUpperCase().replace("PLAN ", "");
  const plan = planMap[planType];
  if (!plan) continue;

  // Match the corresponding member
  const member = members.find(m => m.id === col.member_id);
  if (!member) continue;

  // Find the agent and recruiter for this member
  const agent = agents.find(a => a.id === member.agent_id);
  const recruiterId = agent ? agent.recruiter_id : null;

  const agentId = member.agent_id;
  const monthlyRate = plan.monthlyDue;
  const monthsPaidNow = Math.floor(col.payment / monthlyRate);
  if (monthsPaidNow <= 0) continue;

  // Get total months already paid before this payment
  const { data: prevColls } = await db
    .from("collections")
    .select("payment, date_paid")
    .eq("member_id", col.member_id)
    .lt("date_paid", col.date_paid);

  const totalPrevPaid = (prevColls || []).reduce((a, r) => a + Number(r.payment || 0), 0);
  const totalPrevMonths = Math.floor(totalPrevPaid / monthlyRate);

  // ✅ Compute current payment allocation
  // Determine how many months still count under the 12-month outright limit
  const remainingOutrightMonths = Math.max(0, 12 - totalPrevMonths);
  const outrightMonths = Math.min(monthsPaidNow, remainingOutrightMonths);
  const monthlyMonths = Math.max(0, monthsPaidNow - outrightMonths);

  // ✅ Compute commission amounts
  const outrightComm = outrightMonths * plan.outright;
  const monthlyComm = monthlyMonths * plan.monthly;
  const recruiterComm = (outrightComm + monthlyComm) * 0.10;

  // ✅ Build rows
  if (agentId) {
    if (outrightMonths > 0) {
      insertedRows.push({
        agent_id: agentId,
        member_id: col.member_id,
        collection_id: col.id,
        commission_type: "plan_outright",
        plan_type: planType,
        basis_amount: plan.outright,
        months_covered: outrightMonths,
        amount: outrightComm,
        outright_mode: col.outright_mode || "accrue",
        date_earned: col.date_paid,
        status: "pending",
      });
    }

    if (monthlyMonths > 0) {
      insertedRows.push({
        agent_id: agentId,
        member_id: col.member_id,
        collection_id: col.id,
        commission_type: "plan_monthly",
        plan_type: planType,
        basis_amount: plan.monthly,
        months_covered: monthlyMonths,
        amount: monthlyComm,
        outright_mode: col.outright_mode || "accrue",
        date_earned: col.date_paid,
        status: "pending",
      });
    }
  }

  // ✅ Recruiter always gets 10%
  if (recruiterId && (outrightComm > 0 || monthlyComm > 0)) {
    insertedRows.push({
      agent_id: recruiterId,
      member_id: col.member_id,
      collection_id: col.id,
      recruiter_id: recruiterId,
      commission_type: "recruiter_bonus",
      plan_type: planType,
      basis_amount: outrightComm + monthlyComm,
      percentage: 10,
      amount: recruiterComm,
      outright_mode: col.outright_mode || "accrue",
      date_earned: col.date_paid,
      status: "pending",
    });
  }
}


  // --- Insert computed commissions
  console.log(`🧾 Inserting ${insertedRows.length} computed commission rows...`);
  for (let i = 0; i < insertedRows.length; i += 1000) {
    const chunk = insertedRows.slice(i, i + 1000);
    const { error } = await db.from("commissions").insert(chunk);
    if (error) console.error("Insert error:", error);
  }

  console.log("✅ Recompute completed successfully!");
}

recompute().catch((err) => console.error("❌ Recompute failed:", err));
