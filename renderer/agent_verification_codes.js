// Agent Verification Codes - Admin Panel
let sb = null;

async function initSupabase() {
    try {
        // Get environment variables from Electron
        let env = null;
        if (window.electronAPI?.getEnv) {
            try {
                env = await window.electronAPI.getEnv();
            } catch (e) {
                console.error('Failed to get env from electronAPI:', e);
            }
        }

        if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
            throw new Error('Missing Supabase credentials. Please check .env file.');
        }

        if (!window.supabase?.createClient) {
            throw new Error('Supabase SDK not loaded. Check script tag.');
        }

        sb = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
            auth: { persistSession: false }
        });

        console.log('[agent_verification_codes] Supabase initialized successfully');
        return true;
    } catch (err) {
        console.error('[agent_verification_codes] Init error:', err);
        const listContainer = document.getElementById('verificationList');
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="error">
                    <p>Failed to initialize: ${err.message}</p>
                    <p style="font-size: 12px; margin-top: 10px;">Check browser console for details.</p>
                </div>
            `;
        }
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const initialized = await initSupabase();
    if (initialized) {
        await loadVerificationCodes();
    }

    document.getElementById('btnBackHome')?.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
});

async function loadVerificationCodes() {
    const listContainer = document.getElementById('verificationList');

    try {
        // Get all agents who are not verified but have a verification code
        const { data: agents, error } = await sb
            .from('agents')
            .select(`
                id,
                firstname,
                lastname,
                verification_code,
                created_at,
                users_profile!inner(email)
            `)
            .eq('is_verified', false)
            .not('verification_code', 'is', null);

        if (error) throw error;

        if (!agents || agents.length === 0) {
            listContainer.innerHTML = `
                <div class="no-pending">
                    <h2>✅ No Pending Verifications</h2>
                    <p>All agents are verified or no verification codes have been generated yet.</p>
                </div>
            `;
            return;
        }

        // For each agent, get their membership payment count
        const agentsWithCounts = await Promise.all(
            agents.map(async (agent) => {
                const { count } = await sb
                    .from('collections')
                    .select('*', { count: 'exact', head: true })
                    .eq('agent_id', agent.id)
                    .eq('payment_for', 'membership');

                return {
                    ...agent,
                    paymentCount: count || 0,
                    email: agent.users_profile?.email || 'No email'
                };
            })
        );

        // Display verification cards
        listContainer.innerHTML = agentsWithCounts.map(agent => `
            <div class="verification-card">
                <div class="agent-info">
                    <div>
                        <div class="agent-name">${agent.firstname} ${agent.lastname}</div>
                        <div class="agent-email">📧 ${agent.email}</div>
                        <div style="margin-top: 5px;">
                            <span class="member-count">💰 ${agent.paymentCount} membership payments</span>
                            <span class="status-badge status-pending">Pending Verification</span>
                        </div>
                    </div>
                </div>
                
                <div class="verification-code" id="code-${agent.id}">
                    ${agent.verification_code}
                </div>
                
                <div style="text-align: center;">
                    <button class="copy-btn" onclick="copyCode('${agent.verification_code}', ${agent.id}, event)">
                        📋 Copy Code
                    </button>
                </div>
                
                <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 5px; font-size: 13px;">
                    <strong>Quick Actions:</strong><br>
                    • Copy code above and send via SMS/WhatsApp<br>
                    • Code was auto-generated when ${agent.firstname} collected 2nd membership payment<br>
                    • Created: ${new Date(agent.created_at).toLocaleString()}
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Error loading verification codes:', err);
        listContainer.innerHTML = `
            <div class="error">
                <p>Error loading verification codes: ${err.message}</p>
            </div>
        `;
    }
}

function copyCode(code, agentId, event) {
    navigator.clipboard.writeText(code).then(() => {
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ Copied!';
        btn.style.background = '#27ae60';

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '#3498db';
        }, 2000);
    }).catch(err => {
        alert('Failed to copy code: ' + err.message);
    });
}
