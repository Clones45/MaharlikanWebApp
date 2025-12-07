/*****************************************
 * Supabase Connection
 *****************************************/
const { createClient } = supabase;

const supabaseUrl = "https://agyueadcymdopgihtckc.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneXVlYWRjeW1kb3BnaWh0Y2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzMzA2NjYsImV4cCI6MjA3NDkwNjY2Nn0.EBYfJ9RTkeGLQptG3uWaOsFMIz9DySu3uhaOlzgeeMw";

const dummyStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
};

const db = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: dummyStorage,
  },
});

const e = React.createElement;

/*****************************************
 * RANK ORDER (for grouping / sort)
 *****************************************/
const RANK_ORDER = { SE: 1, AS: 2, MS: 3, MH: 4 };

/*****************************************
 * BUILD TREE FROM agents + assigned_id
 *****************************************/
function buildHierarchyTree(agents) {
  const map = {};
  const roots = [];

  // Initialize map
  agents.forEach(a => {
    map[a.id] = { ...a, children: [] };
  });

  // Build tree with cycle detection
  agents.forEach(a => {
    const node = map[a.id];
    const parentId = a.assigned_id;

    let isCycle = false;

    // Check for cycles by tracing up
    if (parentId && map[parentId]) {
      let current = parentId;
      const visited = new Set([a.id]); // Start with self to detect immediate loop back

      // Limit depth to prevent infinite loops in case of massive chains (safety cap)
      let depth = 0;
      while (current && map[current] && depth < 1000) {
        if (visited.has(current)) {
          isCycle = true;
          break;
        }
        visited.add(current);
        current = map[current].assigned_id;
        depth++;
      }
    }

    if (parentId && map[parentId] && !isCycle) {
      map[parentId].children.push(node);
    } else {
      // If no parent, or parent not found, or cycle detected -> treat as root
      roots.push(node);
    }
  });

  const sortNodes = (arr) => {
    arr.sort((x, y) => {
      const rx = RANK_ORDER[x.hier_role] || 0;
      const ry = RANK_ORDER[y.hier_role] || 0;
      if (ry !== rx) return ry - rx;
      const nx = (x.lastname || "") + " " + (x.firstname || "");
      const ny = (y.lastname || "") + " " + (y.firstname || "");
      return nx.localeCompare(ny);
    });
    arr.forEach(n => sortNodes(n.children));
  };

  sortNodes(roots);
  return roots;
}

/*****************************************
 * Tree Node Component (Collapsible Card)
 *****************************************/
function TreeNode({ node, level, onAssign }) {
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const indent = Math.min(level * 12, 48);

  return e("div", {
    style: { marginLeft: indent, marginBottom: 8 }
  }, [
    e("div", {
      key: "card-" + node.id,
      style: {
        background: "#1f2229",
        borderRadius: 10,
        padding: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid #262a33"
      }
    }, [
      e("div", {
        key: "left-" + node.id,
        style: { display: "flex", alignItems: "center", gap: 8 }
      }, [
        hasChildren && e("button", {
          key: "toggle-" + node.id,
          onClick: () => setExpanded(!expanded),
          style: {
            width: 24,
            height: 24,
            borderRadius: 999,
            border: "none",
            background: "#2b2f38",
            color: "#fff",
            cursor: "pointer",
            fontSize: 14
          }
        }, expanded ? "▾" : "▸"),

        !hasChildren && e("span", {
          key: "dot-" + node.id,
          style: {
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#5fe280"
          }
        }),

        e("div", { key: "text-" + node.id }, [
          e("div", {
            key: "name-" + node.id,
            style: { color: "#5fe280", fontSize: "0.98rem", fontWeight: 600 }
          }, `${node.firstname} ${node.lastname}`),

          e("div", {
            key: "role-" + node.id,
            style: { color: "#bbb", fontSize: "0.82rem" }
          }, `Rank: ${node.hier_role || "N/A"}`)
        ])
      ]),

      e("button", {
        key: "assign-" + node.id,
        onClick: () => onAssign(node),
        style: {
          background: "#5fe280",
          border: "none",
          color: "#000",
          padding: "6px 10px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: "0.85rem"
        }
      }, "Assign Upline →")
    ]),

    expanded && hasChildren && e("div", {
      key: "children-" + node.id,
      style: {
        marginTop: 4,
        borderLeft: "1px dashed #333",
        paddingLeft: 10
      }
    }, node.children.map(child =>
      e(TreeNode, {
        key: "child-" + child.id,
        node: child,
        level: level + 1,
        onAssign
      })
    ))
  ]);
}

/*****************************************
 * MAIN HIERARCHY DASHBOARD
 *****************************************/
function HierarchyDashboard() {
  const [agents, setAgents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const [uplineSearch, setUplineSearch] = React.useState("");
  const [newUpline, setNewUpline] = React.useState("");

  const [viewMode, setViewMode] = React.useState("LIST"); // LIST or TREE

  // Ref to hold latest state for manual DOM event handlers
  const stateRef = React.useRef({
    selectedAgent: null,
    uplineSearch: "",
    newUpline: "",
    agents: []
  });

  React.useEffect(() => {
    stateRef.current = { selectedAgent, uplineSearch, newUpline, agents };
  }, [selectedAgent, uplineSearch, newUpline, agents]);

  React.useEffect(() => {
    fetchAgents();
  }, []);

  /******************** FETCH AGENTS ********************/
  async function fetchAgents() {
    setLoading(true);

    const { data, error } = await db
      .from("agents")
      .select("id, firstname, lastname, hier_role, assigned_id")
      .order("lastname", { ascending: true });

    if (error) console.error("Fetch error:", error);

    setAgents(data || []);
    setLoading(false);
  }

  /******************* PANEL CONTROL ********************/
  function openAssignPanel(agent) {
    setSelectedAgent(agent);
    const startUpline = agent.assigned_id || "";
    setNewUpline(startUpline);
    setUplineSearch("");

    // Pass explicit values to renderPanel to avoid stale state
    renderPanel(agent, startUpline, "");

    const panel = document.getElementById("slidePanel");
    if (panel) panel.style.right = "0";
  }

  function closeAssignPanel() {
    const panel = document.getElementById("slidePanel");
    if (panel) panel.style.right = "-400px";
    setSelectedAgent(null);
  }

  /******************* SAVE ASSIGNMENT ******************/
  async function saveAssignment() {
    // Use ref to get latest state if needed, but state vars are usually fine in the closure 
    // unless this function is stale. Since we attach it to window.__Hierarchy on every render,
    // it should be fresh.
    const agent = selectedAgent;
    const uplineId = newUpline;

    if (!agent) return;

    if (uplineId === agent.id) {
      alert("❌ You cannot assign an agent to themselves.");
      return;
    }

    // Cycle Check
    if (uplineId) {
      let parent = agents.find(a => a.id === uplineId);
      let depth = 0;
      while (parent && depth < 1000) {
        if (parent.id === agent.id) {
          alert("❌ Cycle detected! You cannot assign an agent to their own downline.");
          return;
        }
        parent = agents.find(a => a.id === parent.assigned_id);
        depth++;
      }
    }

    const { error } = await db
      .from("agents")
      .update({ assigned_id: uplineId || null })
      .eq("id", agent.id);

    if (error) {
      alert("Failed to update upline.");
      console.error(error);
      return;
    }

    alert("✅ Upline updated successfully!");
    closeAssignPanel();
    fetchAgents();
  }

  /***************** UPLINE OPTIONS (ANYONE EXCEPT SELF) *****************/
  function getUplineOptions(explicitSearch) {
    // Use explicit search if provided, otherwise state
    const search = explicitSearch !== undefined ? explicitSearch : uplineSearch;
    const agent = selectedAgent;

    if (!agent) return [];

    return agents.filter(a =>
      a.id !== agent.id &&
      (a.firstname + " " + a.lastname)
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  }

  function groupByRank(list) {
    return {
      MH: list.filter(a => a.hier_role === "MH"),
      MS: list.filter(a => a.hier_role === "MS"),
      AS: list.filter(a => a.hier_role === "AS"),
      SE: list.filter(a => a.hier_role === "SE"),
    };
  }

  /******************* PANEL RENDER *********************/
  function renderPanel(agent, explicitUpline, explicitSearch) {
    // Use explicit values or fallback to state/ref
    const currentUplineId = explicitUpline !== undefined ? explicitUpline : newUpline;
    const currentSearch = explicitSearch !== undefined ? explicitSearch : uplineSearch;

    const uplineList = getUplineOptions(currentSearch);
    const grouped = groupByRank(uplineList);
    const currentUplineObj = agents.find(a => a.id === agent.assigned_id);

    const panel = document.getElementById("panelContent");
    if (!panel) return;

    panel.innerHTML = `
      <p><strong>Agent:</strong><br>${agent.firstname} ${agent.lastname}</p>
      <p><strong>Current Upline:</strong><br>${currentUplineObj ? `${currentUplineObj.firstname} ${currentUplineObj.lastname}` : "None"}</p>

      <hr style="border-color:#333;margin:15px 0;">

      <p><strong>Search Upline:</strong></p>
      <input
        type="text"
        id="uplineSearchBox"
        placeholder="Type name..."
        value="${currentSearch}"
        style="width:100%;padding:8px;background:#1b1d22;color:#fff;border:1px solid #444;border-radius:6px;margin-bottom:10px;"
      />

      <div id="uplineList" style="max-height:340px; overflow-y:auto;"></div>
    `;

    const searchBox = document.getElementById("uplineSearchBox");
    if (searchBox) {
      searchBox.oninput = (ev) => {
        const val = ev.target.value;
        // Update React state
        window.__Hierarchy.setUplineSearch(val);
        // Re-render panel immediately with new value
        // We need to access the LATEST agent and newUpline from ref
        const { selectedAgent, newUpline } = window.__Hierarchy.getState();
        window.__Hierarchy.renderPanel(selectedAgent, newUpline, val);
      };
      // Restore focus after re-render? No, innerHTML destroys it.
      // This is the problem with innerHTML. 
      // But we can just set the value back and focus.
      searchBox.focus();
    }

    const listContainer = document.getElementById("uplineList");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    function createSection(title, items) {
      if (!items.length) return;

      const section = document.createElement("div");
      section.style.marginBottom = "12px";

      const titleEl = document.createElement("p");
      titleEl.style.color = "#5fe280";
      titleEl.style.margin = "6px 0";
      titleEl.textContent = title;

      section.appendChild(titleEl);

      items.forEach(u => {
        const btn = document.createElement("button");
        btn.textContent = `${u.firstname} ${u.lastname}`;
        btn.style = `
          width:100%;
          text-align:left;
          padding:8px;
          margin-bottom:6px;
          background:${currentUplineId === u.id ? "#5fe280" : "#1f2229"};
          color:${currentUplineId === u.id ? "#000" : "#fff"};
          border:none;
          border-radius:6px;
          cursor:pointer;
        `;
        btn.onclick = () => {
          // Update React state
          window.__Hierarchy.setNewUpline(u.id);
          // Re-render panel
          const { selectedAgent, uplineSearch } = window.__Hierarchy.getState();
          window.__Hierarchy.renderPanel(selectedAgent, u.id, uplineSearch);
        };
        section.appendChild(btn);
      });

      listContainer.appendChild(section);
    }

    createSection("MH", grouped.MH);
    createSection("MS", grouped.MS);
    createSection("AS", grouped.AS);
    createSection("SE", grouped.SE);
  }

  /******************* EXPOSE BRIDGE ********************/
  window.__Hierarchy = {
    saveAssignment,
    setUplineSearch,
    setNewUpline,
    renderPanel,
    getState: () => stateRef.current
  };

  /******************* LIST VIEW ********************/
  function renderListView() {
    return e("div", { key: "list-view", style: { paddingTop: 10 } },
      agents.map(agent => {
        const upline = agents.find(a => a.id === agent.assigned_id);

        return e("div", {
          key: "card-" + agent.id,
          style: {
            background: "#1f2229",
            padding: 12,
            borderRadius: 10,
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between"
          }
        }, [
          e("div", { key: "info-" + agent.id }, [
            e("p", {
              key: "name-" + agent.id,
              style: { margin: 0, color: "#5fe280", fontSize: "1.05rem" }
            }, `${agent.firstname} ${agent.lastname}`),

            e("p", {
              key: "rank-" + agent.id,
              style: { margin: "4px 0", color: "#ccc" }
            }, `Rank: ${agent.hier_role}`),

            e("p", {
              key: "upline-" + agent.id,
              style: { margin: 0, color: "#bbb" }
            }, `Upline: ${upline ? `${upline.firstname} ${upline.lastname}` : "None"}`),
          ]),

          e("button", {
            key: "assign-" + agent.id,
            onClick: () => openAssignPanel(agent),
            style: {
              background: "#5fe280",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
              cursor: "pointer",
              color: "#000"
            }
          }, "Assign Upline →")
        ]);
      })
    );
  }

  /******************* TREE VIEW ********************/
  function renderTreeView() {
    const roots = buildHierarchyTree(agents);
    if (!roots.length) {
      return e("p", { key: "tree-empty", style: { paddingTop: 10 } }, "No hierarchy data.");
    }

    return e("div", { key: "tree-view", style: { paddingTop: 10 } },
      roots.map(root =>
        e(TreeNode, {
          key: "tree-root-" + root.id,
          node: root,
          level: 0,
          onAssign: openAssignPanel
        })
      )
    );
  }

  /******************* MAIN RENDER ********************/
  if (loading) {
    return e("p", { style: { padding: 20 } }, "Loading agents...");
  }

  const content = viewMode === "LIST" ? renderListView() : renderTreeView();

  return e("div", { style: { padding: 20 } }, [

    e("div", {
      key: "view-toggle",
      style: { marginBottom: 12, display: "flex", gap: 8 }
    }, [
      e("button", {
        key: "btn-list",
        onClick: () => setViewMode("LIST"),
        style: {
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #2b2f38",
          cursor: "pointer",
          background: viewMode === "LIST" ? "#5fe280" : "#14161c",
          color: viewMode === "LIST" ? "#000" : "#ddd",
          fontSize: "0.9rem"
        }
      }, "List View"),

      e("button", {
        key: "btn-tree",
        onClick: () => setViewMode("TREE"),
        style: {
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #2b2f38",
          cursor: "pointer",
          background: viewMode === "TREE" ? "#5fe280" : "#14161c",
          color: viewMode === "TREE" ? "#000" : "#ddd",
          fontSize: "0.9rem"
        }
      }, "Tree View")
    ]),

    // ✅ second child now wrapped with a key
    e("div", { key: "view-container" }, content)
  ]);
}

/*****************************************
 * RENDER ROOT
 *****************************************/
ReactDOM.createRoot(document.getElementById("root")).render(
  e(HierarchyDashboard)
);

/*****************************************
 * SAVE BUTTON HANDLER
 *****************************************/
document.getElementById("saveAssignmentBtn").onclick = () => {
  window.__Hierarchy.saveAssignment();
};
