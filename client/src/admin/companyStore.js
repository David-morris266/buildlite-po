import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';

import { notifyMasterDataChanged } from './masterDataEvents';



export const COMPANY_SETTINGS_KEY = 'buildlite_company_settings_v1';



export const FORECAST_BEHAVIOUR_OPTIONS = ['Committed', 'Budget', 'Actual'];

export const CVR_PERIOD_OPTIONS = ['Monthly', 'Quarterly', 'Stage Based'];



function defaultNumberingPrefixes() {

  return {

    development: 'DEV-',

    purchaseOrder: 'PO-',

    paymentCertificate: 'PC-',

    cvr: 'CVR-',

    variationOrder: 'VO-',

    salesPlot: 'SP-',

  };

}



function defaultCompanySettings() {

  return {

    companyName: '',

    tradingName: '',

    registeredAddress: '',

    registeredOffice: '',

    companyNumber: '',

    vatRegistrationNumber: '',

    website: '',

    logoUrl: '',

    logoPlaceholder: 'Company logo upload will be available in a future sprint.',

    currency: 'GBP',

    financialYearStart: '04-01',

    vatRate: 20,

    defaultRetentionPercent: 5,

    defaultCvrPeriod: 'Monthly',

    defaultForecastBehaviour: 'Committed',

    numberingPrefixes: defaultNumberingPrefixes(),

    updatedAt: null,

  };

}



function normaliseCompanySettings(raw = {}) {

  const defaults = defaultCompanySettings();

  const registeredOffice =

    raw.registeredOffice != null && String(raw.registeredOffice).trim()

      ? String(raw.registeredOffice).trim()

      : String(raw.registeredAddress || '').trim();



  const defaultForecastBehaviour = FORECAST_BEHAVIOUR_OPTIONS.includes(

    raw.defaultForecastBehaviour

  )

    ? raw.defaultForecastBehaviour

    : defaults.defaultForecastBehaviour;



  return {

    ...defaults,

    ...raw,

    registeredOffice,

    registeredAddress: registeredOffice,

    vatRate: Number.isFinite(Number(raw.vatRate)) ? Number(raw.vatRate) : defaults.vatRate,

    defaultRetentionPercent: Number.isFinite(Number(raw.defaultRetentionPercent))

      ? Number(raw.defaultRetentionPercent)

      : defaults.defaultRetentionPercent,

    defaultForecastBehaviour,

    numberingPrefixes: {

      ...defaultNumberingPrefixes(),

      ...(raw.numberingPrefixes || {}),

    },

  };

}



export function getCompanySettings() {

  return normaliseCompanySettings(readAdminStore(COMPANY_SETTINGS_KEY, {}));

}



export function saveCompanySettings(patch = {}) {

  const current = getCompanySettings();

  const next = normaliseCompanySettings({

    ...current,

    ...patch,

    numberingPrefixes: {

      ...current.numberingPrefixes,

      ...(patch.numberingPrefixes || {}),

    },

    updatedAt: new Date().toISOString(),

  });

  writeAdminStore(COMPANY_SETTINGS_KEY, next);

  notifyMasterDataChanged('company');

  return next;

}



export function getDefaultCvrPeriod() {

  return getCompanySettings().defaultCvrPeriod || 'Monthly';

}



export function getDefaultVatRate() {

  return getCompanySettings().vatRate ?? 20;

}



export function getDefaultRetentionPercent() {

  return getCompanySettings().defaultRetentionPercent ?? 5;

}


