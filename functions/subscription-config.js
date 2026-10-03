/* Shared Kapani subscription catalogue.
 * Browser: window.KAPANI_SUBSCRIPTIONS
 * Node: require('./subscription-config')
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.KAPANI_SUBSCRIPTIONS = Object.freeze(value);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const catalogue = {
    none:  { rank: 0, price: 0,    name: 'Без подписки',    durationDays: 0 },
    plus:  { rank: 1, price: 299,  name: 'Kapani Plus',    durationDays: 7 },
    ultra: { rank: 2, price: 899,  name: 'Kapani Ultra',   durationDays: 7 },
    prime: { rank: 3, price: 1499, name: 'Kapani Prime',   durationDays: 7 }
  };
  const normalize = value => {
    const type = String(value || '').trim().toLowerCase();
    return ['plus','ultra','prime'].includes(type) ? type : 'none';
  };
  const active = (user, now = Date.now()) => normalize(user?.subscription) !== 'none' && new Date(user?.subscriptionExpiry || 0).getTime() > now;
  Object.defineProperties(catalogue, {
    normalizeType: {value: normalize},
    isActiveSubscription: {value: active},
    activeRank: {value: (user, now = Date.now()) => active(user, now) ? catalogue[normalize(user.subscription)].rank : 0}
  });
  for (const plan of Object.values(catalogue)) Object.freeze(plan);
  return catalogue;
});
