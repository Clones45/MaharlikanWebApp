
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('Fetching latest member...');
    const { data: members, error: mErr } = await supabase
        .from('members')
        .select('*')
        .order('id', { ascending: false })
        .limit(1);

    if (mErr) {
        console.error('Member fetch error:', mErr);
        return;
    }

    if (!members || members.length === 0) {
        console.log('No members found.');
        return;
    }

    const member = members[0];
    console.log(`Latest Member: ${member.first_name} ${member.last_name} (ID: ${member.id}, MAF: ${member.maf_no})`);

    const beneKeys = Object.keys(member).filter(k => k.toLowerCase().includes('benef') || k.toLowerCase().includes('bene'));
    console.log('Beneficiary-related columns in members table:', beneKeys);
    beneKeys.forEach(k => console.log(`${k}: ${member[k]}`));

    console.log('Fetching beneficiaries table count...');
    const { count, error: cErr } = await supabase
        .from('beneficiaries')
        .select('*', { count: 'exact', head: true });

    if (cErr) console.error(cErr);
    console.log('Total rows in beneficiaries table:', count);

    console.log('Fetching beneficiaries for this member...');
    const { data: benes, error: bErr } = await supabase
        .from('beneficiaries')
        .select('*')
        .eq('member_id', member.id);

    if (bErr) {
        console.error('Beneficiary fetch error:', bErr);
        return;
    }

    console.log(`Found ${benes.length} beneficiaries:`);
    console.dir(benes, { depth: null });
}

check();
