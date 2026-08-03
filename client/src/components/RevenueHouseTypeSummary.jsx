import { formatRevenueMoney, formatRevenueRate } from '../revenue/revenueCalculations';

function formatCompactMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';

  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    const digits = millions >= 10 ? 1 : 2;
    return `£${millions.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}m`;
  }

  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    const digits = thousands >= 100 ? 0 : thousands >= 10 ? 1 : 2;
    return `£${thousands.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}k`;
  }

  return formatRevenueMoney(amount);
}

export default function RevenueHouseTypeSummary({ summary }) {
  if (!summary?.rows?.length) return null;

  const { rows, totals } = summary;

  return (
    <section
      className="po-module-card revenue-house-type-summary"
      aria-labelledby="revenue-house-type-summary-title"
    >
      <header className="revenue-house-type-summary__header">
        <h2 id="revenue-house-type-summary-title" className="revenue-house-type-summary__title">
          Revenue by House Type
        </h2>
      </header>

      <div className="po-table-wrap revenue-house-type-summary__table-wrap">
        <table className="po-data-table revenue-house-type-summary__table">
          <thead>
            <tr>
              <th>House Type</th>
              <th>Plots</th>
              <th>Revenue</th>
              <th>Avg Price</th>
              <th>Avg £/ft²</th>
              <th>Avg £/m²</th>
              <th>OM</th>
              <th>AH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.houseType}>
                <th scope="row">{row.houseType}</th>
                <td>{row.plotCount}</td>
                <td>{formatCompactMoney(row.totalRevenue)}</td>
                <td>{formatCompactMoney(row.averageSellingPrice)}</td>
                <td>{row.averagePerFt2 ? formatRevenueRate(row.averagePerFt2) : '—'}</td>
                <td>{row.averagePerM2 ? formatRevenueRate(row.averagePerM2) : '—'}</td>
                <td>{row.openMarketPlots}</td>
                <td>{row.affordablePlots}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="revenue-house-type-summary__totals-row">
              <th scope="row">Total</th>
              <td>{totals.plotCount}</td>
              <td>{formatRevenueMoney(totals.totalRevenue)}</td>
              <td colSpan={2}>
                <span className="revenue-house-type-summary__footer-metric">
                  Avg £/ft² {formatRevenueRate(totals.averagePerFt2)}
                </span>
              </td>
              <td colSpan={3}>
                <span className="revenue-house-type-summary__footer-metric">
                  Avg £/m² {formatRevenueRate(totals.averagePerM2)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
