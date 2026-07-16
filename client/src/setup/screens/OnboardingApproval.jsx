import { SETUP_FORM_IDS } from '../constants';

export default function OnboardingApproval({ value, onChange, onSubmit }) {
  return (
    <section className="setup-step">
      <h1 className="setup-step__title">Approval Defaults</h1>
      <p className="setup-step__lead">Configure default approvers for purchase orders, certificates and CVRs.</p>

      <form id={SETUP_FORM_IDS.approval} className="setup-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <h2 className="setup-form__subtitle">Purchase Order Approval</h2>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Name</span>
            <input className="input" value={value.poApproverName} onChange={(e) => onChange({ ...value, poApproverName: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Email</span>
            <input className="input" value={value.poApproverEmail} onChange={(e) => onChange({ ...value, poApproverEmail: e.target.value })} />
          </label>
        </div>

        <h2 className="setup-form__subtitle">Certificate Approval</h2>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Name</span>
            <input className="input" value={value.certificateApproverName} onChange={(e) => onChange({ ...value, certificateApproverName: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Email</span>
            <input className="input" value={value.certificateApproverEmail} onChange={(e) => onChange({ ...value, certificateApproverEmail: e.target.value })} />
          </label>
        </div>

        <h2 className="setup-form__subtitle">CVR Approval</h2>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Name</span>
            <input className="input" value={value.cvrApproverName} onChange={(e) => onChange({ ...value, cvrApproverName: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Approver Email</span>
            <input className="input" value={value.cvrApproverEmail} onChange={(e) => onChange({ ...value, cvrApproverEmail: e.target.value })} />
          </label>
        </div>
      </form>
    </section>
  );
}
