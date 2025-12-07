
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testAdd() {
    const maf = 'TB-' + Date.now().toString().slice(-8);
    const first = 'BeneTestFirst';
    const last = 'BeneTestLast';

    console.log(`Inserting member: ${first} ${last} (${maf})`);

    // 1. Insert Member
    const { data: member, error: mErr } = await supabase
        .from('members')
        .insert({
            maf_no: maf,
            first_name: first,
            last_name: last,
            birth_date: '2000-01-01',
            age: 24,
            membership: 'Insurable',
            plan_type: 'PLAN A1',
            casket_type: 'JUNIOR PLAIN',
            contracted_price: 29880,
            monthly_due: 498,
            agent_id: 1 // Assuming agent 1 exists
        })
        .select()
        .single();

    if (mErr) {
        console.error('Member insert failed:', mErr);
        return;
    }
    console.log('Member inserted with ID:', member.id);

    // 2. Insert Beneficiaries
    const benes = [
        {
            member_id: member.id,
            first_name: 'Bene1',
            last_name: 'Test',
            relation: 'Sibling',
            address: '123 St'
        },
        {
            member_id: member.id,
            first_name: 'Bene2',
            last_name: 'Test',
            relation: 'Parent',
            address: '456 Ave'
        }
    ];

    console.log('Inserting beneficiaries:', benes);
    const { data: bData, error: bErr } = await supabase
        .from('beneficiaries')
        .insert(benes)
        .select();

    if (bErr) {
        console.error('Beneficiary insert failed:', bErr);
    } else {
        console.log('Beneficiaries inserted:', bData.length);
    }

    // 3. Verify
    console.log('Verifying fetch...');
    const { data: fetchedBenes, error: fErr } = await supabase
        .from('beneficiaries')
        .select('*')
        .eq('member_id', member.id);

    if (fErr) console.error('Fetch error:', fErr);
    else console.log('Fetched beneficiaries count:', fetchedBenes.length);

    // Cleanup
    console.log('Cleaning up...');
    await supabase.from('beneficiaries').delete().eq('member_id', member.id);
    await supabase.from('members').delete().eq('id', member.id);
}

testAdd();
