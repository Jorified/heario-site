// Shared price helper for the homepage and the dashboard.
window.HearioPricing = (function () {
  var KEY = 'heario_currency';
  var LABELS = { eur: 'EUR €', gbp: 'GBP £', usd: 'USD $' };

  function recall() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  return {
    labels: LABELS,
    // Resolves to { prices: { eur: {amount, display}, ... }, currency } or { prices: null } if unavailable.
    load: function () {
      return fetch('/api/pricing')
        .then(function (r) { return r.json(); })
        .then(function (d) { return d && d.prices ? d : { prices: null }; })
        .catch(function () { return { prices: null }; });
    },
    // Which currency to show: a forced one (existing subscriber), then the visitor's choice, then their region's.
    pick: function (info, forced) {
      if (!info || !info.prices) return '';
      if (forced && info.prices[forced]) return forced;
      var saved = recall();
      if (saved && info.prices[saved]) return saved;
      return info.currency;
    },
    remember: function (cur) { try { localStorage.setItem(KEY, cur); } catch (e) {} }
  };
})();
