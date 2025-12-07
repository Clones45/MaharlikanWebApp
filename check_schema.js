
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Probing columns...');

    const probe = async (col) => {
        const { error } = await supabase.from('beneficiaries').select(col).limit(1);
        if (error) {
            if (error.code === '42703') return `❌ ${col} does not exist`;
            return `⚠️ ${col} error: ${error.message}`;
        }
        return `✅ ${col} exists`;
    };

    console.log(await probe('non_existent_column'));
    console.log(await probe('first_name'));
    console.log(await probe('firstname'));
    console.log(await probe('last_name'));
    console.log(await probe('lastname'));
    console.log(await probe('relation'));
    console.log(await probe('relationship'));
}

checkSchema();
