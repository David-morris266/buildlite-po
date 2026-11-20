const preparation = require('./paymentNoticePreparation');
const { query } = require('../db');

async function startPreparationRunner({processOne=preparation.processOne,intervalMs=5000}={}) {
  if (!preparation.enabled()) return {stop:async()=>{}};
  const schema=(await query("SELECT to_regclass('payment_notice_preparation_jobs') jobs,to_regclass('payment_notice_instructions') instructions")).rows[0];
  if(!schema.jobs || !schema.instructions)throw new Error('Notice preparation enabled before migration 072. Disable the feature or apply the reviewed migration.');
  let stopped=false,timer,current;
  const controller=new AbortController();
  async function tick() {
    if(stopped)return;
    try {await processOne({signal:controller.signal});}
    catch(error){console.error('Notice preparation runner failed; persisted jobs remain recoverable:',error.message);}
    if(!stopped){timer=setTimeout(()=>{current=tick();},intervalMs);timer.unref();}
  }
  current=tick();
  return {async stop(){stopped=true;clearTimeout(timer);controller.abort();await current;}};
}
module.exports={startPreparationRunner};
