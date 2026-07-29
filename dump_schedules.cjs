const { createClient } = require('@supabase/supabase-js');
const FIXED_URL = "https://zqzutizokctwpagnxanw.supabase.co";
const FIXED_KEY = "sb_publishable_ZqQhQ4v5-vHIwz_liZ4zfQ_7PXnWE6i";

const supabase = createClient(FIXED_URL, FIXED_KEY);

async function run() {
  const { data, error } = await supabase.from('usina_daily_schedules').select('*');
  if (error) {
    console.error(error);
  } else {
    console.log("Total schedules:", data.length);
    console.log("Unique dates in database:", [...new Set(data.map(d => d.scheduled_date))]);
    console.log("First 10 records:", JSON.stringify(data.slice(0, 10), null, 2));
  }
}
run();
