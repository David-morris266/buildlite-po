const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function call(path,options={}){const response=await fetch(`${API_BASE}/api${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Payment authority request failed.');return body;}
const body=value=>JSON.stringify({...value,actor:typeof localStorage==='undefined'?null:(localStorage.getItem('userName')||localStorage.getItem('userEmail'))});
export const getPaymentAuthority=(packageId,certificateId,asOfDate)=>call(`/packages/${encodeURIComponent(packageId)}/certificates/${encodeURIComponent(certificateId)}/payment-authority${asOfDate?`?asOfDate=${asOfDate}`:''}`);
export const createPaymentNotice=(packageId,certificateId,value)=>call(`/packages/${packageId}/certificates/${certificateId}/payment-notices`,{method:'POST',body:body(value)});
export const updatePaymentNotice=(id,value)=>call(`/payment-notices/${id}`,{method:'PATCH',body:body(value)});
export const preparePaymentNotice=id=>call(`/payment-notices/${id}/prepare`,{method:'POST',body:body({})});
export const issuePaymentNotice=id=>call(`/payment-notices/${id}/issue`,{method:'POST',body:body({})});
export const confirmIntendedPayment=(packageId,certificateId,value)=>call(`/packages/${packageId}/certificates/${certificateId}/intended-payments`,{method:'POST',body:body({...value,confirm:true})});
export const createPayLessNotice=(packageId,certificateId,value)=>call(`/packages/${packageId}/certificates/${certificateId}/pay-less-notices`,{method:'POST',body:body(value)});
