import {
  TIME_BASES,
  TIME_BASIS_KEYS,
  TIME_BASIS_LABELS,
  TIME_OFFSET_MAX_MONTHS,
  TIME_OFFSET_MIN_MONTHS,
} from '../prelims/prelimsConstants';
import { offsetMonthLabel, resolvedMonthLabel } from '../prelims/prelimsTimeLabels';

function TimeSideFields({
  side,
  label,
  basis,
  offsetMonths,
  fixedDate,
  resolvedDate,
  disabled,
  compact,
  namePrefix,
  onChange,
}) {
  const isFixed = basis === TIME_BASES.FIXED_DATE;
  return (
    <div className={compact ? 'dev-prelims-time__side' : 'dev-form__field'}>
      <span className={compact ? 'dev-prelims-time__side-label' : 'dev-form__label'}>{label}</span>
      <div className="dev-prelims-time__controls">
        <select
          className="input"
          value={basis || TIME_BASES.SITE_START}
          disabled={disabled}
          onChange={(event) => onChange(`${side}Basis`, event.target.value)}
          aria-label={`${namePrefix} ${label.toLowerCase()} basis`}
        >
          {TIME_BASIS_KEYS.map((key) => (
            <option key={key} value={key}>
              {TIME_BASIS_LABELS[key]}
            </option>
          ))}
        </select>
        {isFixed ? (
          <input
            className="input"
            type="date"
            value={fixedDate || ''}
            disabled={disabled}
            onChange={(event) => onChange(`${side}FixedDate`, event.target.value)}
            aria-label={`${namePrefix} ${label.toLowerCase()} date`}
          />
        ) : (
          <label className="dev-prelims-time__offset">
            <input
              className="input"
              type="number"
              min={TIME_OFFSET_MIN_MONTHS}
              max={TIME_OFFSET_MAX_MONTHS}
              step="1"
              value={offsetMonths === '' || offsetMonths == null ? 0 : offsetMonths}
              disabled={disabled}
              onChange={(event) => onChange(`${side}OffsetMonths`, event.target.value)}
              aria-label={`${namePrefix} ${label.toLowerCase()} offset months`}
            />
            <span>{offsetMonthLabel(offsetMonths)}</span>
          </label>
        )}
      </div>
      <span className="dev-prelims-time__resolved">Resolved: {resolvedMonthLabel(resolvedDate)}</span>
    </div>
  );
}

export default function PrelimsTimeSpanFields({
  startBasis,
  startOffsetMonths,
  startFixedDate,
  endBasis,
  endOffsetMonths,
  endFixedDate,
  resolvedStart,
  resolvedEnd,
  totalMonths,
  outsideProgramme,
  disabled,
  compact = false,
  namePrefix = 'Prelims',
  onChange,
}) {
  return (
    <div className={`dev-prelims-time${compact ? ' dev-prelims-time--compact' : ''}`}>
      <TimeSideFields
        side="start"
        label="Start"
        basis={startBasis}
        offsetMonths={startOffsetMonths}
        fixedDate={startFixedDate}
        resolvedDate={resolvedStart}
        disabled={disabled}
        compact={compact}
        namePrefix={namePrefix}
        onChange={onChange}
      />
      <TimeSideFields
        side="end"
        label="End"
        basis={endBasis}
        offsetMonths={endOffsetMonths}
        fixedDate={endFixedDate}
        resolvedDate={resolvedEnd}
        disabled={disabled}
        compact={compact}
        namePrefix={namePrefix}
        onChange={onChange}
      />
      {compact ? (
        <div className="dev-prelims-time__side dev-prelims-time__duration-side">
          <span className="dev-prelims-time__side-label">Duration</span>
          <div className="dev-prelims-time__controls">
            <p className="dev-prelims-time__duration">
              {totalMonths == null ? '—' : `${totalMonths} months`}
              {outsideProgramme ? ' · Outside programme' : ''}
            </p>
          </div>
          <span className="dev-prelims-time__resolved" aria-hidden="true">
            &nbsp;
          </span>
        </div>
      ) : (
        <p className="dev-prelims-time__duration">
          Duration {totalMonths == null ? '—' : `${totalMonths} months`}
          {outsideProgramme ? ' · Outside programme' : ''}
        </p>
      )}
    </div>
  );
}
