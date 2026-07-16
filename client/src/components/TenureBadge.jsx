import { getPlotTenureLabel, getTenureBadgeTone } from '../revenue/tenureDisplay';

export default function TenureBadge({ tenure, plot = null }) {
  const label = plot ? getPlotTenureLabel(plot) : tenure;
  const tone = getTenureBadgeTone(label);

  return (
    <span className={`revenue-tenure-chip revenue-tenure-chip--${tone}`}>
      {label}
    </span>
  );
}
