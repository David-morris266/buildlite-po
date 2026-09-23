function isActivePlot(plot = {}) {
  return String(plot.status || 'Active').trim().toLowerCase() !== 'inactive';
}

function unavailable(reason, activePlotCount = 0) {
  return {
    activePlotCount,
    activePlotGiaFt2: null,
    giaComplete: false,
    giaUnavailableReason: reason,
  };
}

export function buildActiveDevelopmentGiaSummary({ development, historic = false, snapshot = null } = {}) {
  if (!development?.id) return unavailable('Development authority is unavailable.');
  if (historic && snapshot?.developmentId && snapshot.developmentId !== development.id) {
    return unavailable('Historic Plot Master evidence belongs to another Development.');
  }
  let plots;
  if (historic) {
    plots = snapshot?.sourceReadiness?.plotMaster?.value;
    if (!Array.isArray(plots)) {
      return unavailable('Historic CVR does not contain frozen Plot Master GIA evidence.');
    }
  } else {
    plots = development?.plotMaster?.plots;
    if (!Array.isArray(plots)) {
      return unavailable('Development Plot Master is unavailable.');
    }
  }

  const activePlots = plots.filter(isActivePlot);
  if (!activePlots.length) return unavailable('No active Development plots are available.');

  const invalid = activePlots.some((plot) => {
    const gia = Number(plot.gia);
    return !Number.isFinite(gia) || gia <= 0;
  });
  if (invalid) {
    return unavailable('Complete active Plot Master GIA is required.', activePlots.length);
  }

  return {
    activePlotCount: activePlots.length,
    activePlotGiaFt2: activePlots.reduce((total, plot) => total + Number(plot.gia), 0),
    giaComplete: true,
    giaUnavailableReason: null,
  };
}

export function calculateCostPerFt2(value, giaSummary) {
  if (!giaSummary?.giaComplete || !(Number(giaSummary.activePlotGiaFt2) > 0)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount / Number(giaSummary.activePlotGiaFt2) : null;
}
