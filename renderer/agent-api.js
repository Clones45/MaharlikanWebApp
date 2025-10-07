/* agent-api.js
 * Utilities for creating agents + app accounts (users_profile),
 * attaching accounts to existing agents, listing data for dropdowns,
 * and resetting a stored password hash (optional).
 *
 * All functions expect an already-initialized Supabase client: SB.
 */

// Pretty error text from Supabase responses
export const errText = (e) =>
  (e && (e.message || e.details || e.hint || e.code)) || 'Unknown error';

// Compose a display name from agent fields
export const fullName = (a) =>
  `${a?.firstname || ''} ${a?.lastname || ''}`.trim();

// ---- Username checks --------------------------------------------------------

/** Ensure username is available (throws if taken). */
export async function ensureUsernameAvailable(SB, username) {
  if (!username) throw new Error('Username is required.');
  const { data, error } = await SB
    .from('users_profile')
    .select('user_id')
    .eq('username', username)
    .maybeSingle();

  if (error) throw new Error(`Username check failed: ${errText(error)}`);
  if (data) throw new Error('Username is already taken.');
  return true;
}

// ---- Simple inserts (building blocks) --------------------------------------

/** Insert a single agent row and return it. */
export async function createAgent(SB, agent) {
  const payload = {
    lastname:   agent.lastname,
    firstname:  agent.firstname,
    middlename: agent.middlename ?? null,
    address:    agent.address ?? null,
    birthdate:  agent.birthdate ?? null,    // 'YYYY-MM-DD'
    position:   agent.position ?? null
  };

  const { data, error } = await SB
    .from('agents')
    .insert([payload])
    .select('*')
    .single();

  if (error) throw new Error(`Create agent failed: ${errText(error)}`);
  return data;
}

/** Insert a single users_profile row and return it. */
export async function createProfile(SB, profile) {
  const payload = {
    username:     profile.username,
    email:        profile.email ?? null,
    role:         profile.role || 'agent',  // 'agent' | 'admin'
    display_name: profile.display_name ?? null,
    agent_id:     profile.agent_id ?? null
  };

  const { data, error } = await SB
    .from('users_profile')
    .insert([payload])
    .select('*')
    .single();

  if (error) throw new Error(`Create profile failed: ${errText(error)}`);
  return data;
}

// ---- High-level flows (with rollback) --------------------------------------

/**
 * Create a brand-new agent, then create a linked users_profile.
 * Best-effort rollback: if profile insert fails, delete the new agent.
 */
export async function createAgentAndProfile(SB, agent, profile) {
  if (!agent?.firstname || !agent?.lastname) {
    throw new Error('Missing agent first/last name.');
  }
  if (!profile?.username) throw new Error('Missing username.');

  // Guard on username uniqueness (client-side check; DB UNIQUE is the real guard)
  await ensureUsernameAvailable(SB, profile.username);

  // 1) Create agent
  const agentRow = await createAgent(SB, agent);

  // 2) Create profile linked to that agent
  try {
    const displayName = fullName(agentRow);
    const profRow = await createProfile(SB, {
      ...profile,
      display_name: displayName,
      agent_id: agentRow.id,
    });
    return { agent: agentRow, profile: profRow };
  } catch (e) {
    // Best-effort rollback
    await SB.from('agents').delete().eq('id', agentRow.id);
    throw e;
  }
}

/** Create a users_profile and link it to an existing agent by UUID. */
export async function attachAccountToExistingAgent(SB, agentId, profile) {
  if (!agentId) throw new Error('No agent selected.');
  if (!profile?.username) throw new Error('Missing username.');

  await ensureUsernameAvailable(SB, profile.username);

  const profRow = await createProfile(SB, {
    ...profile,
    agent_id: agentId,
  });

  return profRow;
}

// ---- Lists for dropdowns ----------------------------------------------------

/** List agents for a dropdown: id + name + (optional) position. */
export async function listAgents(SB) {
  const { data, error } = await SB
    .from('agents')
    .select('id, lastname, firstname, position')
    .order('lastname', { ascending: true });

  if (error) throw new Error(`Load agents failed: ${errText(error)}`);
  return (data || []).map(a => ({
    id: a.id,
    label: `${a.lastname || ''}, ${a.firstname || ''}`.trim() || a.id,
    position: a.position || null,
  }));
}

/** List app accounts for a dropdown: user_id + username + role. */
export async function listProfiles(SB) {
  const { data, error } = await SB
    .from('users_profile')
    .select('user_id, username, role, agent_id')
    .order('username', { ascending: true });

  if (error) throw new Error(`Load accounts failed: ${errText(error)}`);
  return (data || []).map(p => ({
    user_id: p.user_id,
    username: p.username,
    role: p.role,
    agent_id: p.agent_id || null,
  }));
}

// ---- Optional password hashing & reset -------------------------------------

/**
 * Hash a password with bcryptjs (make sure you loaded it in your HTML).
 * Returns password hash string.
 */
export async function hashPassword(password) {
  if (!password) throw new Error('Empty password.');
  if (typeof bcrypt === 'undefined') {
    throw new Error('bcryptjs is not loaded on this page.');
  }
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/**
 * Update users_profile.password_hash for a given user_id.
 * NOTE: your table must have a text column named `password_hash`.
 */
export async function resetPassword(SB, userId, newPasswordHash) {
  if (!userId) throw new Error('user_id is required.');
  if (!newPasswordHash) throw new Error('password hash is required.');

  const { data, error } = await SB
    .from('users_profile')
    .update({ password_hash: newPasswordHash })
    .eq('user_id', userId)
    .select('user_id, username')
    .single();

  if (error) throw new Error(`Reset password failed: ${errText(error)}`);
  return data;
}
