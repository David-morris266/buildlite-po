import { useState } from 'react';

import { listCostCodeMasterRecords } from '../../admin/costCodeMasterStore';

import { getDemoCostCodeCount } from '../demoCostCodes';

import SetupCostCodeImportWizard from '../components/SetupCostCodeImportWizard';

import { installDemoCostCodes } from '../setupCommit';



export default function OnboardingCostCodes({

  value,

  onChange,

  errors,

  onWizardActiveChange,

}) {

  const [showWizard, setShowWizard] = useState(false);

  const masterCount = listCostCodeMasterRecords().length;

  const showSummary = Boolean(value.importSummary);



  function setWizardOpen(next) {

    setShowWizard(next);

    onWizardActiveChange?.(next);

  }



  function handleDemoInstall() {

    const result = installDemoCostCodes();

    if (!result.ok || result.imported === 0) {

      onChange({

        ...value,

        importSummary: null,

      });

      return;

    }



    onChange({

      ...value,

      mode: 'demo',

      demoInstalled: true,

      importCommitted: false,

      importSummary: {

        imported: result.imported,

        skipped: 0,

        mode: 'demo',

      },

    });

  }



  function handleImportComplete(summary) {

    if (!summary?.ok) return;



    onChange({

      ...value,

      mode: 'import',

      demoInstalled: false,

      importCommitted: false,

      importSummary: summary,

    });

    setWizardOpen(false);

  }



  if (showWizard) {

    return (

      <section className="setup-step">

        <h1 className="setup-step__title">Import Cost Codes</h1>

        <p className="setup-step__lead">Upload your existing cost code list and map columns before importing.</p>

        <SetupCostCodeImportWizard

          onComplete={handleImportComplete}

          onCancel={() => setWizardOpen(false)}

        />

      </section>

    );

  }



  return (

    <section className="setup-step">

      <h1 className="setup-step__title">Cost Code Import</h1>

      <p className="setup-step__lead">

        Choose how to populate your cost code master. Demo data is optional and clearly separated from your customer data.

      </p>



      {masterCount > 0 && !showSummary ? (

        <p className="setup-step__hint">{masterCount} cost codes already in master data.</p>

      ) : null}

      {errors.costCodes ? <p className="setup-step__error">{errors.costCodes}</p> : null}



      {showSummary ? (

        <div className="setup-import-panel po-module-card">

          <h3>Import summary</h3>

          <div className="setup-import-summary-grid">

            <article>

              <span>Imported</span>

              <strong>{value.importSummary.imported || 0}</strong>

            </article>

            <article>

              <span>Skipped</span>

              <strong>{value.importSummary.skipped || 0}</strong>

            </article>

            <article>

              <span>Mode</span>

              <strong>{value.mode === 'demo' ? 'Demo structure' : 'Excel import'}</strong>

            </article>

          </div>

          <p className="setup-step__hint">

            {value.importCommitted

              ? 'Cost codes are saved. Continue to First Supplier when you are ready.'

              : 'Press Continue below to save this step and update setup progress.'}

          </p>

        </div>

      ) : (

        <div className="setup-choice-grid">

          <article className="setup-choice-card po-module-card">

            <h2>Import Existing Cost Codes</h2>

            <p>Upload Excel or CSV and map columns using the import wizard.</p>

            <button type="button" className="po-btn-primary" onClick={() => setWizardOpen(true)}>

              Import Excel

            </button>

          </article>



          <article className="setup-choice-card po-module-card">

            <h2>Install BuildLite Demo Structure</h2>

            <p>Install {getDemoCostCodeCount()} demonstration cost codes mapped to the Doc 46 hierarchy.</p>

            <button type="button" className="po-list-btn-secondary" onClick={handleDemoInstall}>

              Start with Demo Cost Codes

            </button>

          </article>

        </div>

      )}

    </section>

  );

}


