const { createClient } = supabase;

const supabaseUrl = "https://agyueadcymdopgihtckc.supabase.co";
const supabaseKey ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneXVlYWRjeW1kb3BnaWh0Y2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzMzA2NjYsImV4cCI6MjA3NDkwNjY2Nn0.EBYfJ9RTkeGLQptG3uWaOsFMIz9DySu3uhaOlzgeeMw";
const db = createClient(supabaseUrl, supabaseKey);

const e = React.createElement;

function Dashboard() {
  const [agents, setAgents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const [details, setDetails] = React.useState({
    subordinates: [],
    collections: [],
    commissions: [],
  });
  const [search, setSearch] = React.useState("");
  const [selectedMonth, setSelectedMonth] = React.useState(getCurrentMonthValue());

  React.useEffect(() => {
    fetchAgents();
  }, []);

  // 🟢 Fetch agents summary
  async function fetchAgents() {
    setLoading(true);
    const { data, error } = await db
      .from("agent_monthly_summary_view")
      .select("*")
      .order("agent_id", { ascending: true });

    if (error) console.error("[FetchAgents Error]", error);
    setAgents(data || []);
    setLoading(false);
  }

  // 📅 Helpers
  function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function getLast12Months() {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "long", year: "numeric" });
      months.push({ label, value });
    }
    return months;
  }

  // 🧩 Load agent details
  async function openAgentDetails(agent, monthValue = selectedMonth) {
    setSelectedAgent(agent);
    setDetails({ subordinates: [], collections: [], commissions: [] });

    const [year, month] = monthValue.split("-");
    const startOfMonth = `${year}-${month}-01`;
    const endOfMonth = new Date(year, parseInt(month), 0).toISOString().split("T")[0];

    try {
      // 🔸 Subordinates
      const { data: subs } = await db
        .from("agents")
        .select("id, firstname, lastname, role")
        .eq("parent_agent", agent.agent_name);

      // 🔸 Collections (JOIN fixed)
      const { data: colls, error: colErr } = await db
        .from("collections")
        .select(`
          id,
          maf_no,
          plan_type,
          payment,
          date_paid,
          members!inner (
            id,
            agent_id,
            firstname,
            lastname
          )
        `)
        .eq("members.agent_id", agent.agent_id)
        .gte("date_paid", startOfMonth)
        .lte("date_paid", endOfMonth)
        .order("date_paid", { ascending: true });

      if (colErr) console.error("[Collections Error]", colErr);

      const collections = (colls || []).map((c) => ({
        maf_no: c.maf_no,
        plan_type: c.plan_type,
        payment: c.payment,
        date_paid: c.date_paid,
        full_name: c.members
          ? `${c.members.lastname || ""}, ${c.members.firstname || ""}`.trim()
          : "Unknown Member",
      }));

      // 🔸 Commissions
      const { data: comms } = await db
        .from("commissions")
        .select("*")
        .eq("agent_id", agent.agent_id)
        .gte("date_earned", startOfMonth)
        .lte("date_earned", endOfMonth)
        .order("date_earned", { ascending: true });

      setDetails({
        subordinates: subs || [],
        collections: collections || [],
        commissions: comms || [],
      });
    } catch (err) {
      console.error("[openAgentDetails Exception]", err);
    }
  }

  // 🔍 Search filter
  const filteredAgents = agents.filter(
    (a) =>
      a.agent_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.role?.toLowerCase().includes(search.toLowerCase())
  );

  // 🕓 Loading states
  if (loading)
    return e("p", { style: { textAlign: "center", marginTop: 50 } }, "Loading...");
  if (!agents.length)
    return e("p", { style: { textAlign: "center", marginTop: 50 } }, "No agent data found.");

  // 🧱 Main Layout
  return e("div", { style: { padding: "20px" } }, [
    // Header (Home, Search, Refresh)
    e(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        },
      },
      [
        e(
          "button",
          {
            onClick: () => (window.location.href = "index.html"),
            style: {
              background: "#1f2229",
              color: "#fff",
              border: "1px solid #333",
              padding: "8px 12px",
              borderRadius: 4,
              cursor: "pointer",
            },
          },
          "← Home"
        ),
        e("input", {
          type: "text",
          placeholder: "Search by name or role...",
          value: search,
          onChange: (e) => setSearch(e.target.value),
          style: {
            flex: 1,
            marginLeft: 10,
            marginRight: 10,
            padding: "8px 10px",
            background: "#14161c",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 4,
          },
        }),
        e(
          "button",
          {
            onClick: fetchAgents,
            style: {
              background: "#5fe280",
              color: "#000",
              padding: "8px 16px",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            },
          },
          "⟳ Refresh"
        ),
      ]
    ),

    // 🟩 Agent cards
    e(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20,
        },
      },
      filteredAgents.map((a) =>
        e(
          "div",
          {
            key: a.agent_id,
            style: {
              background: "#1f2229",
              padding: 16,
              borderRadius: 8,
              boxShadow: "0 0 8px rgba(0,0,0,0.4)",
              cursor: "pointer",
              transition: "transform 0.2s",
            },
            onClick: () => openAgentDetails(a),
            onMouseEnter: (ev) => (ev.currentTarget.style.transform = "scale(1.03)"),
            onMouseLeave: (ev) => (ev.currentTarget.style.transform = "scale(1.0)"),
          },
          [
            e("h3", { style: { color: "#5fe280" } }, a.agent_name),
            e("p", null, `Role: ${a.role || "N/A"}`),
            e("p", null, `Upline: ${a.parent_agent || "None"}`),
            e("p", null, `Active Members: ${a.total_active_members}`),
            e("p", null, `Active Subordinates: ${a.total_active_subordinates}`),
            e("p", null, `Total This Month: ₱${a.total_this_month?.toLocaleString() || "0.00"}`),
            e("p", null, `Last Month: ₱${a.total_last_month?.toLocaleString() || "0.00"}`),
            e("p", null, `Lifetime: ₱${a.lifetime_total?.toLocaleString() || "0.00"}`),
            e("p", null, `Eligible Next Role: ${a.eligible_next_role || "—"}`),
          ]
        )
      )
    ),

    // 🟦 Modal
    selectedAgent &&
      e(
        "div",
        {
          style: {
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          },
        },
        e(
          "div",
          {
            style: {
              background: "#1f2229",
              padding: 20,
              borderRadius: 10,
              maxWidth: 700,
              width: "90%",
              maxHeight: "80vh",
              overflowY: "auto",
            },
          },
          [
            // 🟩 Header with clickable agent name
            e(
              "h2",
              { style: { color: "#5fe280", marginBottom: 10, cursor: "pointer" },
                onClick: () =>
                  window.location.href = `agent_profile.html?agent_id=${selectedAgent.agent_id}`
              },
              `👁️ View Full Details — ${selectedAgent.agent_name} (${selectedAgent.role})`
            ),

            // Month selector
            e("div", { style: { marginBottom: 15 } }, [
              e("label", { style: { color: "#5fe280", marginRight: 8 } }, "Select Month:"),
              e(
                "select",
                {
                  value: selectedMonth,
                  onChange: (ev) => {
                    setSelectedMonth(ev.target.value);
                    openAgentDetails(selectedAgent, ev.target.value);
                  },
                  style: {
                    background: "#14161c",
                    color: "#fff",
                    border: "1px solid #444",
                    padding: "6px 8px",
                    borderRadius: 4,
                  },
                },
                getLast12Months().map((m) =>
                  e("option", { key: m.value, value: m.value }, m.label)
                )
              ),
            ]),

            // Close
            e(
              "button",
              {
                style: {
                  background: "#5fe280",
                  color: "#000",
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  float: "right",
                },
                onClick: () => setSelectedAgent(null),
              },
              "Close"
            ),

            // Subordinates
            e("h3", { style: { color: "#5fe280" } }, "Subordinates"),
            details.subordinates.length
              ? e("ul", null,
                  details.subordinates.map((s) =>
                    e("li", { key: s.id }, `${s.firstname} ${s.lastname} (${s.role || "N/A"})`)
                  )
                )
              : e("p", null, "No subordinates found."),

            // Collections
            e("h3", { style: { color: "#5fe280", marginTop: 15 } }, "Collections"),
            details.collections.length
              ? e("ul", null,
                  details.collections.map((c, i) =>
                    e(
                      "li",
                      { key: i },
                      `${c.maf_no} — ${c.full_name} — ₱${c.payment?.toLocaleString()} (${c.date_paid})`
                    )
                  )
                )
              : e("p", null, "No collections found."),

            // Commissions
            e("h3", { style: { color: "#5fe280", marginTop: 15 } }, "Commissions"),
            details.commissions.length
              ? e("ul", null,
                  details.commissions.map((cm, i) =>
                    e("li", { key: i },
                      `₱${cm.amount?.toLocaleString()} — ${cm.status || "Pending"}`
                    )
                  )
                )
              : e("p", null, "No commissions found."),
          ]
        )
      ),
  ]);
}

ReactDOM.createRoot(document.getElementById("root")).render(e(Dashboard));
