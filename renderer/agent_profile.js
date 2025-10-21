const { createClient } = supabase;

const supabaseUrl = "https://agyueadcymdopgihtckc.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneXVlYWRjeW1kb3BnaWh0Y2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzMzA2NjYsImV4cCI6MjA3NDkwNjY2Nn0.EBYfJ9RTkeGLQptG3uWaOsFMIz9DySu3uhaOlzgeeMw";
const db = createClient(supabaseUrl, supabaseKey);
const e = React.createElement;

/* ---------- Helpers ---------- */
function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function getLast12Months() {
  const arr = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "long", year: "numeric" });
    arr.push({ label, value: val });
  }
  return arr;
}
function getMonthLabel(iso) {
  const [y, m] = iso.split("-");
  return new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" });
}

/* ---------- Main ---------- */
function AgentProfile() {
  const [agent, setAgent] = React.useState(null);
  const [collections, setCollections] = React.useState([]);
  const [commissions, setCommissions] = React.useState([]);
  const [summary, setSummary] = React.useState({
    total: 0,
    count: 0,
    commTotal: 0,
    outrightTotal: 0,
    recruiterTotal: 0,
  });
  const [selectedMonth, setSelectedMonth] = React.useState(getCurrentMonthValue());
  const [loading, setLoading] = React.useState(true);

  // Scroll helpers
  const containerRef = React.useRef(null);
  const [showUp, setShowUp] = React.useState(false);
  const [showDown, setShowDown] = React.useState(true);

  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agent_id");

  React.useEffect(() => {
    if (agentId) boot(agentId, selectedMonth);
  }, [agentId, selectedMonth]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atTop = el.scrollTop < 40;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setShowUp(!atTop);
      setShowDown(!atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  function scrollToBottom() {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  async function boot(id, monthVal) {
    try {
      setLoading(true);

      const [year, mm] = monthVal.split("-");
      const monthStart = `${year}-${mm}-01`;
      const monthEnd = new Date(year, mm, 0).toISOString().split("T")[0];

      // 1️⃣ Agent info
      const { data: ag, error: agErr } = await db.from("agents").select("*").eq("id", id).single();
      if (agErr) throw agErr;
      setAgent(ag);

      // 2️⃣ Members
      const { data: members, error: memErr } = await db
        .from("members")
        .select("maf_no, first_name, last_name, plan_type")
        .eq("agent_id", id);
      if (memErr) throw memErr;

      const mafList = (members || []).map((m) => String(m.maf_no).trim());

      // 3️⃣ Collections
      const { data: colls, error: colErr } = await db
        .from("collections")
        .select("maf_no, plan_type, payment, date_paid, last_name, first_name")
        .in("maf_no", mafList)
        .order("date_paid", { ascending: true });
      if (colErr) throw colErr;

      const allCollections = (colls || []).map((c) => ({
        maf_no: c.maf_no,
        plan_type: c.plan_type,
        payment: Number(c.payment || 0),
        date_paid: c.date_paid,
        full_name: `${c.last_name}, ${c.first_name}`,
      }));

      const monthCollections = allCollections.filter(
        (c) => c.date_paid >= monthStart && c.date_paid <= monthEnd
      );

      // 4️⃣ Commissions (show all correct months)
      const { data: monthComms, error: commErr } = await db
        .from("commissions")
        .select("*")
        .or(`agent_id.eq.${id},recruiter_id.eq.${id}`)
        .in("commission_type", [
          "plan_monthly",
          "plan_outright",
          "membership_outright",
          "recruiter_bonus",
        ])
        .order("month", { ascending: true });

      if (commErr) console.error("Commission fetch error:", commErr);

      // 5️⃣ Filter for the selected month
      const filteredComms = (monthComms || []).filter(
        (c) => c.month >= monthStart && c.month <= monthEnd
      );

      // 6️⃣ Summaries
      const total = monthCollections.reduce((s, c) => s + c.payment, 0);
      const count = monthCollections.length;
      const commTotal = filteredComms
        .filter((c) => c.commission_type === "plan_monthly")
        .reduce((a, c) => a + Number(c.amount || 0), 0);
      const outrightTotal = filteredComms
        .filter((c) => (c.commission_type || "").includes("outright"))
        .reduce((a, c) => a + Number(c.amount || 0), 0);
      const recruiterTotal = filteredComms
        .filter((c) => c.commission_type === "recruiter_bonus")
        .reduce((a, c) => a + Number(c.amount || 0), 0);

      setCollections(monthCollections);
      setCommissions(filteredComms);
      setSummary({ total, count, commTotal, outrightTotal, recruiterTotal });

      // force scroll refresh
      setTimeout(() => {
        const el = containerRef.current;
        if (el)
          setShowDown(el.scrollHeight > el.clientHeight + 20);
      }, 300);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return e("p", null, "Loading agent data...");
  if (!agent) return e("p", null, "Agent not found.");

  return e(
    "div",
    { ref: containerRef, style: { height: "100vh", overflowY: "auto", padding: "16px", boxSizing: "border-box" } },
    [
      e(
        "a",
        { href: "hierarchy.html", style: { color: "#5fe280", display: "inline-block", marginBottom: "10px" } },
        "← Back to Hierarchy"
      ),

      /* ---------- Agent Info ---------- */
      e("div", { className: "card" }, [
        e("h1", { style: { color: "#5fe280" } }, agent.agent_name || "Agent Profile"),
        e("p", null, `Role: ${agent.role || "N/A"}`),
        e("p", null, `Email: ${agent.email || "—"}`),
        e("p", null, `Contact: ${agent.phone || "—"}`),
        e("label", { style: { color: "#5fe280" } }, "Select Month: "),
        e(
          "select",
          { value: selectedMonth, onChange: (ev) => setSelectedMonth(ev.target.value) },
          getLast12Months().map((m) => e("option", { key: m.value, value: m.value }, m.label))
        ),
      ]),

      /* ---------- Collections ---------- */
      e("div", { className: "card" }, [
        e("h2", { style: { color: "#5fe280" } }, `Collections (${getMonthLabel(selectedMonth)})`),
        e("p", null, `📄 ${summary.count} payments — Total ₱${summary.total.toLocaleString()}`),
        collections.length
          ? e("table", null, [
              e("thead", null,
                e("tr", null, [
                  e("th", null, "Member"),
                  e("th", null, "MAF No."),
                  e("th", null, "Plan"),
                  e("th", null, "Amount"),
                  e("th", null, "Date Paid"),
                ])
              ),
              e(
                "tbody",
                null,
                collections.map((c, i) =>
                  e("tr", { key: i }, [
                    e("td", null, c.full_name),
                    e("td", null, c.maf_no),
                    e("td", null, c.plan_type),
                    e("td", null, `₱${c.payment.toLocaleString()}`),
                    e("td", null, c.date_paid),
                  ])
                )
              ),
            ])
          : e("p", null, "No collections found."),
      ]),

      /* ---------- Commissions ---------- */
      e("div", { className: "card" }, [
        e("h2", { style: { color: "#5fe280" } }, `Commissions (${getMonthLabel(selectedMonth)})`),
        e(
          "p",
          null,
          `💰 Monthly: ₱${summary.commTotal.toLocaleString()} — Outright: ₱${summary.outrightTotal.toLocaleString()} — Recruiter: ₱${summary.recruiterTotal.toLocaleString()}`
        ),
        commissions.length
          ? e("table", null, [
              e("thead", null,
                e("tr", null, [
                  e("th", null, "Type"),
                  e("th", null, "Plan"),
                  e("th", null, "Basis"),
                  e("th", null, "Amount"),
                  e("th", null, "Month"),
                  e("th", null, "Status"),
                ])
              ),
              e(
                "tbody",
                null,
                commissions.map((cm, i) =>
                  e("tr", { key: i }, [
                    e("td", null, cm.commission_type),
                    e("td", null, cm.plan_type),
                    e("td", null, `₱${(cm.basis_amount ?? 0).toLocaleString()}`),
                    e("td", null, `₱${(cm.amount ?? 0).toLocaleString()}`),
                    e("td", null, cm.month || ""),
                    e("td", null, cm.status),
                  ])
                )
              ),
            ])
          : e("p", null, "No commissions found."),
      ]),

      /* ---------- Scroll Buttons ---------- */
      e(
        "div",
        {
          style: {
            position: "fixed",
            right: "18px",
            bottom: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            zIndex: 9999,
          },
        },
        [
          showUp &&
            e(
              "button",
              {
                onClick: scrollToTop,
                title: "Back to top",
                style: {
                  width: 44,
                  height: 44,
                  borderRadius: "999px",
                  border: "1px solid #2f3947",
                  background: "#1b2028",
                  color: "#5fe280",
                  cursor: "pointer",
                  boxShadow: "0 6px 16px rgba(0,0,0,.35)",
                },
              },
              "↑"
            ),
          showDown &&
            e(
              "button",
              {
                onClick: scrollToBottom,
                title: "Scroll to bottom",
                style: {
                  width: 44,
                  height: 44,
                  borderRadius: "999px",
                  border: "1px solid #2f3947",
                  background: "#1b2028",
                  color: "#5fe280",
                  cursor: "pointer",
                  boxShadow: "0 6px 16px rgba(0,0,0,.35)",
                },
              },
              "↓"
            ),
        ]
      ),
    ]
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(e(AgentProfile));
