import { useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { isPaymentCertificateServerAuthorityEnabled } from '../payments/paymentCertificateAuthority';
import { updateCertificateMetadataOnServer } from '../payments/paymentCertificateServerMutations';

export default function PaymentCertificateZeroOrderedWorks({order,certificate,matrixReady,matrix,onChanged}) {
  const canEdit=useBuildLitePermission('certificate.edit');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const saved=certificate.variationOnlyConfirmation;
  const eligible=matrixReady && !matrix && certificate.status==='draft' && !Object.keys(certificate.progress||{}).length;
  const save=async value=>{
    setBusy(true);setError('');
    try{
      const result=await updateCertificateMetadataOnServer(order.orderKey,certificate.id,{zeroOrderedWorksConfirmed:value},order);
      if(!result.ok)throw new Error(result.errors?.[0]||'Confirmation could not be saved. Refresh before retrying.');
      setConfirmed(false);onChanged?.();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section aria-label="Zero ordered works confirmation">
    <h4>Variation-only valuation</h4>
    <p>{!matrixReady ? 'Order Matrix evidence is unavailable. Wait for a successful read before confirming zero ordered works.' : matrix ? 'An Order Matrix now exists. Remove the zero-ordered-works confirmation before using matrix valuation.' : 'No Order Matrix is configured. This does not establish a zero valuation of ordered works.'}</p>
    {certificate.valuationUnavailableReason ? <p role="status">{certificate.valuationUnavailableReason}</p> : null}
    {saved ? <p role="status">Ordered works assessed at £0 for this certificate, confirmed by {saved.confirmedBy?.displayName || 'the QS'} on {saved.confirmedAt}. Variation assessments retain their existing authority status.</p> : <p>Confirm zero ordered works only when no ordered works are being assessed on this certificate. Saved variation assessments will then form the valuation.</p>}
    {!eligible ? <p>Matrix evidence must be loaded and ordered-work progress must be absent before confirming a Draft variation-only certificate.</p> : null}
    {!canEdit ? <p>Certificate editing permission is required.</p> : !isPaymentCertificateServerAuthorityEnabled() ? <p>Server-authoritative certificates are required for this confirmation.</p> : <>
      {!saved ? <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={!eligible||busy}/> I confirm ordered works assessed at £0 for this certificate.</label> : null}
      <button type="button" disabled={busy || certificate.status!=='draft' || !matrixReady || (!saved && (!eligible || !confirmed))} onClick={()=>save(!saved)}>{busy?'Saving confirmation...':saved?'Remove zero-ordered-works confirmation':'Save zero-ordered-works confirmation'}</button>
    </>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
